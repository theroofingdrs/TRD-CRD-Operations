-- Project pipeline and job costing foundation.
-- Additive only: existing customer, property, project, claim, proposal, and file records are preserved.
-- Apply only after the migration has been reviewed and tested. This file is not applied to production.

ALTER TABLE public.crm_projects
  ADD COLUMN IF NOT EXISTS pipeline_type text,
  ADD COLUMN IF NOT EXISTS workflow_stage text,
  ADD COLUMN IF NOT EXISTS next_action text,
  ADD COLUMN IF NOT EXISTS next_action_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS original_estimate_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS initial_approved_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS supplements_approved_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoiced_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS collected_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_method text,
  ADD COLUMN IF NOT EXISTS commission_rate numeric(8,4),
  ADD COLUMN IF NOT EXISTS commission_fixed_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS commission_salesperson_name text,
  ADD COLUMN IF NOT EXISTS commission_earned_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_paid_at date,
  ADD COLUMN IF NOT EXISTS overhead_method text,
  ADD COLUMN IF NOT EXISTS overhead_rate numeric(8,4),
  ADD COLUMN IF NOT EXISTS overhead_fixed_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS overhead_allocated_amount numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.crm_projects
  ADD CONSTRAINT crm_projects_pipeline_type_check
    CHECK (pipeline_type IS NULL OR pipeline_type IN ('retail','insurance')),
  ADD CONSTRAINT crm_projects_money_nonnegative_check
    CHECK (
      (original_estimate_amount IS NULL OR original_estimate_amount >= 0)
      AND (initial_approved_amount IS NULL OR initial_approved_amount >= 0)
      AND supplements_approved_amount >= 0
      AND invoiced_amount >= 0
      AND collected_amount >= 0
      AND commission_earned_amount >= 0
      AND commission_paid_amount >= 0
      AND commission_paid_amount <= commission_earned_amount
      AND (commission_rate IS NULL OR commission_rate >= 0)
      AND (commission_fixed_amount IS NULL OR commission_fixed_amount >= 0)
      AND (overhead_rate IS NULL OR overhead_rate >= 0)
      AND (overhead_fixed_amount IS NULL OR overhead_fixed_amount >= 0)
      AND overhead_allocated_amount >= 0
    ),
  ADD CONSTRAINT crm_projects_commission_method_check
    CHECK (commission_method IS NULL OR commission_method IN ('fixed','contract_percent','collected_percent','gross_profit_percent','manual')),
  ADD CONSTRAINT crm_projects_overhead_method_check
    CHECK (overhead_method IS NULL OR overhead_method IN ('flat','contract_percent','direct_cost_percent','manual'));

CREATE INDEX IF NOT EXISTS crm_projects_pipeline_idx
  ON public.crm_projects (division_id, pipeline_type, workflow_stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS crm_projects_next_action_idx
  ON public.crm_projects (division_id, next_action_due_at)
  WHERE next_action_due_at IS NOT NULL;


CREATE OR REPLACE FUNCTION app_private.has_division_admin_access(p_division_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_memberships m
    WHERE m.user_id = (SELECT auth.uid())
      AND m.division_id = p_division_id
      AND m.active = true
      AND m.role IN ('owner','division_admin','office_manager')
  );
$function$;
REVOKE ALL ON FUNCTION app_private.has_division_admin_access(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.has_division_admin_access(text) TO authenticated;

CREATE TABLE public.crm_workflow_stage_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL REFERENCES public.crm_divisions(id),
  pipeline_type text NOT NULL CHECK (pipeline_type IN ('retail','insurance')),
  stage_key text NOT NULL CHECK (stage_key IN (
    'new_lead','contacted','inspection_scheduled','inspection_completed','estimate_prepared',
    'bid_issued','awaiting_customer','scope_prepared','claim_filed','adjuster_meeting',
    'awaiting_carrier','supplement_review','contract_signed','deposit_received',
    'materials_ordered','materials_received','scheduled','in_progress','final_inspection',
    'invoiced','closed'
  )),
  display_label text NOT NULL CHECK (length(trim(display_label)) BETWEEN 1 AND 80),
  sort_order integer NOT NULL DEFAULT 0,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (division_id, pipeline_type, stage_key)
);
ALTER TABLE public.crm_workflow_stage_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_workflow_stage_settings_read ON public.crm_workflow_stage_settings
  FOR SELECT TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'projects', false));
CREATE POLICY crm_workflow_stage_settings_insert ON public.crm_workflow_stage_settings
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.has_division_admin_access(division_id)
    AND (updated_by IS NULL OR updated_by = (SELECT auth.uid()))
  );
