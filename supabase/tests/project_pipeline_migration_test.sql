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
AS $
  SELECT CASE
    WHEN array_length(parts, 1) > 1 THEN parts[1:array_length(parts, 1) - 1]
    ELSE ARRAY[]::text[]
  END
  FROM (SELECT string_to_array(name, '/') AS parts) AS path_parts
$;

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
CREATE TABLE public.crm_leads (
  id uuid PRIMARY KEY,
  division_id text NOT NULL,
  customer_id uuid,
  property_id uuid,
  service_interest text,
  status text NOT NULL DEFAULT 'new',
  assigned_to uuid
);
CREATE TABLE public.crm_claims (
  id uuid PRIMARY KEY,
  division_id text NOT NULL,
  customer_id uuid NOT NULL,
  property_id uuid NOT NULL,
  lead_id uuid,
  project_id uuid,
  claim_number text,
  insurance_carrier text,
  claim_status text NOT NULL DEFAULT 'open'
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
CREATE TABLE public.crm_properties (
  id uuid PRIMARY KEY,
  customer_id uuid NOT NULL
);
CREATE TABLE public.crm_customer_divisions (
  customer_id uuid NOT NULL,
  division_id text NOT NULL,
  PRIMARY KEY (customer_id, division_id)
);
CREATE TABLE public.crm_inspections (
  id uuid PRIMARY KEY,
  division_id text NOT NULL
);
CREATE TABLE public.crm_inspection_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL,
  file_id uuid NOT NULL
);

CREATE OR REPLACE FUNCTION app_private.has_division_resource_access(p_division_id text, p_resource text, p_write boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_memberships m
    WHERE m.user_id = (SELECT auth.uid())
      AND m.division_id = p_division_id AND m.active
      AND (
        NOT p_write
        OR m.role IN ('owner','division_admin','office_manager','project_manager')
        OR (m.role = 'sales_rep' AND p_resource IN ('customers','contacts','properties','leads','appointments','tasks','activity','files','claims'))
        OR (m.role = 'field_inspector' AND p_resource IN ('appointments','inspections','inspection_items','activity','files','maintenance'))
      )
  );
$$;
CREATE POLICY crm_files_read ON public.crm_files FOR SELECT TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'files', false));
CREATE POLICY crm_files_insert ON public.crm_files FOR INSERT TO authenticated
  WITH CHECK (app_private.has_division_resource_access(division_id, 'files', true)
    AND (uploaded_by IS NULL OR uploaded_by = (SELECT auth.uid())));
CREATE POLICY crm_private_files_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'roof-doctors-private'
    AND app_private.has_division_resource_access((storage.foldername(name))[1], 'files', true));
CREATE POLICY crm_private_files_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'roof-doctors-private'
    AND app_private.has_division_resource_access((storage.foldername(name))[1], 'files', false));
CREATE POLICY crm_private_files_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'roof-doctors-private'
    AND app_private.has_division_resource_access((storage.foldername(name))[1], 'files', true))
  WITH CHECK (bucket_id = 'roof-doctors-private'
    AND app_private.has_division_resource_access((storage.foldername(name))[1], 'files', true));

