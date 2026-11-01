
CREATE INDEX IF NOT EXISTS crm_claims_created_by_idx ON public.crm_claims(created_by);
CREATE INDEX IF NOT EXISTS crm_claims_lead_idx ON public.crm_claims(lead_id);
CREATE INDEX IF NOT EXISTS crm_projects_claim_idx ON public.crm_projects(claim_id);
CREATE INDEX IF NOT EXISTS crm_properties_owner_contact_idx ON public.crm_properties(owner_contact_id);
CREATE INDEX IF NOT EXISTS crm_properties_manager_contact_idx ON public.crm_properties(property_manager_contact_id);
