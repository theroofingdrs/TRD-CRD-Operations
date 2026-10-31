-- Division-level company expense ledger. These costs remain separate from project overhead allocations.
CREATE TABLE public.crm_company_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL REFERENCES public.crm_divisions(id),
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  category text NOT NULL CHECK (category IN (
    'overhead','rent','utilities','insurance','vehicles','fuel','marketing',
    'software','office_supplies','professional_services','taxes_fees','other'
  )),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0 AND paid_amount <= amount),
  payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid','partially_paid','paid')),
  vendor_payee text,
  description text,
  notes text,
  receipt_file_id uuid REFERENCES public.crm_files(id),
  entered_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (payment_status = 'unpaid' AND paid_amount = 0)
    OR (payment_status = 'partially_paid' AND paid_amount > 0 AND paid_amount < amount)
    OR (payment_status = 'paid' AND paid_amount = amount)
  )
);
CREATE INDEX crm_company_expenses_division_date_idx
  ON public.crm_company_expenses (division_id, expense_date DESC);
CREATE INDEX crm_company_expenses_payment_idx
  ON public.crm_company_expenses (division_id, payment_status, expense_date DESC);
ALTER TABLE public.crm_company_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_company_expenses_read ON public.crm_company_expenses
  FOR SELECT TO authenticated
  USING (app_private.has_division_financial_access(division_id, false));
CREATE POLICY crm_company_expenses_insert ON public.crm_company_expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.has_division_financial_access(division_id, true)
    AND (entered_by IS NULL OR entered_by = (SELECT auth.uid()))
  );
CREATE POLICY crm_company_expenses_update ON public.crm_company_expenses
  FOR UPDATE TO authenticated
  USING (app_private.has_division_financial_access(division_id, true))
  WITH CHECK (app_private.has_division_financial_access(division_id, true));
GRANT SELECT, INSERT, UPDATE ON public.crm_company_expenses TO authenticated;

CREATE TABLE public.crm_company_expense_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL REFERENCES public.crm_divisions(id),
  expense_id uuid NOT NULL REFERENCES public.crm_company_expenses(id),
  changed_by uuid REFERENCES auth.users(id),
  before_values jsonb NOT NULL,
  after_values jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_company_expense_history_expense_idx
  ON public.crm_company_expense_history (expense_id, changed_at DESC);
ALTER TABLE public.crm_company_expense_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_company_expense_history_read ON public.crm_company_expense_history
  FOR SELECT TO authenticated
  USING (app_private.has_division_financial_access(division_id, false));
CREATE POLICY crm_company_expense_history_insert ON public.crm_company_expense_history
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.has_division_financial_access(division_id, true)
    AND EXISTS (
      SELECT 1 FROM public.crm_company_expenses e
      WHERE e.id = crm_company_expense_history.expense_id
        AND e.division_id = crm_company_expense_history.division_id
    )
  );
GRANT SELECT, INSERT ON public.crm_company_expense_history TO authenticated;

CREATE OR REPLACE FUNCTION app_private.log_company_expense_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.crm_company_expense_history
    (division_id, expense_id, changed_by, before_values, after_values)
  VALUES
    (NEW.division_id, NEW.id, (SELECT auth.uid()), to_jsonb(OLD), to_jsonb(NEW));
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.log_company_expense_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER crm_company_expenses_log_update
  AFTER UPDATE ON public.crm_company_expenses
  FOR EACH ROW EXECUTE FUNCTION app_private.log_company_expense_change();

-- Actual company receipts are stored separately from project receipts and overhead allocations.
CREATE POLICY crm_files_company_expense_insert ON public.crm_files
  FOR INSERT TO authenticated
  WITH CHECK (
    related_type = 'company_expense'
    AND metadata->>'document_category' = 'company_expense_receipt'
    AND app_private.has_division_financial_access(division_id, true)
    AND (uploaded_by IS NULL OR uploaded_by = (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.crm_company_expenses e
      WHERE e.id = crm_files.related_id AND e.division_id = crm_files.division_id
    )
  );
CREATE POLICY crm_files_company_expense_read ON public.crm_files
  FOR SELECT TO authenticated
  USING (
    related_type = 'company_expense'
    AND metadata->>'document_category' = 'company_expense_receipt'
    AND app_private.has_division_financial_access(division_id, false)
    AND EXISTS (
      SELECT 1 FROM public.crm_company_expenses e
      WHERE e.receipt_file_id = crm_files.id AND e.division_id = crm_files.division_id
    )
  );

CREATE POLICY company_expense_receipts_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'roof-doctors-private'
    AND (storage.foldername(name))[1] IN ('TRD','CRD')
    AND (storage.foldername(name))[2] = 'company-expenses'
    AND app_private.has_division_financial_access((storage.foldername(name))[1], true)
  );
CREATE POLICY company_expense_receipts_storage_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'roof-doctors-private'
    AND (storage.foldername(name))[1] IN ('TRD','CRD')
    AND (storage.foldername(name))[2] = 'company-expenses'
    AND app_private.has_division_financial_access((storage.foldername(name))[1], false)
  );