GRANT USAGE ON SCHEMA auth, storage, app_private TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
GRANT EXECUTE ON FUNCTION storage.foldername(text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.has_division_resource_access(text,text,boolean) TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public, storage, auth TO authenticated;

INSERT INTO public.crm_divisions(id) VALUES ('TRD');
INSERT INTO auth.users(id) VALUES ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'), ('00000000-0000-0000-0000-000000000003'), ('00000000-0000-0000-0000-000000000004'), ('00000000-0000-0000-0000-000000000005');
INSERT INTO public.crm_memberships(user_id, division_id, role)
VALUES ('00000000-0000-0000-0000-000000000001', 'TRD', 'owner'), ('00000000-0000-0000-0000-000000000002', 'TRD', 'project_manager'), ('00000000-0000-0000-0000-000000000003', 'TRD', 'accounting'), ('00000000-0000-0000-0000-000000000004', 'TRD', 'sales_rep'), ('00000000-0000-0000-0000-000000000005', 'TRD', 'field_inspector');
INSERT INTO public.crm_properties(id,customer_id)
VALUES ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000010');
INSERT INTO public.crm_customer_divisions(customer_id,division_id)
VALUES ('00000000-0000-0000-0000-000000000010','TRD');
INSERT INTO public.crm_inspections(id,division_id)
VALUES ('00000000-0000-0000-0000-000000000050','TRD');
INSERT INTO public.crm_leads(id,division_id,customer_id,property_id,service_interest,status)
VALUES ('00000000-0000-0000-0000-000000000030','TRD','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020','Roof replacement','new');
INSERT INTO public.crm_claims(id,division_id,customer_id,property_id,lead_id,claim_number,insurance_carrier,claim_status)
VALUES ('00000000-0000-0000-0000-000000000040','TRD','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000030','CLM-TEST-1','Test Carrier','open'),
       ('00000000-0000-0000-0000-000000000041','TRD','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000030','CLM-WRONG-PROPERTY','Test Carrier','open');

\ir ../migrations/20261031220000_add_project_pipeline_and_job_costing.sql
\ir ../migrations/20261031220100_complete_project_pipeline_stage_gates.sql
\ir ../migrations/20261031220200_add_project_transaction_attachments.sql
\ir ../migrations/20261031220300_add_company_expense_ledger.sql
\ir ../migrations/20261031220400_recalculate_project_financial_methods.sql
\ir ../migrations/20261102030000_isolate_private_file_access_policies.sql

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);
SET ROLE authenticated;
CREATE TEMP TABLE test_ids(project_id uuid, supplement_id uuid, expense_id uuid, transaction_id uuid);

INSERT INTO public.crm_projects
  (division_id, lead_id, claim_id, customer_id, property_id, project_name, pipeline_type, workflow_stage, created_by)
VALUES
  ('TRD', '00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000040',
   '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000020',
   'Pipeline migration test', 'insurance', 'new_lead', auth.uid())
RETURNING id AS test_project_id \gset
INSERT INTO pg_temp.test_ids(project_id) VALUES (:'test_project_id');

-- Accounting can update financial fields without gaining general project-edit permissions.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', false);
SELECT public.crm_update_project_financials(
  :'test_project_id', 5000, 5000, 'manual', NULL, NULL, 'Accounting test',
  0, 0, NULL, 'manual', NULL, NULL, 0
);
DO $body$
BEGIN
  IF (SELECT contract_amount FROM public.crm_projects WHERE id = (SELECT project_id FROM pg_temp.test_ids)) <> 5000 THEN
    RAISE EXCEPTION 'Accounting could not update project financial fields';
  END IF;
END
$body$;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);

DO $body$
BEGIN
  BEGIN
    INSERT INTO public.crm_project_stage_history
      (division_id, project_id, to_stage, changed_by)
    VALUES ('TRD', (SELECT project_id FROM pg_temp.test_ids), 'contacted', auth.uid());
    RAISE EXCEPTION 'Direct project audit history insert was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Direct project audit history insert was allowed' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'Audit history can only be written by system-generated change triggers%' THEN RAISE; END IF;
  END;
END
$body$;

UPDATE public.crm_claims SET project_id = :'test_project_id' WHERE id = '00000000-0000-0000-0000-000000000040';

DO $body$
BEGIN
  BEGIN
    INSERT INTO public.crm_projects
      (division_id, customer_id, property_id, project_name, pipeline_type, workflow_stage, claim_id, created_by)
    VALUES ('TRD','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020',
      'Duplicate claim link test','insurance','new_lead','00000000-0000-0000-0000-000000000040',auth.uid());
    RAISE EXCEPTION 'The same insurance claim was linked to multiple projects';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'The same insurance claim was linked to multiple projects' THEN RAISE; END IF;
  END;
END
$body$;