CREATE POLICY crm_workflow_stage_settings_update ON public.crm_workflow_stage_settings
  FOR UPDATE TO authenticated
  USING (app_private.has_division_admin_access(division_id))
  WITH CHECK (app_private.has_division_admin_access(division_id));
GRANT SELECT, INSERT, UPDATE ON public.crm_workflow_stage_settings TO authenticated;

CREATE TABLE public.crm_project_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL REFERENCES public.crm_divisions(id),
  project_id uuid NOT NULL REFERENCES public.crm_projects(id),
  from_stage text,
  to_stage text NOT NULL,
  changed_by uuid REFERENCES auth.users(id),
  note text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_project_stage_history_project_idx
  ON public.crm_project_stage_history (project_id, changed_at DESC);
ALTER TABLE public.crm_project_stage_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_project_stage_history_read ON public.crm_project_stage_history
  FOR SELECT TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'projects', false));
CREATE POLICY crm_project_stage_history_insert ON public.crm_project_stage_history
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.has_division_resource_access(division_id, 'projects', true)
    AND (changed_by IS NULL OR changed_by = (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.crm_projects p
      WHERE p.id = crm_project_stage_history.project_id AND p.division_id = crm_project_stage_history.division_id
    )
  );
GRANT SELECT ON public.crm_project_stage_history TO authenticated;

CREATE OR REPLACE FUNCTION app_private.log_project_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.workflow_stage IS NOT NULL THEN
      INSERT INTO public.crm_project_stage_history
        (division_id, project_id, from_stage, to_stage, changed_by)
      VALUES
        (NEW.division_id, NEW.id, NULL, NEW.workflow_stage, (SELECT auth.uid()));
    END IF;
  ELSIF NEW.workflow_stage IS DISTINCT FROM OLD.workflow_stage THEN
    INSERT INTO public.crm_project_stage_history
      (division_id, project_id, from_stage, to_stage, changed_by)
    VALUES
      (NEW.division_id, NEW.id, OLD.workflow_stage, NEW.workflow_stage, (SELECT auth.uid()));
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.log_project_stage_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER crm_projects_log_stage_insert
  AFTER INSERT ON public.crm_projects
  FOR EACH ROW EXECUTE FUNCTION app_private.log_project_stage_change();
CREATE TRIGGER crm_projects_log_stage_update
  AFTER UPDATE OF workflow_stage ON public.crm_projects
  FOR EACH ROW EXECUTE FUNCTION app_private.log_project_stage_change();


CREATE TABLE public.crm_project_supplements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL REFERENCES public.crm_divisions(id),
  project_id uuid NOT NULL REFERENCES public.crm_projects(id),
  supplement_number integer NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','under_review','approved','partially_approved','denied','resubmitted')),
  requested_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (requested_amount >= 0),
  approved_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (approved_amount >= 0),
  submitted_at timestamptz,
  response_at timestamptz,
  carrier_response text,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, supplement_number)
);
CREATE INDEX crm_project_supplements_project_idx
  ON public.crm_project_supplements (project_id, supplement_number);
ALTER TABLE public.crm_project_supplements ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_project_supplements_read ON public.crm_project_supplements
  FOR SELECT TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'projects', false));
CREATE POLICY crm_project_supplements_insert ON public.crm_project_supplements
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.has_division_resource_access(division_id, 'projects', true)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND EXISTS (SELECT 1 FROM public.crm_projects p WHERE p.id = crm_project_supplements.project_id AND p.division_id = crm_project_supplements.division_id AND p.pipeline_type = 'insurance')
  );
CREATE POLICY crm_project_supplements_update ON public.crm_project_supplements
  FOR UPDATE TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'projects', true))
  WITH CHECK (
    app_private.has_division_resource_access(division_id, 'projects', true)
    AND EXISTS (SELECT 1 FROM public.crm_projects p WHERE p.id = crm_project_supplements.project_id AND p.division_id = crm_project_supplements.division_id AND p.pipeline_type = 'insurance')
  );
GRANT SELECT, INSERT, UPDATE ON public.crm_project_supplements TO authenticated;

CREATE OR REPLACE FUNCTION app_private.has_division_financial_access(p_division_id text, p_write boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.crm_memberships m
    WHERE m.user_id = (SELECT auth.uid())
      AND m.division_id = p_division_id
      AND m.active = true
      AND (
        NOT p_write
        OR m.role IN ('owner','division_admin','office_manager','project_manager','accounting')
      )
  );
