-- Keep browser-created leads unassigned, but allow the trusted SECURITY DEFINER
-- website-intake processor to set its validated operator during atomic delivery.
CREATE OR REPLACE FUNCTION app_private.guard_lead_assignment_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.assigned_to IS NOT NULL AND current_user <> 'postgres' THEN
    RAISE EXCEPTION 'Create the CRM lead first, then assign a salesperson.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS crm_leads_assignment_insert_guard ON public.crm_leads;
CREATE TRIGGER crm_leads_assignment_insert_guard
  BEFORE INSERT ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_lead_assignment_insert();