DO $body$
BEGIN
  IF (SELECT lead_id FROM public.crm_projects WHERE id = (SELECT project_id FROM pg_temp.test_ids)) <> '00000000-0000-0000-0000-000000000030' THEN
    RAISE EXCEPTION 'Existing CRM lead was not linked to the project';
  END IF;
  IF (SELECT claim_id FROM public.crm_projects WHERE id = (SELECT project_id FROM pg_temp.test_ids)) <> '00000000-0000-0000-0000-000000000040' THEN
    RAISE EXCEPTION 'Existing insurance claim was not linked to the project';
  END IF;
  IF (SELECT project_id FROM public.crm_claims WHERE id = '00000000-0000-0000-0000-000000000040') <> (SELECT project_id FROM pg_temp.test_ids) THEN
    RAISE EXCEPTION 'Insurance claim was not linked back to its project';
  END IF;
END
$body$;

DO $body$
BEGIN
  BEGIN
    INSERT INTO public.crm_projects
      (division_id, customer_id, property_id, project_name, pipeline_type, workflow_stage, claim_id, created_by)
    VALUES ('TRD','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020',
      'Invalid claim link test','insurance','new_lead','00000000-0000-0000-0000-000000000041',auth.uid());
    RAISE EXCEPTION 'A claim from another property was linked to a project';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'A claim from another property was linked to a project' THEN RAISE; END IF;
  END;
END
$body$;

-- Direct table writes must not bypass stage gates.
DO $body$
BEGIN
  BEGIN
    UPDATE public.crm_projects SET workflow_stage = 'materials_ordered'
    WHERE id = (SELECT project_id FROM pg_temp.test_ids);
    RAISE EXCEPTION 'Direct update bypassed the materials order gate';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Direct update bypassed the materials order gate' THEN RAISE; END IF;
  END;
END
$body$;

-- A project manager may move jobs, but cannot self-authorize an administrative override.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', false);
DO $body$
BEGIN
  BEGIN
    UPDATE public.crm_projects
    SET workflow_stage = 'materials_ordered',
        workflow_stage_override = true,
        workflow_stage_note = 'AUTHORIZED OVERRIDE | unauthorized role test'
    WHERE id = (SELECT project_id FROM pg_temp.test_ids);
    RAISE EXCEPTION 'Project manager bypassed an administrator-only stage gate';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Project manager bypassed an administrator-only stage gate' THEN RAISE; END IF;
  END;
END
$body$;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', false);


INSERT INTO public.crm_project_transactions
  (division_id, project_id, transaction_type, amount, transaction_date, reference_number, entered_by)
VALUES ('TRD', :'test_project_id', 'invoice', 12000, CURRENT_DATE, 'INV-TEST-1', auth.uid());

INSERT INTO public.crm_project_transactions
  (division_id, project_id, transaction_type, amount, transaction_date, reference_number, entered_by)
VALUES ('TRD', :'test_project_id', 'payment', 2500, CURRENT_DATE, 'PAY-TEST-1', auth.uid())
RETURNING id AS test_transaction_id \gset
UPDATE pg_temp.test_ids SET transaction_id = :'test_transaction_id';

INSERT INTO storage.objects(bucket_id,name)
VALUES ('roof-doctors-private','TRD/' || :'test_project_id' || '/payment-receipt-test.pdf');
INSERT INTO public.crm_files
  (division_id,related_type,related_id,bucket_id,object_path,original_filename,content_type,file_size_bytes,uploaded_by,metadata)
VALUES
  ('TRD','project',:'test_project_id','roof-doctors-private',
   'TRD/' || :'test_project_id' || '/payment-receipt-test.pdf','payment-receipt-test.pdf',
   'application/pdf',100,auth.uid(),
   jsonb_build_object('document_category','payment_receipt','transaction_id',:'test_transaction_id'))
RETURNING id AS test_transaction_file_id \gset
UPDATE public.crm_project_transactions
SET attachment_file_id = :'test_transaction_file_id'
WHERE id = :'test_transaction_id';

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
  600, 100, CURRENT_DATE, 'contract_percent', 8, NULL, 960
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

INSERT INTO public.crm_workflow_stage_settings
  (division_id, pipeline_type, stage_key, display_label, sort_order, updated_by)
VALUES ('TRD', 'retail', 'new_lead', 'New opportunity', 0, auth.uid());

DO $body$
DECLARE
  stage_setting_id uuid;
  cost_estimate_id uuid;