$function$;
REVOKE ALL ON FUNCTION app_private.has_division_financial_access(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.has_division_financial_access(text, boolean) TO authenticated;

CREATE TABLE public.crm_project_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL REFERENCES public.crm_divisions(id),
  project_id uuid NOT NULL REFERENCES public.crm_projects(id),
  category text NOT NULL
    CHECK (category IN ('materials','labor','equipment','permits','sales_commission','overhead','other')),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  vendor_payee text,
  description text,
  payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid','partially_paid','paid','void')),
  paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0 AND paid_amount <= amount),
  receipt_file_id uuid REFERENCES public.crm_files(id),
  entered_by uuid REFERENCES auth.users(id),
  notes text,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((payment_status <> 'void') OR (void_reason IS NOT NULL AND length(trim(void_reason)) > 0))
);
CREATE INDEX crm_project_expenses_project_date_idx
  ON public.crm_project_expenses (project_id, expense_date DESC);
CREATE INDEX crm_project_expenses_division_status_idx
  ON public.crm_project_expenses (division_id, payment_status, expense_date DESC);
ALTER TABLE public.crm_project_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_project_expenses_read ON public.crm_project_expenses
  FOR SELECT TO authenticated
  USING (app_private.has_division_financial_access(division_id, false));
CREATE POLICY crm_project_expenses_insert ON public.crm_project_expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.has_division_financial_access(division_id, true)
    AND (entered_by IS NULL OR entered_by = (SELECT auth.uid()))
    AND EXISTS (SELECT 1 FROM public.crm_projects p WHERE p.id = crm_project_expenses.project_id AND p.division_id = crm_project_expenses.division_id)
    AND (receipt_file_id IS NULL OR EXISTS (
      SELECT 1 FROM public.crm_files f
      WHERE f.id = crm_project_expenses.receipt_file_id AND f.division_id = crm_project_expenses.division_id
        AND f.related_type = 'project' AND f.related_id = project_id
    ))
  );
CREATE POLICY crm_project_expenses_update ON public.crm_project_expenses
  FOR UPDATE TO authenticated
  USING (app_private.has_division_financial_access(division_id, true))
  WITH CHECK (
    app_private.has_division_financial_access(division_id, true)
    AND EXISTS (SELECT 1 FROM public.crm_projects p WHERE p.id = crm_project_expenses.project_id AND p.division_id = crm_project_expenses.division_id)
    AND (receipt_file_id IS NULL OR EXISTS (
      SELECT 1 FROM public.crm_files f
      WHERE f.id = crm_project_expenses.receipt_file_id
        AND f.division_id = crm_project_expenses.division_id
        AND f.related_type = 'project'
        AND f.related_id = crm_project_expenses.project_id
    ))
  );
GRANT SELECT, INSERT, UPDATE ON public.crm_project_expenses TO authenticated;

CREATE TABLE public.crm_division_financial_settings (
  division_id text PRIMARY KEY REFERENCES public.crm_divisions(id),
  default_commission_method text
    CHECK (default_commission_method IS NULL OR default_commission_method IN ('fixed','contract_percent','collected_percent','gross_profit_percent','manual')),
  default_commission_rate numeric(8,4),
  default_commission_fixed_amount numeric(14,2),
  default_overhead_method text
    CHECK (default_overhead_method IS NULL OR default_overhead_method IN ('flat','contract_percent','direct_cost_percent','manual')),
  default_overhead_rate numeric(8,4),
  default_overhead_fixed_amount numeric(14,2),
  stale_stage_days integer NOT NULL DEFAULT 7 CHECK (stale_stage_days BETWEEN 1 AND 365),
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (default_commission_rate IS NULL OR default_commission_rate >= 0),
  CHECK (default_commission_fixed_amount IS NULL OR default_commission_fixed_amount >= 0),
  CHECK (default_overhead_rate IS NULL OR default_overhead_rate >= 0),
  CHECK (default_overhead_fixed_amount IS NULL OR default_overhead_fixed_amount >= 0)
);
ALTER TABLE public.crm_division_financial_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_division_financial_settings_read ON public.crm_division_financial_settings
  FOR SELECT TO authenticated
  USING (app_private.has_division_financial_access(division_id, false));
CREATE POLICY crm_division_financial_settings_write ON public.crm_division_financial_settings
  FOR ALL TO authenticated
  USING (app_private.has_division_admin_access(division_id))
  WITH CHECK (app_private.has_division_admin_access(division_id));
GRANT SELECT, INSERT, UPDATE ON public.crm_division_financial_settings TO authenticated;


