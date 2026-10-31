-- Complete the retail / insurance workflow stages and enforce operational stage gates.
-- Additive only. No production migration is applied by this change.
ALTER TABLE public.crm_projects
  ADD COLUMN IF NOT EXISTS materials_order_reference text,
  ADD COLUMN IF NOT EXISTS materials_ordered_at date,
  ADD COLUMN IF NOT EXISTS work_completed_at date,
  ADD COLUMN IF NOT EXISTS workflow_stage_note text,
  ADD COLUMN IF NOT EXISTS workflow_stage_override boolean NOT NULL DEFAULT false;

ALTER TABLE public.crm_project_stage_history
  ADD COLUMN IF NOT EXISTS from_pipeline_type text,
  ADD COLUMN IF NOT EXISTS to_pipeline_type text,
  ADD COLUMN IF NOT EXISTS override_used boolean NOT NULL DEFAULT false;

ALTER TABLE public.crm_workflow_stage_settings
  DROP CONSTRAINT IF EXISTS crm_workflow_stage_settings_stage_key_check;
ALTER TABLE public.crm_workflow_stage_settings
  ADD CONSTRAINT crm_workflow_stage_settings_stage_key_check CHECK (stage_key IN (
    'new_lead','contacted','appointment_set','inspection_scheduled','inspection_completed',
    'estimate_prepared','bid_issued','awaiting_customer','scope_prepared','claim_filed',
    'adjuster_meeting_scheduled','adjuster_met_awaiting_approval','supplement_prepared',
    'supplement_submitted','supplement_under_review','supplement_approved',
    'supplement_partially_approved','supplement_denied','contract_signed','deposit_pending',
    'deposit_received','materials_ordered','materials_received','scheduled','in_progress',
    'work_completed','final_inspection','final_invoice_payment_pending','closed',
    'adjuster_meeting','awaiting_carrier','supplement_review','invoiced'
  ));

CREATE OR REPLACE FUNCTION app_private.log_project_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.workflow_stage IS NOT NULL OR NEW.pipeline_type IS NOT NULL THEN
      INSERT INTO public.crm_project_stage_history
        (division_id, project_id, from_stage, to_stage, changed_by, note, from_pipeline_type, to_pipeline_type, override_used)
      VALUES
        (NEW.division_id, NEW.id, NULL, NEW.workflow_stage, (SELECT auth.uid()),
         NEW.workflow_stage_note, NULL, NEW.pipeline_type, NEW.workflow_stage_override);
    END IF;
  ELSIF NEW.workflow_stage IS DISTINCT FROM OLD.workflow_stage OR NEW.pipeline_type IS DISTINCT FROM OLD.pipeline_type THEN
    INSERT INTO public.crm_project_stage_history
      (division_id, project_id, from_stage, to_stage, changed_by, note, from_pipeline_type, to_pipeline_type, override_used)
    VALUES
      (NEW.division_id, NEW.id, OLD.workflow_stage, NEW.workflow_stage, (SELECT auth.uid()),
       NEW.workflow_stage_note, OLD.pipeline_type, NEW.pipeline_type, NEW.workflow_stage_override);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS crm_projects_log_stage_update ON public.crm_projects;
CREATE TRIGGER crm_projects_log_stage_update
  AFTER UPDATE OF workflow_stage, pipeline_type ON public.crm_projects
  FOR EACH ROW EXECUTE FUNCTION app_private.log_project_stage_change();