BEGIN
  SELECT id INTO stage_setting_id FROM public.crm_workflow_stage_settings
  WHERE division_id = 'TRD' AND pipeline_type = 'retail' AND stage_key = 'new_lead';
  BEGIN
    UPDATE public.crm_workflow_stage_settings
    SET updated_by = '00000000-0000-0000-0000-000000000002'
    WHERE id = stage_setting_id;
    RAISE EXCEPTION 'Workflow settings allowed a forged updated_by value';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  SELECT id INTO cost_estimate_id FROM public.crm_project_cost_estimates
  WHERE project_id = (SELECT project_id FROM pg_temp.test_ids) AND category = 'materials';
  BEGIN
    UPDATE public.crm_project_cost_estimates
    SET updated_by = '00000000-0000-0000-0000-000000000002'
    WHERE id = cost_estimate_id;
    RAISE EXCEPTION 'Cost estimates allowed a forged updated_by value';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$body$;

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
  IF NOT EXISTS (SELECT 1 FROM public.crm_workflow_stage_settings WHERE division_id = 'TRD' AND pipeline_type = 'retail' AND stage_key = 'new_lead' AND display_label = 'New opportunity') THEN
    RAISE EXCEPTION 'Workflow stage customization was not saved';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_project_transaction_history WHERE transaction_id = (SELECT transaction_id FROM pg_temp.test_ids)) THEN
    RAISE EXCEPTION 'Transaction history was not recorded';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_project_transactions WHERE id = (SELECT transaction_id FROM pg_temp.test_ids) AND attachment_file_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Original payment receipt was not linked to the transaction';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_files WHERE id = (SELECT attachment_file_id FROM public.crm_project_transactions WHERE id = (SELECT transaction_id FROM pg_temp.test_ids)) AND metadata->>'document_category' = 'payment_receipt') THEN
    RAISE EXCEPTION 'Original payment receipt file record was not retained';
  END IF;
  IF (SELECT collected_amount FROM public.crm_projects WHERE id = (SELECT project_id FROM pg_temp.test_ids)) <> 0 THEN
    RAISE EXCEPTION 'Voided payment was not removed from collected total';
  END IF;
END $$;

-- Percentage-based commissions and overhead must follow payments, approved revenue, and actual expenses.
SELECT public.crm_update_project_financials(
  :'test_project_id', 12000, 8000, 'collected_percent', 10, NULL, 'Test Salesperson',
  0, 0, NULL, 'direct_cost_percent', 5, NULL, 0
);
DO $body$
BEGIN
  IF (SELECT commission_earned_amount FROM public.crm_projects WHERE id = (SELECT project_id FROM pg_temp.test_ids)) <> 0 THEN
    RAISE EXCEPTION 'Collected-revenue commission should be zero before payment';
  END IF;
  IF (SELECT overhead_allocated_amount FROM public.crm_projects WHERE id = (SELECT project_id FROM pg_temp.test_ids)) <> 6.25 THEN
    RAISE EXCEPTION 'Direct-cost overhead did not calculate from actual project expenses';
  END IF;
END
$body$;

INSERT INTO public.crm_project_transactions
  (division_id, project_id, transaction_type, amount, transaction_date, reference_number, entered_by)
VALUES ('TRD', :'test_project_id', 'payment', 1000, CURRENT_DATE, 'PAY-DYNAMIC-TEST', auth.uid());
DO $body$
BEGIN
  IF (SELECT commission_earned_amount FROM public.crm_projects WHERE id = (SELECT project_id FROM pg_temp.test_ids)) <> 100 THEN
    RAISE EXCEPTION 'Collected-revenue commission did not recalculate after a payment';
  END IF;
END
$body$;

UPDATE public.crm_project_expenses SET amount = 500
WHERE id = (SELECT expense_id FROM pg_temp.test_ids);
DO $body$
BEGIN
  IF (SELECT overhead_allocated_amount FROM public.crm_projects WHERE id = (SELECT project_id FROM pg_temp.test_ids)) <> 25 THEN
    RAISE EXCEPTION 'Direct-cost overhead did not recalculate after an expense change';
  END IF;
END
$body$;