-- Allow accounting to upload and read only receipt files attached to projects.
CREATE POLICY crm_files_expense_receipt_insert ON public.crm_files
  FOR INSERT TO authenticated
  WITH CHECK (
    related_type = 'project'
    AND metadata->>'document_category' = 'expense_receipt'
    AND app_private.has_division_financial_access(division_id, true)
    AND (uploaded_by IS NULL OR uploaded_by = (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.crm_projects p
      WHERE p.id = crm_files.related_id AND p.division_id = crm_files.division_id
    )
  );
CREATE POLICY crm_files_expense_receipt_read ON public.crm_files
  FOR SELECT TO authenticated
  USING (
    related_type = 'project'
    AND metadata->>'document_category' = 'expense_receipt'
    AND app_private.has_division_financial_access(division_id, false)
    AND EXISTS (
      SELECT 1 FROM public.crm_project_expenses e
      WHERE e.receipt_file_id = crm_files.id AND e.division_id = crm_files.division_id
    )
  );

CREATE POLICY project_expense_receipts_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'roof-doctors-private'
    AND (storage.foldername(name))[1] IN ('TRD','CRD')
    AND EXISTS (
      SELECT 1 FROM public.crm_projects p
      WHERE p.id::text = (storage.foldername(name))[2]
        AND p.division_id = (storage.foldername(name))[1]
        AND app_private.has_division_financial_access(p.division_id, true)
    )
  );
CREATE POLICY project_expense_receipts_storage_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'roof-doctors-private'
    AND (storage.foldername(name))[1] IN ('TRD','CRD')
    AND EXISTS (
      SELECT 1 FROM public.crm_projects p
      WHERE p.id::text = (storage.foldername(name))[2]
        AND p.division_id = (storage.foldername(name))[1]
        AND app_private.has_division_financial_access(p.division_id, false)
    )
  );

CREATE TABLE public.crm_project_financial_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL REFERENCES public.crm_divisions(id),
  project_id uuid NOT NULL REFERENCES public.crm_projects(id),
  changed_by uuid REFERENCES auth.users(id),
  before_values jsonb NOT NULL,
  after_values jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_project_financial_history_project_idx
  ON public.crm_project_financial_history (project_id, changed_at DESC);
ALTER TABLE public.crm_project_financial_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_project_financial_history_read ON public.crm_project_financial_history
  FOR SELECT TO authenticated
  USING (app_private.has_division_financial_access(division_id, false));
CREATE POLICY crm_project_financial_history_insert ON public.crm_project_financial_history
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.has_division_financial_access(division_id, true)
    AND (changed_by IS NULL OR changed_by = (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.crm_projects p
      WHERE p.id = crm_project_financial_history.project_id
        AND p.division_id = crm_project_financial_history.division_id
    )
  );
GRANT SELECT ON public.crm_project_financial_history TO authenticated;

CREATE OR REPLACE FUNCTION app_private.log_project_financial_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  before_data jsonb;
  after_data jsonb;
BEGIN
  before_data := jsonb_build_object(
    'contract_amount', OLD.contract_amount,
    'initial_approved_amount', OLD.initial_approved_amount,
    'supplements_approved_amount', OLD.supplements_approved_amount,
    'invoiced_amount', OLD.invoiced_amount,
    'collected_amount', OLD.collected_amount,
    'commission_method', OLD.commission_method,
    'commission_rate', OLD.commission_rate,
    'commission_fixed_amount', OLD.commission_fixed_amount,
    'commission_salesperson_name', OLD.commission_salesperson_name,
    'commission_earned_amount', OLD.commission_earned_amount,
    'commission_paid_amount', OLD.commission_paid_amount,
    'commission_paid_at', OLD.commission_paid_at,
    'overhead_method', OLD.overhead_method,
    'overhead_rate', OLD.overhead_rate,
    'overhead_fixed_amount', OLD.overhead_fixed_amount,
    'overhead_allocated_amount', OLD.overhead_allocated_amount
  );
  after_data := jsonb_build_object(
    'contract_amount', NEW.contract_amount,
    'initial_approved_amount', NEW.initial_approved_amount,
    'supplements_approved_amount', NEW.supplements_approved_amount,
    'invoiced_amount', NEW.invoiced_amount,
    'collected_amount', NEW.collected_amount,
    'commission_method', NEW.commission_method,
    'commission_rate', NEW.commission_rate,
    'commission_fixed_amount', NEW.commission_fixed_amount,
    'commission_salesperson_name', NEW.commission_salesperson_name,
    'commission_earned_amount', NEW.commission_earned_amount,
    'commission_paid_amount', NEW.commission_paid_amount,
    'commission_paid_at', NEW.commission_paid_at,
    'overhead_method', NEW.overhead_method,
    'overhead_rate', NEW.overhead_rate,
    'overhead_fixed_amount', NEW.overhead_fixed_amount,
    'overhead_allocated_amount', NEW.overhead_allocated_amount
  );
  IF before_data IS DISTINCT FROM after_data THEN
    INSERT INTO public.crm_project_financial_history
      (division_id, project_id, changed_by, before_values, after_values)
    VALUES
      (NEW.division_id, NEW.id, (SELECT auth.uid()), before_data, after_data);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER crm_projects_log_financial_change
  AFTER UPDATE OF contract_amount, initial_approved_amount, supplements_approved_amount, invoiced_amount, collected_amount,
    commission_method, commission_rate, commission_fixed_amount, commission_salesperson_name,
    commission_earned_amount, commission_paid_amount, commission_paid_at, overhead_method, overhead_rate,
    overhead_fixed_amount, overhead_allocated_amount
  ON public.crm_projects
  FOR EACH ROW EXECUTE FUNCTION app_private.log_project_financial_change();



