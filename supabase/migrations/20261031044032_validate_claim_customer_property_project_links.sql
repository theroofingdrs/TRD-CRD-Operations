
CREATE OR REPLACE FUNCTION app_private.claim_links_match_division(
  p_division_id text,
  p_customer_id uuid,
  p_property_id uuid,
  p_lead_id uuid,
  p_project_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.crm_properties p
      JOIN public.crm_customer_divisions cd ON cd.customer_id = p.customer_id
      WHERE p.id = p_property_id
        AND p.customer_id = p_customer_id
        AND cd.division_id = p_division_id
    )
    AND (
      p_lead_id IS NULL OR EXISTS (
        SELECT 1 FROM public.crm_leads l
        WHERE l.id = p_lead_id
          AND l.division_id = p_division_id
          AND l.customer_id = p_customer_id
          AND (l.property_id IS NULL OR l.property_id = p_property_id)
      )
    )
    AND (
      p_project_id IS NULL OR EXISTS (
        SELECT 1 FROM public.crm_projects pr
        WHERE pr.id = p_project_id
          AND pr.division_id = p_division_id
          AND pr.customer_id = p_customer_id
          AND pr.property_id = p_property_id
      )
    );
$function$;

REVOKE ALL ON FUNCTION app_private.claim_links_match_division(text, uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.claim_links_match_division(text, uuid, uuid, uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS crm_claims_insert ON public.crm_claims;
DROP POLICY IF EXISTS crm_claims_update ON public.crm_claims;

CREATE POLICY crm_claims_insert ON public.crm_claims
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.has_division_resource_access(division_id, 'claims', true)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND app_private.claim_links_match_division(division_id, customer_id, property_id, lead_id, project_id)
  );

CREATE POLICY crm_claims_update ON public.crm_claims
  FOR UPDATE TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'claims', true))
  WITH CHECK (
    app_private.has_division_resource_access(division_id, 'claims', true)
    AND app_private.claim_links_match_division(division_id, customer_id, property_id, lead_id, project_id)
  );