UPDATE public.crm_project_transactions
SET status = 'void', void_reason = 'Dynamic commission test correction'
WHERE reference_number = 'PAY-DYNAMIC-TEST';
UPDATE public.crm_project_expenses
SET payment_status = 'void', void_reason = 'Dynamic financial test correction'
WHERE id = (SELECT expense_id FROM pg_temp.test_ids);
DO $body$
BEGIN
  IF (SELECT commission_earned_amount FROM public.crm_projects WHERE id = (SELECT project_id FROM pg_temp.test_ids)) <> 0 THEN
    RAISE EXCEPTION 'Collected-revenue commission did not recalculate after a payment was voided';
  END IF;
  IF (SELECT overhead_allocated_amount FROM public.crm_projects WHERE id = (SELECT project_id FROM pg_temp.test_ids)) <> 0 THEN
    RAISE EXCEPTION 'Direct-cost overhead did not exclude a voided expense';
  END IF;
END
$body$;

-- Exercise purchase order, completion date, supplement approval, balance-close, and audit gates.
UPDATE public.crm_project_supplements SET approved_amount = 0 WHERE id = (SELECT supplement_id FROM pg_temp.test_ids);
DO $body$
BEGIN
  BEGIN
    PERFORM public.crm_move_project_stage((SELECT project_id FROM pg_temp.test_ids), 'supplement_approved');
    RAISE EXCEPTION 'Supplement approval gate did not reject a missing approved amount';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Supplement approval gate did not reject a missing approved amount' THEN RAISE; END IF;
  END;
END
$body$;
UPDATE public.crm_project_supplements SET approved_amount = 900 WHERE id = (SELECT supplement_id FROM pg_temp.test_ids);

DO $body$
BEGIN
  BEGIN
    PERFORM public.crm_move_project_stage((SELECT project_id FROM pg_temp.test_ids), 'work_completed');
    RAISE EXCEPTION 'Work completed gate did not reject a missing completion date';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Work completed gate did not reject a missing completion date' THEN RAISE; END IF;
  END;
END
$body$;

DO $body$
BEGIN
  BEGIN
    PERFORM public.crm_move_project_stage((SELECT project_id FROM pg_temp.test_ids), 'materials_ordered');
    RAISE EXCEPTION 'Materials ordered gate did not reject a missing order reference';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Materials ordered gate did not reject a missing order reference' THEN RAISE; END IF;
  END;
END
$body$;

SELECT public.crm_move_project_stage((SELECT project_id FROM pg_temp.test_ids), 'supplement_approved', 'Carrier approved the supplement');
SELECT public.crm_move_project_stage((SELECT project_id FROM pg_temp.test_ids), 'materials_ordered', 'PO entered', 'PO-TEST-100');
SELECT public.crm_move_project_stage((SELECT project_id FROM pg_temp.test_ids), 'work_completed', 'Completion confirmed', NULL, CURRENT_DATE);

DO $body$
BEGIN
  IF (SELECT materials_order_reference FROM public.crm_projects WHERE id = (SELECT project_id FROM pg_temp.test_ids)) <> 'PO-TEST-100' THEN
    RAISE EXCEPTION 'Materials order reference was not saved';
  END IF;
  IF (SELECT work_completed_at FROM public.crm_projects WHERE id = (SELECT project_id FROM pg_temp.test_ids)) <> CURRENT_DATE THEN
    RAISE EXCEPTION 'Work completion date was not saved';
  END IF;
END
$body$;

DO $body$
BEGIN
  BEGIN
    PERFORM public.crm_move_project_stage((SELECT project_id FROM pg_temp.test_ids), 'closed');
    RAISE EXCEPTION 'Close gate did not reject an outstanding balance';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Close gate did not reject an outstanding balance' THEN RAISE; END IF;
  END;
END
$body$;

SELECT public.crm_move_project_stage((SELECT project_id FROM pg_temp.test_ids), 'closed', 'Closing with documented owner override', NULL, NULL, true);

DO $body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.crm_project_stage_history WHERE project_id = (SELECT project_id FROM pg_temp.test_ids) AND override_used = true AND note LIKE 'AUTHORIZED OVERRIDE%') THEN
    RAISE EXCEPTION 'Authorized stage override was not audited';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_project_stage_history WHERE project_id = (SELECT project_id FROM pg_temp.test_ids) AND to_pipeline_type = 'insurance') THEN
    RAISE EXCEPTION 'Pipeline type history was not recorded';
  END IF;