CREATE OR REPLACE FUNCTION public.crm_move_project_stage(
  p_project_id uuid,
  p_next_stage text,
  p_note text DEFAULT NULL,
  p_materials_order_reference text DEFAULT NULL,
  p_work_completed_at date DEFAULT NULL,
  p_authorized_override boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  project_row public.crm_projects%ROWTYPE;
  outstanding numeric(14,2);
  override_allowed boolean;
  needs_override boolean := false;
  final_note text := NULLIF(trim(COALESCE(p_note,'')), '');
BEGIN
  SELECT * INTO project_row FROM public.crm_projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR NOT app_private.has_division_resource_access(project_row.division_id, 'projects', true) THEN
    RAISE EXCEPTION 'Not authorized to update this project';
  END IF;
  IF project_row.pipeline_type IS NULL OR project_row.pipeline_type NOT IN ('retail','insurance') THEN
    RAISE EXCEPTION 'Assign a Retail or Insurance workflow before moving this project';
  END IF;
  IF p_next_stage IS NULL OR p_next_stage NOT IN (
    'new_lead','contacted','appointment_set','inspection_scheduled','inspection_completed',
    'estimate_prepared','bid_issued','awaiting_customer','scope_prepared','claim_filed',
    'adjuster_meeting_scheduled','adjuster_met_awaiting_approval','supplement_prepared',
    'supplement_submitted','supplement_under_review','supplement_approved',
    'supplement_partially_approved','supplement_denied','contract_signed','deposit_pending',
    'deposit_received','materials_ordered','materials_received','scheduled','in_progress',
    'work_completed','final_inspection','final_invoice_payment_pending','closed',
    'adjuster_meeting','awaiting_carrier','supplement_review','invoiced'
  ) THEN
    RAISE EXCEPTION 'Unknown project workflow stage';
  END IF;
  IF project_row.pipeline_type = 'retail' AND p_next_stage IN (
    'scope_prepared','claim_filed','adjuster_meeting_scheduled','adjuster_met_awaiting_approval',
    'supplement_prepared','supplement_submitted','supplement_under_review','supplement_approved',
    'supplement_partially_approved','supplement_denied','adjuster_meeting','awaiting_carrier','supplement_review'
  ) THEN
    RAISE EXCEPTION 'Insurance stages cannot be used on a Retail project';
  END IF;
  IF project_row.pipeline_type = 'insurance' AND p_next_stage IN ('estimate_prepared','bid_issued','awaiting_customer','deposit_pending','deposit_received') THEN
    RAISE EXCEPTION 'Retail stages cannot be used on an Insurance project';
  END IF;

  IF p_next_stage = 'materials_ordered' AND NULLIF(trim(COALESCE(p_materials_order_reference,'')), '') IS NULL THEN
    needs_override := true;
  END IF;
  IF p_next_stage = 'work_completed' AND p_work_completed_at IS NULL THEN
    needs_override := true;
  END IF;
  IF p_next_stage IN ('supplement_approved','supplement_partially_approved') AND COALESCE(project_row.supplements_approved_amount,0) <= 0 THEN
    needs_override := true;
  END IF;
  IF p_next_stage = 'closed' THEN
    outstanding := GREATEST(0, COALESCE(project_row.invoiced_amount,0) - COALESCE(project_row.collected_amount,0));
    IF outstanding > 0 THEN needs_override := true; END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.crm_memberships m
    WHERE m.user_id = (SELECT auth.uid())
      AND m.division_id = project_row.division_id
      AND m.active = true
      AND m.role IN ('owner','division_admin','office_manager')
  ) INTO override_allowed;

  IF needs_override AND (NOT p_authorized_override OR NOT override_allowed) THEN
    IF p_next_stage = 'materials_ordered' THEN
      RAISE EXCEPTION 'Record a purchase order or material order reference before moving to Materials Ordered. An authorized override is required to bypass this gate.';
    ELSIF p_next_stage = 'work_completed' THEN
      RAISE EXCEPTION 'Enter the work completion date before moving to Work Completed. An authorized override is required to bypass this gate.';
    ELSIF p_next_stage IN ('supplement_approved','supplement_partially_approved') THEN
      RAISE EXCEPTION 'Record a carrier-approved supplement amount before moving to an approved supplement stage. An authorized override is required to bypass this gate.';
    ELSE
      RAISE EXCEPTION 'This project has an outstanding invoice balance. An authorized override is required to close it.';
    END IF;
  END IF;
  IF p_authorized_override AND NOT override_allowed THEN
    RAISE EXCEPTION 'Your role is not authorized to override project stage gates';
  END IF;
  IF p_authorized_override AND NOT needs_override THEN
    RAISE EXCEPTION 'An override may only be used when a required stage gate is not satisfied';
  END IF;
  IF needs_override THEN
    final_note := concat_ws(' | ', 'AUTHORIZED OVERRIDE', final_note);
  END IF;

  UPDATE public.crm_projects
  SET workflow_stage = p_next_stage,
      materials_order_reference = CASE WHEN p_next_stage = 'materials_ordered' AND NULLIF(trim(COALESCE(p_materials_order_reference,'')), '') IS NOT NULL THEN trim(p_materials_order_reference) ELSE materials_order_reference END,
      materials_ordered_at = CASE WHEN p_next_stage = 'materials_ordered' AND NULLIF(trim(COALESCE(p_materials_order_reference,'')), '') IS NOT NULL THEN CURRENT_DATE ELSE materials_ordered_at END,
      work_completed_at = CASE WHEN p_next_stage = 'work_completed' AND p_work_completed_at IS NOT NULL THEN p_work_completed_at ELSE work_completed_at END,
      workflow_stage_note = final_note,
      workflow_stage_override = needs_override AND p_authorized_override,
      updated_at = now()
  WHERE id = p_project_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_move_project_stage(uuid,text,text,text,date,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_move_project_stage(uuid,text,text,text,date,boolean) TO authenticated;


-- Enforce the same stage gates for direct table updates, not only the UI RPC.
CREATE OR REPLACE FUNCTION app_private.enforce_project_stage_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  needs_override boolean := false;
  override_requested boolean;
BEGIN
  override_requested := NEW.workflow_stage_override AND (NOT OLD.workflow_stage_override OR NEW.workflow_stage_note IS DISTINCT FROM OLD.workflow_stage_note);
  IF NEW.pipeline_type IS DISTINCT FROM OLD.pipeline_type THEN
    IF NEW.pipeline_type IS NULL OR NEW.pipeline_type NOT IN ('retail','insurance') OR NEW.workflow_stage IS DISTINCT FROM 'new_lead' THEN
      RAISE EXCEPTION 'Assign or switch a project workflow by resetting its stage to New Lead';
    END IF;
    IF NEW.workflow_stage_override THEN
      RAISE EXCEPTION 'Workflow assignment cannot use a stage-gate override';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.workflow_stage IS NOT DISTINCT FROM OLD.workflow_stage THEN
    IF NEW.workflow_stage_override IS DISTINCT FROM OLD.workflow_stage_override AND NEW.workflow_stage_override THEN
      RAISE EXCEPTION 'An override can only be recorded with a stage transition';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.pipeline_type IS NULL OR NEW.pipeline_type NOT IN ('retail','insurance') OR NEW.workflow_stage IS NULL OR NEW.workflow_stage NOT IN (
    'new_lead','contacted','appointment_set','inspection_scheduled','inspection_completed',
    'estimate_prepared','bid_issued','awaiting_customer','scope_prepared','claim_filed',
    'adjuster_meeting_scheduled','adjuster_met_awaiting_approval','supplement_prepared',
    'supplement_submitted','supplement_under_review','supplement_approved',
    'supplement_partially_approved','supplement_denied','contract_signed','deposit_pending',
    'deposit_received','materials_ordered','materials_received','scheduled','in_progress',
    'work_completed','final_inspection','final_invoice_payment_pending','closed',
    'adjuster_meeting','awaiting_carrier','supplement_review','invoiced'
  ) THEN
    RAISE EXCEPTION 'Unknown project workflow stage or unassigned workflow';
  END IF;

  IF NEW.pipeline_type = 'retail' AND NEW.workflow_stage IN (
    'scope_prepared','claim_filed','adjuster_meeting_scheduled','adjuster_met_awaiting_approval',
    'supplement_prepared','supplement_submitted','supplement_under_review','supplement_approved',
    'supplement_partially_approved','supplement_denied','adjuster_meeting','awaiting_carrier','supplement_review'
  ) THEN
    RAISE EXCEPTION 'Insurance stages cannot be used on a Retail project';
  END IF;
  IF NEW.pipeline_type = 'insurance' AND NEW.workflow_stage IN (
    'estimate_prepared','bid_issued','awaiting_customer','deposit_pending','deposit_received'
  ) THEN
    RAISE EXCEPTION 'Retail stages cannot be used on an Insurance project';
  END IF;

  IF NEW.workflow_stage = 'materials_ordered' THEN
    IF NULLIF(trim(COALESCE(NEW.materials_order_reference,'')), '') IS NULL THEN
      needs_override := true;
    ELSE
      NEW.materials_ordered_at := COALESCE(NEW.materials_ordered_at, CURRENT_DATE);
    END IF;
  END IF;
  IF NEW.workflow_stage = 'work_completed' AND NEW.work_completed_at IS NULL THEN
    needs_override := true;
  END IF;
  IF NEW.workflow_stage IN ('supplement_approved','supplement_partially_approved')
     AND COALESCE(NEW.supplements_approved_amount,0) <= 0 THEN
    needs_override := true;
  END IF;
  IF NEW.workflow_stage = 'closed'
     AND GREATEST(0,COALESCE(NEW.invoiced_amount,0)-COALESCE(NEW.collected_amount,0)) > 0 THEN
    needs_override := true;
  END IF;

  IF needs_override THEN
    IF NOT override_requested OR NOT app_private.has_division_admin_access(NEW.division_id) THEN
      RAISE EXCEPTION 'This stage requires an authorized administrator override and a recorded reason';
    END IF;
    IF NEW.workflow_stage_note IS NULL OR NEW.workflow_stage_note NOT LIKE 'AUTHORIZED OVERRIDE | %' THEN
      RAISE EXCEPTION 'An authorized stage override requires a reason';
    END IF;
  ELSIF override_requested THEN
    RAISE EXCEPTION 'An override may only be used when a required stage gate is not satisfied';
  ELSE
    NEW.workflow_stage_override := false;
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.enforce_project_stage_gate() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS crm_projects_enforce_stage_gate ON public.crm_projects;
CREATE TRIGGER crm_projects_enforce_stage_gate
  BEFORE UPDATE OF workflow_stage, pipeline_type, workflow_stage_override ON public.crm_projects
  FOR EACH ROW EXECUTE FUNCTION app_private.enforce_project_stage_gate();


-- Keep a project's lead and insurance claim attached to the same customer, property and division.
CREATE OR REPLACE FUNCTION app_private.enforce_project_lead_claim_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  lead_row public.crm_leads%ROWTYPE;
  claim_row public.crm_claims%ROWTYPE;
BEGIN
  IF NEW.claim_id IS NOT NULL THEN
    SELECT * INTO claim_row FROM public.crm_claims WHERE id = NEW.claim_id;
    IF NOT FOUND
       OR claim_row.division_id IS DISTINCT FROM NEW.division_id
       OR claim_row.customer_id IS DISTINCT FROM NEW.customer_id
       OR claim_row.property_id IS DISTINCT FROM NEW.property_id THEN
      RAISE EXCEPTION 'The selected insurance claim must belong to this project customer, property and division';
    END IF;
    IF claim_row.project_id IS NOT NULL AND claim_row.project_id IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'This insurance claim is already linked to another project';
    END IF;
    IF claim_row.lead_id IS NOT NULL THEN
      IF NEW.lead_id IS NULL THEN
        NEW.lead_id := claim_row.lead_id;
      ELSIF NEW.lead_id IS DISTINCT FROM claim_row.lead_id THEN
        RAISE EXCEPTION 'The selected lead does not match the insurance claim';
      END IF;
    END IF;
  END IF;

  IF NEW.lead_id IS NOT NULL THEN
    SELECT * INTO lead_row FROM public.crm_leads WHERE id = NEW.lead_id;
    IF NOT FOUND
       OR lead_row.division_id IS DISTINCT FROM NEW.division_id
       OR lead_row.customer_id IS DISTINCT FROM NEW.customer_id
       OR (lead_row.property_id IS NOT NULL AND lead_row.property_id IS DISTINCT FROM NEW.property_id) THEN
      RAISE EXCEPTION 'The selected lead must belong to this project customer, property and division';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.enforce_project_lead_claim_links() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS crm_projects_enforce_lead_claim_links ON public.crm_projects;
CREATE TRIGGER crm_projects_enforce_lead_claim_links
  BEFORE INSERT OR UPDATE OF division_id, customer_id, property_id, lead_id, claim_id ON public.crm_projects
  FOR EACH ROW EXECUTE FUNCTION app_private.enforce_project_lead_claim_links();