CREATE TABLE public.crm_project_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL REFERENCES public.crm_divisions(id),
  project_id uuid NOT NULL REFERENCES public.crm_projects(id),
  transaction_type text NOT NULL CHECK (transaction_type IN ('invoice','payment')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  transaction_date date NOT NULL DEFAULT CURRENT_DATE,
  reference_number text,
  payment_method text,
  notes text,
  status text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded','void')),
  void_reason text,
  entered_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'void' OR (void_reason IS NOT NULL AND length(trim(void_reason)) > 0))
);
CREATE INDEX crm_project_transactions_project_date_idx
  ON public.crm_project_transactions (project_id, transaction_date DESC);
CREATE INDEX crm_project_transactions_division_date_idx
  ON public.crm_project_transactions (division_id, transaction_type, transaction_date DESC)
  WHERE status = 'recorded';
ALTER TABLE public.crm_project_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_project_transactions_read ON public.crm_project_transactions
  FOR SELECT TO authenticated
  USING (app_private.has_division_financial_access(division_id, false));
CREATE POLICY crm_project_transactions_insert ON public.crm_project_transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.has_division_financial_access(division_id, true)
    AND (entered_by IS NULL OR entered_by = (SELECT auth.uid()))
    AND EXISTS (SELECT 1 FROM public.crm_projects p WHERE p.id = crm_project_transactions.project_id AND p.division_id = crm_project_transactions.division_id)
  );
CREATE POLICY crm_project_transactions_update ON public.crm_project_transactions
  FOR UPDATE TO authenticated
  USING (app_private.has_division_financial_access(division_id, true))
  WITH CHECK (
    app_private.has_division_financial_access(division_id, true)
    AND EXISTS (SELECT 1 FROM public.crm_projects p WHERE p.id = crm_project_transactions.project_id AND p.division_id = crm_project_transactions.division_id)
  );
GRANT SELECT, INSERT, UPDATE ON public.crm_project_transactions TO authenticated;


CREATE TABLE public.crm_project_transaction_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL REFERENCES public.crm_divisions(id),
  project_id uuid NOT NULL REFERENCES public.crm_projects(id),
  transaction_id uuid NOT NULL REFERENCES public.crm_project_transactions(id),
  changed_by uuid REFERENCES auth.users(id),
  before_values jsonb NOT NULL,
  after_values jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_project_transaction_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_project_transaction_history_read ON public.crm_project_transaction_history
  FOR SELECT TO authenticated USING (app_private.has_division_financial_access(division_id, false));
CREATE POLICY crm_project_transaction_history_insert ON public.crm_project_transaction_history
  FOR INSERT TO authenticated WITH CHECK (
    app_private.has_division_financial_access(division_id, true)
    AND EXISTS (
      SELECT 1 FROM public.crm_project_transactions t
      WHERE t.id = crm_project_transaction_history.transaction_id
        AND t.project_id = crm_project_transaction_history.project_id
        AND t.division_id = crm_project_transaction_history.division_id
    )
  );
GRANT SELECT ON public.crm_project_transaction_history TO authenticated;

CREATE OR REPLACE FUNCTION app_private.log_project_transaction_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.crm_project_transaction_history
    (division_id, project_id, transaction_id, changed_by, before_values, after_values)
  VALUES
    (NEW.division_id, NEW.project_id, NEW.id, (SELECT auth.uid()), to_jsonb(OLD), to_jsonb(NEW));
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.log_project_transaction_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER crm_project_transactions_log_update
  AFTER UPDATE ON public.crm_project_transactions
  FOR EACH ROW EXECUTE FUNCTION app_private.log_project_transaction_change();