END
$body$;

CREATE TEMP TABLE retail_test_ids AS
WITH inserted AS (
  INSERT INTO public.crm_projects
    (division_id, customer_id, property_id, project_name, pipeline_type, workflow_stage, created_by)
  VALUES ('TRD', '00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000021',
    'Retail stage isolation test', 'retail', 'new_lead', auth.uid())
  RETURNING id
) SELECT id AS project_id FROM inserted;

DO $body$
DECLARE retail_id uuid;
BEGIN
  SELECT project_id INTO retail_id FROM pg_temp.retail_test_ids LIMIT 1;
  BEGIN
    PERFORM public.crm_move_project_stage(retail_id, 'claim_filed');
    RAISE EXCEPTION 'Retail workflow accepted an insurance-only stage';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Retail workflow accepted an insurance-only stage' THEN RAISE; END IF;
  END;
END
$body$;

-- Company-level expenses remain separate from project overhead allocations and keep receipt history.
INSERT INTO public.crm_company_expenses
  (division_id, expense_date, category, amount, paid_amount, payment_status, vendor_payee, description, entered_by)
VALUES ('TRD', CURRENT_DATE, 'utilities', 1200, 0, 'unpaid', 'Test Utility Co', 'Monthly utility bill', auth.uid())
RETURNING id AS test_company_expense_id \gset

INSERT INTO storage.objects(bucket_id,name)
VALUES ('roof-doctors-private','TRD/company-expenses/company-expense-test.pdf');
INSERT INTO public.crm_files
  (division_id,related_type,related_id,bucket_id,object_path,original_filename,content_type,file_size_bytes,uploaded_by,metadata)
VALUES
  ('TRD','company_expense',:'test_company_expense_id','roof-doctors-private',
   'TRD/company-expenses/company-expense-test.pdf','company-expense-test.pdf',
   'application/pdf',100,auth.uid(),
   jsonb_build_object('document_category','company_expense_receipt'))
RETURNING id AS test_company_receipt_id \gset
CREATE TEMP TABLE company_expense_ids(expense_id uuid, receipt_file_id uuid);
INSERT INTO pg_temp.company_expense_ids VALUES (:'test_company_expense_id', :'test_company_receipt_id');

DO $body$
BEGIN
  BEGIN
    INSERT INTO public.crm_company_expense_history
      (division_id, expense_id, changed_by, before_values, after_values)
    VALUES ('TRD', (SELECT expense_id FROM pg_temp.company_expense_ids), auth.uid(), '{}'::jsonb, '{"payment_status":"paid"}'::jsonb);
    RAISE EXCEPTION 'Direct company audit history insert was allowed';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'Direct company audit history insert was allowed' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'Audit history can only be written by system-generated change triggers%' THEN RAISE; END IF;
  END;
END
$body$;

UPDATE public.crm_company_expenses
SET receipt_file_id = :'test_company_receipt_id'
WHERE id = :'test_company_expense_id';

UPDATE public.crm_company_expenses
SET paid_amount = 600, payment_status = 'partially_paid', updated_at = now()
WHERE id = :'test_company_expense_id';
UPDATE public.crm_company_expenses
SET paid_amount = 1200, payment_status = 'paid', updated_at = now()
WHERE id = :'test_company_expense_id';

