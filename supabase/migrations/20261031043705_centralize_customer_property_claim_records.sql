
ALTER TABLE public.crm_customers
  ADD COLUMN IF NOT EXISTS billing_address_line1 text,
  ADD COLUMN IF NOT EXISTS billing_address_line2 text,
  ADD COLUMN IF NOT EXISTS billing_city text,
  ADD COLUMN IF NOT EXISTS billing_state text,
  ADD COLUMN IF NOT EXISTS billing_postal_code text,
  ADD COLUMN IF NOT EXISTS billing_country text DEFAULT 'USA',
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS tax_exempt boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active';

ALTER TABLE public.crm_properties
  ADD COLUMN IF NOT EXISTS county text,
  ADD COLUMN IF NOT EXISTS parcel_number text,
  ADD COLUMN IF NOT EXISTS building_name text,
  ADD COLUMN IF NOT EXISTS occupancy_type text,
  ADD COLUMN IF NOT EXISTS owner_contact_id uuid REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS property_manager_contact_id uuid REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS property_notes text;

ALTER TABLE public.crm_projects
  ADD COLUMN IF NOT EXISTS claim_id uuid;

CREATE TABLE IF NOT EXISTS public.crm_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL REFERENCES public.crm_divisions(id),
  customer_id uuid NOT NULL REFERENCES public.crm_customers(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.crm_properties(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.crm_projects(id) ON DELETE SET NULL,
  claim_number text,
  policy_number text,
  insurance_carrier text,
  date_of_loss date,
  date_reported date,
  claim_status text NOT NULL DEFAULT 'open',
  adjuster_name text,
  adjuster_email text,
  adjuster_phone text,
  deductible numeric(14,2),
  approved_amount numeric(14,2),
  replacement_cost_value numeric(14,2),
  actual_cash_value numeric(14,2),
  supplement_amount numeric(14,2),
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crm_claims_status_check CHECK (claim_status IN ('open','filed','inspection_scheduled','under_review','approved','partially_approved','denied','supplement_pending','closed'))
);

ALTER TABLE public.crm_projects
  DROP CONSTRAINT IF EXISTS crm_projects_claim_id_fkey;
ALTER TABLE public.crm_projects
  ADD CONSTRAINT crm_projects_claim_id_fkey
  FOREIGN KEY (claim_id) REFERENCES public.crm_claims(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS crm_claims_division_status_idx ON public.crm_claims(division_id, claim_status, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_claims_customer_idx ON public.crm_claims(customer_id);
CREATE INDEX IF NOT EXISTS crm_claims_property_idx ON public.crm_claims(property_id);
CREATE INDEX IF NOT EXISTS crm_claims_project_idx ON public.crm_claims(project_id);

CREATE OR REPLACE FUNCTION app_private.has_division_resource_access(p_division_id text, p_resource text, p_write boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
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
        OR m.role IN ('owner','division_admin','office_manager')
        OR (m.role = 'sales_rep' AND p_resource IN ('customers','contacts','properties','leads','appointments','tasks','activity','files','claims'))
        OR (m.role = 'project_manager' AND p_resource IN ('customers','contacts','properties','roofs','appointments','inspections','inspection_items','projects','tasks','activity','files','claims'))
        OR (m.role = 'field_inspector' AND p_resource IN ('appointments','inspections','inspection_items','activity','files'))
        OR (m.role = 'production_manager' AND p_resource IN ('roofs','inspections','projects','tasks','activity','files','claims'))
      )
  );
$function$;

CREATE OR REPLACE FUNCTION app_private.claim_links_match_division(p_division_id text, p_customer_id uuid, p_property_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.crm_properties p
    JOIN public.crm_customer_divisions cd ON cd.customer_id = p.customer_id
    WHERE p.id = p_property_id
      AND p.customer_id = p_customer_id
      AND cd.division_id = p_division_id
  );
$function$;

REVOKE ALL ON FUNCTION app_private.claim_links_match_division(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.claim_links_match_division(text, uuid, uuid) TO authenticated;

ALTER TABLE public.crm_claims ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_claims_read ON public.crm_claims;
DROP POLICY IF EXISTS crm_claims_insert ON public.crm_claims;
DROP POLICY IF EXISTS crm_claims_update ON public.crm_claims;
DROP POLICY IF EXISTS crm_claims_delete ON public.crm_claims;

CREATE POLICY crm_claims_read ON public.crm_claims
  FOR SELECT TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'claims', false));

CREATE POLICY crm_claims_insert ON public.crm_claims
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.has_division_resource_access(division_id, 'claims', true)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND app_private.claim_links_match_division(division_id, customer_id, property_id)
  );

CREATE POLICY crm_claims_update ON public.crm_claims
  FOR UPDATE TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'claims', true))
  WITH CHECK (
    app_private.has_division_resource_access(division_id, 'claims', true)
    AND app_private.claim_links_match_division(division_id, customer_id, property_id)
  );

CREATE POLICY crm_claims_delete ON public.crm_claims
  FOR DELETE TO authenticated
  USING (app_private.is_crm_owner());

DROP TRIGGER IF EXISTS crm_claims_set_updated_at ON public.crm_claims;
CREATE TRIGGER crm_claims_set_updated_at
  BEFORE UPDATE ON public.crm_claims
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

REVOKE ALL PRIVILEGES ON TABLE public.crm_claims FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.crm_claims FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crm_claims TO authenticated;