CREATE OR REPLACE FUNCTION app_private.sync_project_transaction_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  target_project_id uuid;
  target_division_id text;
  invoice_total numeric(14,2);
  payment_total numeric(14,2);
BEGIN
  target_project_id := NEW.project_id;
  target_division_id := NEW.division_id;
  IF TG_OP = 'UPDATE' AND (NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.division_id IS DISTINCT FROM OLD.division_id) THEN
    RAISE EXCEPTION 'Transaction project and division cannot be changed';
  END IF;
  IF NOT app_private.has_division_financial_access(target_division_id, true) THEN
    RAISE EXCEPTION 'Not authorized to update project financial transactions';
  END IF;
  SELECT
    COALESCE(sum(amount) FILTER (WHERE transaction_type = 'invoice'), 0),
    COALESCE(sum(amount) FILTER (WHERE transaction_type = 'payment'), 0)
  INTO invoice_total, payment_total
  FROM public.crm_project_transactions
  WHERE project_id = target_project_id AND status = 'recorded';
  UPDATE public.crm_projects
  SET invoiced_amount = invoice_total,
      collected_amount = payment_total,
      updated_at = now()
  WHERE id = target_project_id AND division_id = target_division_id;
  RETURN NEW;
END;
$function$;
-- Preserve existing balances before enabling the authenticated-user transaction trigger.
INSERT INTO public.crm_project_transactions
  (division_id, project_id, transaction_type, amount, transaction_date, reference_number, notes, entered_by)
SELECT division_id, id, 'invoice', invoiced_amount, created_at::date,
       'Opening balance', 'Migrated from the existing project invoiced amount.', created_by
FROM public.crm_projects
WHERE invoiced_amount > 0;
INSERT INTO public.crm_project_transactions
  (division_id, project_id, transaction_type, amount, transaction_date, reference_number, notes, entered_by)
SELECT division_id, id, 'payment', collected_amount, created_at::date,
       'Opening balance', 'Migrated from the existing project collected amount.', created_by
FROM public.crm_projects
WHERE collected_amount > 0;

-- Initialize project totals from the opening ledger entries, then enable the authenticated-user trigger.
UPDATE public.crm_projects p
SET invoiced_amount = COALESCE((
      SELECT sum(t.amount) FROM public.crm_project_transactions t
      WHERE t.project_id = p.id AND t.transaction_type = 'invoice' AND t.status = 'recorded'
    ), 0),
    collected_amount = COALESCE((
      SELECT sum(t.amount) FROM public.crm_project_transactions t
      WHERE t.project_id = p.id AND t.transaction_type = 'payment' AND t.status = 'recorded'
    ), 0);

CREATE TRIGGER crm_project_transactions_sync_totals
  AFTER INSERT OR UPDATE ON public.crm_project_transactions
  FOR EACH ROW EXECUTE FUNCTION app_private.sync_project_transaction_totals();