DO $body$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.crm_company_expenses
    WHERE id = (SELECT expense_id FROM pg_temp.company_expense_ids) AND receipt_file_id = (SELECT receipt_file_id FROM pg_temp.company_expense_ids)
      AND payment_status = 'paid' AND paid_amount = 1200
  ) THEN
    RAISE EXCEPTION 'Company expense receipt or payment update was not saved';
  END IF;
  IF (SELECT count(*) FROM public.crm_company_expense_history WHERE expense_id = (SELECT expense_id FROM pg_temp.company_expense_ids)) <> 3 THEN
    RAISE EXCEPTION 'Company expense edits were not retained in history';
  END IF;
  IF has_table_privilege('authenticated','public.crm_company_expenses','DELETE') THEN
    RAISE EXCEPTION 'Company expenses unexpectedly allow deletion';
  END IF;
  IF has_table_privilege('authenticated','public.crm_company_expense_history','DELETE')
     OR has_table_privilege('authenticated','public.crm_project_stage_history','DELETE')
     OR has_table_privilege('authenticated','public.crm_project_financial_history','DELETE')
     OR has_table_privilege('authenticated','public.crm_project_expense_history','DELETE')
     OR has_table_privilege('authenticated','public.crm_project_supplement_history','DELETE')
     OR has_table_privilege('authenticated','public.crm_project_transaction_history','DELETE') THEN
    RAISE EXCEPTION 'Authenticated clients can delete audit history rows';
  END IF;
END
$body$;

-- Verify generic file policies cannot bypass the record-specific storage policies.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000004', false);

INSERT INTO storage.objects(bucket_id, name)
VALUES ('roof-doctors-private', 'TRD/property-test-file.pdf');
INSERT INTO public.crm_files
  (division_id, related_type, related_id, bucket_id, object_path, original_filename, content_type, file_size_bytes, uploaded_by)
VALUES
  ('TRD','property','00000000-0000-0000-0000-000000000020','roof-doctors-private','TRD/property-test-file.pdf','property-test-file.pdf','application/pdf',100,auth.uid());

DO $body$
BEGIN
  IF (SELECT count(*) FROM storage.objects WHERE name='TRD/property-test-file.pdf') <> 1 THEN
    RAISE EXCEPTION 'Sales rep could not read a registered property file';
  END IF;
  BEGIN
    INSERT INTO storage.objects(bucket_id, name)
    VALUES ('roof-doctors-private', 'TRD/company-expenses/unauthorized.pdf');
    RAISE EXCEPTION 'Sales rep bypassed financial receipt upload restrictions';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    INSERT INTO storage.objects(bucket_id, name)
    VALUES ('roof-doctors-private', 'TRD/00000000-0000-0000-0000-000000000060/unauthorized.pdf');
    RAISE EXCEPTION 'Sales rep bypassed project attachment upload restrictions';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    INSERT INTO public.crm_files
      (division_id, related_type, related_id, bucket_id, object_path, original_filename, uploaded_by)
    VALUES ('TRD','company_expense','00000000-0000-0000-0000-000000000099','roof-doctors-private',
      'TRD/company-expenses/unauthorized.pdf','unauthorized.pdf',auth.uid());
    RAISE EXCEPTION 'Sales rep inserted restricted company-expense file metadata';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$body$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', false);
INSERT INTO storage.objects(bucket_id, name)
VALUES ('roof-doctors-private', 'TRD/inspections/00000000-0000-0000-0000-000000000050/inspection-photo.jpg');
INSERT INTO public.crm_files
  (division_id, related_type, related_id, bucket_id, object_path, original_filename, content_type, file_size_bytes, uploaded_by)
VALUES
  ('TRD','inspection','00000000-0000-0000-0000-000000000050','roof-doctors-private',
   'TRD/inspections/00000000-0000-0000-0000-000000000050/inspection-photo.jpg','inspection-photo.jpg','image/jpeg',100,auth.uid())
RETURNING id AS inspection_file_id \gset
INSERT INTO public.crm_inspection_photos(inspection_id,file_id)
VALUES ('00000000-0000-0000-0000-000000000050', :'inspection_file_id');

DO $body$
BEGIN
  IF (SELECT count(*) FROM storage.objects
      WHERE name='TRD/inspections/00000000-0000-0000-0000-000000000050/inspection-photo.jpg') <> 1 THEN
    RAISE EXCEPTION 'Field inspector could not read a registered inspection photo';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='crm_private_files_read') THEN
    RAISE EXCEPTION 'Broad division-wide private file read policy still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='crm_files' AND policyname='crm_files_insert') THEN
    RAISE EXCEPTION 'Broad CRM file metadata insert policy still exists';
  END IF;
END
$body$;

RESET ROLE;
SELECT 'project pipeline migration test passed' AS result;
