-- Preserve the source invoice and payment receipt for every project transaction.
ALTER TABLE public.crm_project_transactions
  ADD COLUMN IF NOT EXISTS attachment_file_id uuid REFERENCES public.crm_files(id);
CREATE INDEX IF NOT EXISTS crm_project_transactions_attachment_idx
  ON public.crm_project_transactions (attachment_file_id)
  WHERE attachment_file_id IS NOT NULL;

CREATE POLICY crm_files_project_transaction_insert ON public.crm_files
  FOR INSERT TO authenticated
  WITH CHECK (
    related_type = 'project'
    AND metadata->>'document_category' IN ('invoice_document','payment_receipt')
    AND app_private.has_division_financial_access(division_id, true)
    AND (uploaded_by IS NULL OR uploaded_by = (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.crm_projects p
      WHERE p.id = crm_files.related_id AND p.division_id = crm_files.division_id
    )
  );

CREATE POLICY crm_files_project_transaction_read ON public.crm_files
  FOR SELECT TO authenticated
  USING (
    related_type = 'project'
    AND metadata->>'document_category' IN ('invoice_document','payment_receipt')
    AND app_private.has_division_financial_access(division_id, false)
    AND EXISTS (
      SELECT 1 FROM public.crm_project_transactions t
      WHERE t.attachment_file_id = crm_files.id AND t.division_id = crm_files.division_id
    )
  );

CREATE OR REPLACE FUNCTION app_private.is_project_transaction_file(
  p_file_id uuid,
  p_division_id text,
  p_project_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_files f
    WHERE f.id = p_file_id
      AND f.division_id = p_division_id
      AND f.related_type = 'project'
      AND f.related_id = p_project_id
      AND f.metadata->>'document_category' IN ('invoice_document','payment_receipt')
  );
$function$;
REVOKE ALL ON FUNCTION app_private.is_project_transaction_file(uuid,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.is_project_transaction_file(uuid,text,uuid) TO authenticated;

DROP POLICY IF EXISTS crm_project_transactions_update ON public.crm_project_transactions;
CREATE POLICY crm_project_transactions_update ON public.crm_project_transactions
  FOR UPDATE TO authenticated
  USING (app_private.has_division_financial_access(division_id, true))
  WITH CHECK (
    app_private.has_division_financial_access(division_id, true)
    AND EXISTS (
      SELECT 1 FROM public.crm_projects p
      WHERE p.id = crm_project_transactions.project_id AND p.division_id = crm_project_transactions.division_id
    )
    AND (
      attachment_file_id IS NULL
      OR app_private.is_project_transaction_file(
        crm_project_transactions.attachment_file_id,
        crm_project_transactions.division_id,
        crm_project_transactions.project_id
      )
    )
  );