-- Accounting can update only the financial fields through this narrowly scoped RPC.
CREATE OR REPLACE FUNCTION public.crm_update_project_financials(
  p_project_id uuid,
  p_contract_amount numeric,
  p_initial_approved_amount numeric,
  p_commission_method text,
  p_commission_rate numeric,
  p_commission_fixed_amount numeric,
  p_commission_salesperson_name text,
  p_commission_earned_amount numeric,
  p_commission_paid_amount numeric,
  p_commission_paid_at date,
  p_overhead_method text,
  p_overhead_rate numeric,
  p_overhead_fixed_amount numeric,
  p_overhead_allocated_amount numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  target_division_id text;
BEGIN
  SELECT division_id INTO target_division_id
  FROM public.crm_projects WHERE id = p_project_id;
  IF target_division_id IS NULL
     OR NOT app_private.has_division_financial_access(target_division_id, true) THEN
    RAISE EXCEPTION 'Not authorized to update project financials';
  END IF;
  IF COALESCE(p_contract_amount, 0) < 0
     OR COALESCE(p_initial_approved_amount, 0) < 0
     OR COALESCE(p_commission_earned_amount, 0) < 0
     OR COALESCE(p_commission_paid_amount, 0) < 0
     OR COALESCE(p_overhead_allocated_amount, 0) < 0
     OR COALESCE(p_commission_paid_amount, 0) > COALESCE(p_commission_earned_amount, 0) THEN
    RAISE EXCEPTION 'Invalid financial amounts';
  END IF;
  IF p_commission_method IS NOT NULL AND p_commission_method NOT IN ('fixed','contract_percent','collected_percent','gross_profit_percent','manual') THEN
    RAISE EXCEPTION 'Invalid commission method';
  END IF;
  IF p_overhead_method IS NOT NULL AND p_overhead_method NOT IN ('flat','contract_percent','direct_cost_percent','manual') THEN
    RAISE EXCEPTION 'Invalid overhead method';
  END IF;
  UPDATE public.crm_projects SET
    contract_amount = p_contract_amount,
    initial_approved_amount = p_initial_approved_amount,
    commission_method = p_commission_method,
    commission_rate = p_commission_rate,
    commission_fixed_amount = p_commission_fixed_amount,
    commission_salesperson_name = p_commission_salesperson_name,
    commission_earned_amount = COALESCE(p_commission_earned_amount, 0),
    commission_paid_amount = COALESCE(p_commission_paid_amount, 0),
    commission_paid_at = p_commission_paid_at,
    overhead_method = p_overhead_method,
    overhead_rate = p_overhead_rate,
    overhead_fixed_amount = p_overhead_fixed_amount,
    overhead_allocated_amount = COALESCE(p_overhead_allocated_amount, 0),
    updated_at = now()
  WHERE id = p_project_id AND division_id = target_division_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.crm_update_project_financials(uuid,numeric,numeric,text,numeric,numeric,text,numeric,numeric,date,text,numeric,numeric,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_update_project_financials(uuid,numeric,numeric,text,numeric,numeric,text,numeric,numeric,date,text,numeric,numeric,numeric) TO authenticated;

CREATE TABLE public.crm_project_expense_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL REFERENCES public.crm_divisions(id),
  project_id uuid NOT NULL REFERENCES public.crm_projects(id),
  expense_id uuid NOT NULL REFERENCES public.crm_project_expenses(id),
  changed_by uuid REFERENCES auth.users(id),
  before_values jsonb NOT NULL,
  after_values jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_project_expense_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_project_expense_history_read ON public.crm_project_expense_history
  FOR SELECT TO authenticated USING (app_private.has_division_financial_access(division_id, false));
CREATE POLICY crm_project_expense_history_insert ON public.crm_project_expense_history
  FOR INSERT TO authenticated WITH CHECK (
    app_private.has_division_financial_access(division_id, true)
    AND EXISTS (
      SELECT 1 FROM public.crm_project_expenses e
      WHERE e.id = crm_project_expense_history.expense_id
        AND e.project_id = crm_project_expense_history.project_id
        AND e.division_id = crm_project_expense_history.division_id
    )
  );
GRANT SELECT ON public.crm_project_expense_history TO authenticated;

CREATE OR REPLACE FUNCTION app_private.log_project_expense_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.crm_project_expense_history
    (division_id, project_id, expense_id, changed_by, before_values, after_values)
  VALUES
    (NEW.division_id, NEW.project_id, NEW.id, (SELECT auth.uid()), to_jsonb(OLD), to_jsonb(NEW));
  RETURN NEW;
END;
$function$;
CREATE TRIGGER crm_project_expenses_log_update
  AFTER UPDATE ON public.crm_project_expenses
  FOR EACH ROW EXECUTE FUNCTION app_private.log_project_expense_change();

CREATE TABLE public.crm_project_supplement_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL REFERENCES public.crm_divisions(id),
  project_id uuid NOT NULL REFERENCES public.crm_projects(id),
  supplement_id uuid NOT NULL REFERENCES public.crm_project_supplements(id),
  changed_by uuid REFERENCES auth.users(id),
  before_values jsonb NOT NULL,
  after_values jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_project_supplement_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_project_supplement_history_read ON public.crm_project_supplement_history
  FOR SELECT TO authenticated USING (app_private.has_division_resource_access(division_id, 'projects', false));
CREATE POLICY crm_project_supplement_history_insert ON public.crm_project_supplement_history
  FOR INSERT TO authenticated WITH CHECK (
    app_private.has_division_resource_access(division_id, 'projects', true)
    AND EXISTS (
      SELECT 1 FROM public.crm_project_supplements s
      WHERE s.id = crm_project_supplement_history.supplement_id
        AND s.project_id = crm_project_supplement_history.project_id
        AND s.division_id = crm_project_supplement_history.division_id
    )
  );
GRANT SELECT ON public.crm_project_supplement_history TO authenticated;

CREATE OR REPLACE FUNCTION app_private.sync_project_supplement_approvals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  target_project_id uuid;
  target_division_id text;
  approved_total numeric(14,2);
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.division_id IS DISTINCT FROM OLD.division_id) THEN
    RAISE EXCEPTION 'A supplement cannot be moved to another project or division';
  END IF;
  target_project_id := NEW.project_id;
  target_division_id := NEW.division_id;
  IF NOT app_private.has_division_resource_access(target_division_id, 'projects', true) THEN
    RAISE EXCEPTION 'Not authorized to update supplement approvals';
  END IF;
  SELECT COALESCE(sum(approved_amount), 0)
    INTO approved_total
  FROM public.crm_project_supplements
  WHERE project_id = target_project_id;
  UPDATE public.crm_projects
  SET supplements_approved_amount = approved_total,
      updated_at = now()
  WHERE id = target_project_id AND division_id = target_division_id;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.sync_project_supplement_approvals() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER crm_project_supplements_sync_approvals
  AFTER INSERT OR UPDATE ON public.crm_project_supplements
  FOR EACH ROW EXECUTE FUNCTION app_private.sync_project_supplement_approvals();

CREATE OR REPLACE FUNCTION app_private.log_project_supplement_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.crm_project_supplement_history
    (division_id, project_id, supplement_id, changed_by, before_values, after_values)
  VALUES
    (NEW.division_id, NEW.project_id, NEW.id, (SELECT auth.uid()), to_jsonb(OLD), to_jsonb(NEW));
  RETURN NEW;
END;
$function$;
CREATE TRIGGER crm_project_supplements_log_update
  AFTER UPDATE ON public.crm_project_supplements
  FOR EACH ROW EXECUTE FUNCTION app_private.log_project_supplement_change();


CREATE TABLE public.crm_project_cost_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL REFERENCES public.crm_divisions(id),
  project_id uuid NOT NULL REFERENCES public.crm_projects(id),
  category text NOT NULL CHECK (category IN ('materials','labor','equipment','permits','sales_commission','overhead','other')),
  estimated_amount numeric(14,2) NOT NULL CHECK (estimated_amount >= 0),
  notes text,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, category)
);
ALTER TABLE public.crm_project_cost_estimates ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_project_cost_estimates_read ON public.crm_project_cost_estimates
  FOR SELECT TO authenticated USING (app_private.has_division_financial_access(division_id, false));
