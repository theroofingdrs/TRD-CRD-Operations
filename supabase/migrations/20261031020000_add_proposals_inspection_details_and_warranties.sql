-- Stage 1: proposal, inspection detail, and warranty records.
-- Additive only. Existing CRM tables and records remain unchanged.
-- Proposal and warranty access follows existing project division permissions.
-- No public storage, new SECURITY DEFINER functions, or email secrets are introduced.

CREATE TABLE public.crm_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL REFERENCES public.crm_divisions(id),
  customer_id uuid NOT NULL REFERENCES public.crm_customers(id),
  property_id uuid NOT NULL REFERENCES public.crm_properties(id),
  project_id uuid REFERENCES public.crm_projects(id),
  lead_id uuid REFERENCES public.crm_leads(id),
  proposal_number text,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','ready_to_send','sent','accepted','declined','expired','converted')),
  pricing_mode text NOT NULL DEFAULT 'both'
    CHECK (pricing_mode IN ('itemized','lump_sum','both')),
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(line_items) = 'array'),
  lump_sum_amount numeric(14,2),
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  scope_of_work text,
  existing_conditions text,
  exclusions text,
  payment_terms text,
  warranty_summary text,
  template_data jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(template_data) = 'object'),
  valid_until date,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (lump_sum_amount IS NULL OR lump_sum_amount >= 0),
  CHECK (subtotal >= 0 AND tax_amount >= 0 AND total_amount >= 0),
  CHECK (total_amount = subtotal + tax_amount)
);

CREATE INDEX crm_proposals_division_created_idx
  ON public.crm_proposals (division_id, created_at DESC);
CREATE INDEX crm_proposals_property_idx
  ON public.crm_proposals (property_id);
CREATE INDEX crm_proposals_project_idx
  ON public.crm_proposals (project_id);

ALTER TABLE public.crm_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY crm_proposals_read ON public.crm_proposals
  FOR SELECT TO authenticated
  USING (
    app_private.has_division_resource_access(division_id, 'leads', false)
    AND app_private.property_in_division(division_id, property_id)
  );

CREATE POLICY crm_proposals_insert ON public.crm_proposals
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.has_division_resource_access(division_id, 'leads', true)
    AND app_private.project_links_match_division(division_id, customer_id, property_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
  );

CREATE POLICY crm_proposals_update ON public.crm_proposals
  FOR UPDATE TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'leads', true))
  WITH CHECK (
    app_private.has_division_resource_access(division_id, 'leads', true)
    AND app_private.project_links_match_division(division_id, customer_id, property_id)
  );

CREATE POLICY crm_proposals_delete ON public.crm_proposals
  FOR DELETE TO authenticated
  USING (app_private.is_crm_owner());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_proposals TO authenticated;

ALTER TABLE public.crm_inspections
  ADD COLUMN IF NOT EXISTS inspection_type text NOT NULL DEFAULT 'general'
    CHECK (inspection_type IN ('residential','commercial','general')),
  ADD COLUMN IF NOT EXISTS template_version text,
  ADD COLUMN IF NOT EXISTS measurements jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(measurements) = 'object'),
  ADD COLUMN IF NOT EXISTS roof_sections jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(roof_sections) = 'array');

CREATE TABLE public.crm_warranties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL REFERENCES public.crm_divisions(id),
  customer_id uuid NOT NULL REFERENCES public.crm_customers(id),
  property_id uuid NOT NULL REFERENCES public.crm_properties(id),
  project_id uuid REFERENCES public.crm_projects(id),
  proposal_id uuid REFERENCES public.crm_proposals(id),
  warranty_type text NOT NULL DEFAULT 'workmanship'
    CHECK (warranty_type IN ('workmanship','manufacturer','system','other')),
  title text NOT NULL,
  provider_name text,
  roof_system text,
  coverage_summary text,
  exclusions text,
  maintenance_requirements text,
  start_date date,
  end_date date,
  document_file_id uuid REFERENCES public.crm_files(id),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','active','expired','void')),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE INDEX crm_warranties_division_created_idx
  ON public.crm_warranties (division_id, created_at DESC);
CREATE INDEX crm_warranties_property_idx
  ON public.crm_warranties (property_id);

ALTER TABLE public.crm_warranties ENABLE ROW LEVEL SECURITY;

CREATE POLICY crm_warranties_read ON public.crm_warranties
  FOR SELECT TO authenticated
  USING (
    app_private.has_division_resource_access(division_id, 'projects', false)
    AND app_private.property_in_division(division_id, property_id)
  );

CREATE POLICY crm_warranties_insert ON public.crm_warranties
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.has_division_resource_access(division_id, 'projects', true)
    AND app_private.project_links_match_division(division_id, customer_id, property_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
  );

CREATE POLICY crm_warranties_update ON public.crm_warranties
  FOR UPDATE TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'projects', true))
  WITH CHECK (
    app_private.has_division_resource_access(division_id, 'projects', true)
    AND app_private.project_links_match_division(division_id, customer_id, property_id)
  );

CREATE POLICY crm_warranties_delete ON public.crm_warranties
  FOR DELETE TO authenticated
  USING (app_private.is_crm_owner());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_warranties TO authenticated;
