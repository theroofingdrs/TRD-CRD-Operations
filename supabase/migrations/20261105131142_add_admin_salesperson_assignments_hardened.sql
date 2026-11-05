-- Prevent assignments from being smuggled into record creation.
-- Assignment is deliberately a second step after customer-division links exist.
CREATE OR REPLACE FUNCTION app_private.guard_and_log_salesperson_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_old uuid;
  v_new uuid;
  v_division text;
  v_valid boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_to IS NOT NULL THEN
      RAISE EXCEPTION 'Create the CRM record first, then assign a salesperson.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'crm_leads' THEN
    v_old := OLD.assigned_to;
    v_new := NEW.assigned_to;
    v_division := NEW.division_id;
  ELSE
    v_old := OLD.assigned_to;
    v_new := NEW.assigned_to;
    SELECT cd.division_id INTO v_division
    FROM public.crm_customer_divisions cd
    WHERE cd.customer_id = NEW.id
    ORDER BY CASE cd.division_id WHEN 'TRD' THEN 1 ELSE 2 END
    LIMIT 1;
  END IF;

  IF v_old IS DISTINCT FROM v_new THEN
    IF NOT app_private.is_crm_owner() THEN
      RAISE EXCEPTION 'Only the full CRM admin can assign or reassign salespeople.'
        USING ERRCODE = '42501';
    END IF;

    IF v_new IS NOT NULL THEN
      IF TG_TABLE_NAME = 'crm_leads' THEN
        SELECT EXISTS (
          SELECT 1 FROM public.crm_memberships m
          WHERE m.user_id = v_new AND m.division_id = v_division
            AND m.role = 'sales_rep' AND m.active = true
        ) INTO v_valid;
      ELSE
        SELECT EXISTS (
          SELECT 1 FROM public.crm_memberships m
          JOIN public.crm_customer_divisions cd ON cd.division_id = m.division_id
          WHERE m.user_id = v_new AND cd.customer_id = NEW.id
            AND m.role = 'sales_rep' AND m.active = true
        ) INTO v_valid;
      END IF;
      IF NOT COALESCE(v_valid, false) THEN
        RAISE EXCEPTION 'The selected salesperson must have an active Sales Rep membership in the applicable division.'
          USING ERRCODE = '23514';
      END IF;
    END IF;

    INSERT INTO public.crm_assignment_history
      (entity_type, entity_id, division_id, previous_assignee, new_assignee, changed_by)
    VALUES (
      CASE WHEN TG_TABLE_NAME = 'crm_leads' THEN 'lead' ELSE 'customer' END,
      NEW.id,
      COALESCE(v_division, 'TRD'),
      v_old,
      v_new,
      (SELECT auth.uid())
    );
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS crm_customers_assignment_insert_guard ON public.crm_customers;
CREATE TRIGGER crm_customers_assignment_insert_guard
  BEFORE INSERT ON public.crm_customers
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_and_log_salesperson_assignment();

DROP TRIGGER IF EXISTS crm_leads_assignment_insert_guard ON public.crm_leads;
CREATE TRIGGER crm_leads_assignment_insert_guard
  BEFORE INSERT ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_and_log_salesperson_assignment();