CREATE POLICY crm_project_cost_estimates_insert ON public.crm_project_cost_estimates
  FOR INSERT TO authenticated WITH CHECK (
    app_private.has_division_financial_access(division_id, true)
    AND (updated_by IS NULL OR updated_by = (SELECT auth.uid()))
    AND EXISTS (SELECT 1 FROM public.crm_projects p WHERE p.id = crm_project_cost_estimates.project_id AND p.division_id = crm_project_cost_estimates.division_id)
  );
CREATE POLICY crm_project_cost_estimates_update ON public.crm_project_cost_estimates
  FOR UPDATE TO authenticated USING (app_private.has_division_financial_access(division_id, true))
  WITH CHECK (
    app_private.has_division_financial_access(division_id, true)
    AND EXISTS (SELECT 1 FROM public.crm_projects p WHERE p.id = crm_project_cost_estimates.project_id AND p.division_id = crm_project_cost_estimates.division_id)
  );
GRANT SELECT, INSERT, UPDATE ON public.crm_project_cost_estimates TO authenticated;

CREATE POLICY crm_files_supplement_attachment_insert ON public.crm_files
  FOR INSERT TO authenticated
  WITH CHECK (
    related_type = 'supplement'
    AND metadata->>'document_category' = 'supplement_attachment'
    AND app_private.has_division_resource_access(division_id, 'projects', true)
    AND (uploaded_by IS NULL OR uploaded_by = (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.crm_project_supplements s
      JOIN public.crm_projects p ON p.id = s.project_id
      WHERE s.id = crm_files.related_id AND p.division_id = crm_files.division_id
    )
  );
CREATE POLICY crm_files_supplement_attachment_read ON public.crm_files
  FOR SELECT TO authenticated
  USING (
    related_type = 'supplement'
    AND metadata->>'document_category' = 'supplement_attachment'
    AND app_private.has_division_resource_access(division_id, 'projects', false)
    AND EXISTS (
      SELECT 1 FROM public.crm_project_supplements s
      JOIN public.crm_projects p ON p.id = s.project_id
      WHERE s.id = crm_files.related_id AND p.division_id = crm_files.division_id
    )
  );

-- Receipt uploads reuse the existing private file bucket and metadata table.

-- Audit rows are written only by protected SECURITY DEFINER triggers, never by client inserts.
REVOKE ALL ON FUNCTION app_private.log_project_stage_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.log_project_financial_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.log_project_expense_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.log_project_supplement_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.log_project_transaction_change() FROM PUBLIC, anon, authenticated;
