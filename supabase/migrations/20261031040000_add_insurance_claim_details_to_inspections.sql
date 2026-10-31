-- Optional carrier, policy, claim, and adjuster details for inspection reports.
-- Stored as structured JSON so existing inspection records remain unchanged.
ALTER TABLE public.crm_inspections
  ADD COLUMN IF NOT EXISTS claim_information jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(claim_information) = 'object');
