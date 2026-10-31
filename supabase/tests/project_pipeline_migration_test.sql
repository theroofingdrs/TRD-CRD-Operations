-- Self-contained PostgreSQL fixture for the additive project pipeline migration.
-- Run only in a disposable local CI database. Never run this file against production.
\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS app_private;

CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text NOT NULL, name text NOT NULL);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name text)
RETURNS text[] LANGUAGE sql IMMUTABLE
AS $$ SELECT (string_to_array(name, '/'))[1:3] $$;

CREATE TABLE public.crm_divisions (id text PRIMARY KEY);
CREATE TABLE public.crm_memberships (
  user_id uuid NOT NULL,
  division_id text NOT NULL,
  role text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, division_id)
);
CREATE TABLE public.crm_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL,
  lead_id uuid,
  customer_id uuid NOT NULL,
  property_id uuid NOT NULL,
  project_name text NOT NULL,
  project_type text,
  status text NOT NULL DEFAULT 'planning',
  project_manager_id uuid,
  start_date date,
  target_completion_date date,
  actual_completion_date date,
  contract_amount numeric(14,2),
  scope_of_work text,
  internal_notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  claim_id uuid
);
CREATE TABLE public.crm_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL,
  related_type text NOT NULL,
  related_id uuid NOT NULL,
  bucket_id text NOT NULL DEFAULT 'roof-doctors-private',
  object_path text NOT NULL,
  original_filename text NOT NULL,
  content_type text,
  file_size_bytes bigint,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.crm_files ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION app_private.has_division_resource_access(p_division_id text, p_resource text, p_write boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_memberships m
    WHERE m.user_id = (SELECT auth.uid())
      AND m.division_id = p_division_id AND m.active
      AND (NOT p_write OR m.role IN ('owner','division_admin','office_manager','project_manager'))
  );
$$;
CREATE POLICY crm_files_read ON public.crm_files FOR SELECT TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'files', false));

GRANT USAGE ON SCHEMA auth, storage, app_private TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.has_division_resource_access(text,text,boolean) TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public, storage, auth TO authenticated;

INSERT INTO public.crm_divisions(id) VALUES ('TRD');
INSERT INTO auth.users(id) VALUES ('00000000-0000-0000-0000-000000000001');
INSERT INTO public.crm_memberships(user_id, division_id, role)
VALUES ('00000000-0000-0000-0000-000000000001', 'TRD', 'owner');

\ir ../migrations/20261031140000_add_project_pipeline_and_job_costing.sql

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
SET ROLE authenticated;
CREATE TEMP TABLE test_ids(project_id uuid, supplement_id uuid, expense_id uuid, transaction_id uuid);

INSERT INTO public.crm_projects
  (division_id, customer_id, property_id, project_name, pipeline_type, workflow_stage, created_by)
VALUES
  ('TRD', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000020',
   'Pipeline migration test', 'insurance', 'new_lead', auth.uid())
RETURNING id AS test_project_id \gset
INSERT INTO pg_temp.test_ids(project_id) VALUES (:'test_project_id');

INSERT INTO public.crm_project_transactions
  (division_id, project_id, transaction_type, amount, transaction_date, reference_number, entered_by)
VALUES ('TRD', :'test_project_id', 'invoice', 12000, CURRENT_DATE, 'INV-TEST-1', auth.uid());

INSERT INTO public.crm_project_transactions
  (division_id, project_id, transaction_type, amount, transaction_date, reference_number, entered_by)
VALUES ('TRD', :'test_project_id', 'payment', 2500, CURRENT_DATE, 'PAY-TEST-1', auth.uid())
RETURNING id AS test_transaction_id \gset
UPDATE pg_temp.test_ids SET transaction_id = :'test_transaction_id';

DO $$
BEGIN
  IF (SELECT invoiced_amount FROM public.crm_projects WHERE id = (SELECT project_id FROM pg_temp.test_ids)) <> 12000 THEN
    RAISE EXCEPTION 'Invoice total did not synchronize';
  END IF;
  IF (SELECT collected_amount FROM public.crm_projects WHERE id = (SELECT project_id FROM pg_temp.test_ids)) <> 2500 THEN
    RAISE EXCEPTION 'Payment total did not synchronize';
  END IF;
