-- Expose only the assigned salesperson display name to users who can view a CRM record.
CREATE OR REPLACE FUNCTION public.crm_assigned_salesperson_name(
  p_entity_type text,
  p_entity_id uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_assigned_to uuid;
  v_division_id text;
  v_visible boolean := false;
  v_name text;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  IF p_entity_type = 'lead' THEN
    SELECT l.assigned_to, l.division_id
      INTO v_assigned_to, v_division_id
    FROM public.crm_leads l
    WHERE l.id = p_entity_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    v_visible := app_private.has_division_resource_access(v_division_id, 'leads', false);
  ELSIF p_entity_type = 'customer' THEN
    SELECT c.assigned_to INTO v_assigned_to
    FROM public.crm_customers c
    WHERE c.id = p_entity_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.crm_customer_divisions cd
      WHERE cd.customer_id = p_entity_id
        AND app_private.has_division_resource_access(cd.division_id, 'customers', false)
    ) INTO v_visible;
  ELSE
    RAISE EXCEPTION 'Unsupported CRM entity type.' USING ERRCODE = '22023';
  END IF;

  IF NOT COALESCE(v_visible, false) THEN
    RAISE EXCEPTION 'You do not have access to this CRM record.' USING ERRCODE = '42501';
  END IF;
  IF v_assigned_to IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'Assigned salesperson')
    INTO v_name
  FROM public.crm_profiles p
  WHERE p.user_id = v_assigned_to AND p.active = true;
  RETURN COALESCE(v_name, 'Former salesperson');
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_assigned_salesperson_name(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.crm_assigned_salesperson_name(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.crm_assigned_salesperson_name(text, uuid) TO authenticated;