END $$;

SELECT public.crm_update_project_financials(
  :'test_project_id', 12000, 8000, 'contract_percent', 5, NULL, 'Test Salesperson',
  600, 100, 'contract_percent', 8, NULL, 960
);

UPDATE public.crm_project_transactions
SET status = 'void', void_reason = 'Test correction'
WHERE id = (SELECT transaction_id FROM pg_temp.test_ids);

INSERT INTO public.crm_project_supplements
  (division_id, project_id, supplement_number, requested_amount, status, created_by)
VALUES
  ('TRD', :'test_project_id', 1, 1800, 'submitted', auth.uid())
RETURNING id AS test_supplement_id \gset
UPDATE pg_temp.test_ids SET supplement_id = :'test_supplement_id';

UPDATE public.crm_project_supplements
SET status = 'partially_approved', approved_amount = 900,
    carrier_response = 'Partial approval test', response_at = now()
WHERE id = :'test_supplement_id';

INSERT INTO public.crm_project_cost_estimates
  (division_id, project_id, category, estimated_amount, updated_by)
VALUES ('TRD', :'test_project_id', 'materials', 3500, auth.uid());

INSERT INTO public.crm_division_financial_settings
  (division_id, stale_stage_days, updated_by)
VALUES ('TRD', 10, auth.uid());

INSERT INTO public.crm_files
  (division_id, related_type, related_id, bucket_id, object_path, original_filename, content_type, uploaded_by, metadata)
VALUES
  ('TRD', 'project', :'test_project_id', 'roof-doctors-private',
   'TRD/' || :'test_project_id' || '/receipt-test.pdf', 'receipt-test.pdf',
   'application/pdf', auth.uid(), '{"document_category":"expense_receipt"}')
RETURNING id AS test_receipt_id \gset

INSERT INTO storage.objects(bucket_id, name)
VALUES ('roof-doctors-private', 'TRD/' || :'test_project_id' || '/receipt-test.pdf');

INSERT INTO public.crm_project_expenses
  (division_id, project_id, category, amount, receipt_file_id, entered_by)
VALUES ('TRD', :'test_project_id', 'materials', 125, :'test_receipt_id', auth.uid())
RETURNING id AS test_expense_id \gset
UPDATE pg_temp.test_ids SET expense_id = :'test_expense_id';

UPDATE public.crm_project_expenses
SET paid_amount = 125, payment_status = 'paid'
WHERE id = :'test_expense_id';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.crm_project_stage_history WHERE project_id = (SELECT project_id FROM pg_temp.test_ids) AND to_stage = 'new_lead') THEN
    RAISE EXCEPTION 'Initial stage history was not recorded';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_project_financial_history WHERE project_id = (SELECT project_id FROM pg_temp.test_ids)) THEN
    RAISE EXCEPTION 'Financial edit history was not recorded';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_project_supplement_history WHERE supplement_id = (SELECT supplement_id FROM pg_temp.test_ids)) THEN
    RAISE EXCEPTION 'Supplement history was not recorded';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_project_expense_history WHERE expense_id = (SELECT expense_id FROM pg_temp.test_ids)) THEN
    RAISE EXCEPTION 'Expense history was not recorded';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_project_cost_estimates WHERE project_id = (SELECT project_id FROM pg_temp.test_ids) AND category = 'materials') THEN
    RAISE EXCEPTION 'Cost estimate was not saved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_project_transaction_history WHERE transaction_id = (SELECT transaction_id FROM pg_temp.test_ids)) THEN
    RAISE EXCEPTION 'Transaction history was not recorded';
  END IF;
  IF (SELECT collected_amount FROM public.crm_projects WHERE id = (SELECT project_id FROM pg_temp.test_ids)) <> 0 THEN
    RAISE EXCEPTION 'Voided payment was not removed from collected total';
  END IF;
END $$;

RESET ROLE;
SELECT 'project pipeline migration test passed' AS result;
