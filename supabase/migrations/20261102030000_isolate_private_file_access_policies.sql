-- Keep private object-storage paths aligned with their CRM record-level RLS policies.
-- Generic property files use one-level paths: TRD/<uuid>-filename.
-- Financial, supplement, and inspection files use resource-specific paths and policies.

DROP POLICY IF EXISTS crm_files_insert ON public.crm_files;
DROP POLICY IF EXISTS crm_files_read ON public.crm_files;

CREATE POLICY crm_files_property_insert ON public.crm_files
  FOR INSERT TO authenticated
  WITH CHECK (
    related_type = 'property'
    AND app_private.has_division_resource_access(division_id, 'files', true)
    AND (uploaded_by IS NULL OR uploaded_by = (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1
      FROM public.crm_properties p
      JOIN public.crm_customer_divisions cd ON cd.customer_id = p.customer_id
      WHERE p.id = crm_files.related_id
        AND cd.division_id = crm_files.division_id
    )
  );

CREATE POLICY crm_files_property_read ON public.crm_files
  FOR SELECT TO authenticated
  USING (
    related_type = 'property'
    AND app_private.has_division_resource_access(division_id, 'files', false)
    AND EXISTS (
      SELECT 1
      FROM public.crm_properties p
      JOIN public.crm_customer_divisions cd ON cd.customer_id = p.customer_id
      WHERE p.id = crm_files.related_id
        AND cd.division_id = crm_files.division_id
    )
  );

CREATE POLICY crm_files_inspection_insert ON public.crm_files
  FOR INSERT TO authenticated
  WITH CHECK (
    related_type = 'inspection'
    AND app_private.has_division_resource_access(division_id, 'inspections', true)
    AND (uploaded_by IS NULL OR uploaded_by = (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.crm_inspections i
      WHERE i.id = crm_files.related_id AND i.division_id = crm_files.division_id
    )
  );

CREATE POLICY crm_files_inspection_read ON public.crm_files
  FOR SELECT TO authenticated
  USING (
    related_type = 'inspection'
    AND app_private.has_division_resource_access(division_id, 'inspections', false)
    AND EXISTS (
      SELECT 1
      FROM public.crm_inspection_photos ip
      JOIN public.crm_inspections i ON i.id = ip.inspection_id
      WHERE ip.file_id = crm_files.id
        AND ip.inspection_id = crm_files.related_id
        AND i.division_id = crm_files.division_id
    )
  );

-- Remove the division-wide generic storage policies. Their permissive OR behavior
-- otherwise overrides the narrower policies for financial and project attachments.
DROP POLICY IF EXISTS crm_private_files_insert ON storage.objects;
DROP POLICY IF EXISTS crm_private_files_read ON storage.objects;
DROP POLICY IF EXISTS crm_private_files_update ON storage.objects;

CREATE POLICY crm_private_property_files_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'roof-doctors-private'
    AND COALESCE(array_length(storage.foldername(name), 1), 0) = 1
    AND (storage.foldername(name))[1] IN ('TRD','CRD')
    AND app_private.has_division_resource_access((storage.foldername(name))[1], 'files', true)
  );

CREATE POLICY crm_private_property_files_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'roof-doctors-private'
    AND COALESCE(array_length(storage.foldername(name), 1), 0) = 1
    AND (storage.foldername(name))[1] IN ('TRD','CRD')
    AND EXISTS (
      SELECT 1
      FROM public.crm_files f
      JOIN public.crm_properties p ON p.id = f.related_id
      JOIN public.crm_customer_divisions cd ON cd.customer_id = p.customer_id
      WHERE f.bucket_id = storage.objects.bucket_id
        AND f.object_path = storage.objects.name
        AND f.related_type = 'property'
        AND f.division_id = (storage.foldername(name))[1]
        AND cd.division_id = f.division_id
        AND app_private.has_division_resource_access(f.division_id, 'files', false)
    )
  );

CREATE POLICY crm_private_property_files_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'roof-doctors-private'
    AND COALESCE(array_length(storage.foldername(name), 1), 0) = 1
    AND (storage.foldername(name))[1] IN ('TRD','CRD')
    AND app_private.has_division_resource_access((storage.foldername(name))[1], 'files', true)
  )
  WITH CHECK (
    bucket_id = 'roof-doctors-private'
    AND COALESCE(array_length(storage.foldername(name), 1), 0) = 1
    AND (storage.foldername(name))[1] IN ('TRD','CRD')
    AND app_private.has_division_resource_access((storage.foldername(name))[1], 'files', true)
  );

-- Inspection photos use TRD/inspections/<inspection-id>/<filename>.
CREATE POLICY crm_inspection_photos_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'roof-doctors-private'
    AND (storage.foldername(name))[1] IN ('TRD','CRD')
    AND (storage.foldername(name))[2] = 'inspections'
    AND COALESCE(array_length(storage.foldername(name), 1), 0) = 3
    AND app_private.has_division_resource_access((storage.foldername(name))[1], 'inspections', true)
    AND EXISTS (
      SELECT 1 FROM public.crm_inspections i
      WHERE i.id::text = (storage.foldername(name))[3]
        AND i.division_id = (storage.foldername(name))[1]
    )
  );

CREATE POLICY crm_inspection_photos_storage_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'roof-doctors-private'
    AND (storage.foldername(name))[1] IN ('TRD','CRD')
    AND (storage.foldername(name))[2] = 'inspections'
    AND COALESCE(array_length(storage.foldername(name), 1), 0) = 3
    AND app_private.has_division_resource_access((storage.foldername(name))[1], 'inspections', false)
    AND EXISTS (
      SELECT 1
      FROM public.crm_files f
      JOIN public.crm_inspection_photos ip ON ip.file_id = f.id
      JOIN public.crm_inspections i ON i.id = ip.inspection_id
      WHERE f.bucket_id = storage.objects.bucket_id
        AND f.object_path = storage.objects.name
        AND f.related_type = 'inspection'
        AND f.related_id = i.id
        AND i.id::text = (storage.foldername(name))[3]
        AND i.division_id = (storage.foldername(name))[1]
    )
  );

-- Supplement attachments share the project folder but require project-write access.
CREATE POLICY crm_project_supplement_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'roof-doctors-private'
    AND (storage.foldername(name))[1] IN ('TRD','CRD')
    AND COALESCE(array_length(storage.foldername(name), 1), 0) = 2
    AND app_private.has_division_resource_access((storage.foldername(name))[1], 'projects', true)
    AND EXISTS (
      SELECT 1 FROM public.crm_projects p
      WHERE p.id::text = (storage.foldername(name))[2]
        AND p.division_id = (storage.foldername(name))[1]
    )
  );

CREATE POLICY crm_project_supplement_storage_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'roof-doctors-private'
    AND (storage.foldername(name))[1] IN ('TRD','CRD')
    AND COALESCE(array_length(storage.foldername(name), 1), 0) = 2
    AND app_private.has_division_resource_access((storage.foldername(name))[1], 'projects', false)
    AND EXISTS (
      SELECT 1
      FROM public.crm_files f
      JOIN public.crm_project_supplements s ON s.id = f.related_id
      JOIN public.crm_projects p ON p.id = s.project_id
      WHERE f.bucket_id = storage.objects.bucket_id
        AND f.object_path = storage.objects.name
        AND f.related_type = 'supplement'
        AND f.metadata->>'document_category' = 'supplement_attachment'
        AND p.id::text = (storage.foldername(name))[2]
        AND p.division_id = (storage.foldername(name))[1]
    )
  );

-- Financial file downloads require a linked expense/transaction record, not merely a project folder.
DROP POLICY IF EXISTS project_expense_receipts_storage_insert ON storage.objects;
CREATE POLICY project_expense_receipts_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'roof-doctors-private'
    AND (storage.foldername(name))[1] IN ('TRD','CRD')
    AND COALESCE(array_length(storage.foldername(name), 1), 0) = 2
    AND EXISTS (
      SELECT 1 FROM public.crm_projects p
      WHERE p.id::text = (storage.foldername(name))[2]
        AND p.division_id = (storage.foldername(name))[1]
        AND app_private.has_division_financial_access(p.division_id, true)
    )
  );

DROP POLICY IF EXISTS project_expense_receipts_storage_read ON storage.objects;
CREATE POLICY project_expense_receipts_storage_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'roof-doctors-private'
    AND (storage.foldername(name))[1] IN ('TRD','CRD')
    AND COALESCE(array_length(storage.foldername(name), 1), 0) = 2
    AND EXISTS (
      SELECT 1
      FROM public.crm_files f
      JOIN public.crm_project_expenses e ON e.receipt_file_id = f.id
      JOIN public.crm_projects p ON p.id = e.project_id
      WHERE f.bucket_id = storage.objects.bucket_id
        AND f.object_path = storage.objects.name
        AND f.related_type = 'project'
        AND f.metadata->>'document_category' = 'expense_receipt'
        AND p.id::text = (storage.foldername(name))[2]
        AND p.division_id = (storage.foldername(name))[1]
        AND app_private.has_division_financial_access(p.division_id, false)
    )
  );

CREATE POLICY crm_project_transaction_storage_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'roof-doctors-private'
    AND (storage.foldername(name))[1] IN ('TRD','CRD')
    AND COALESCE(array_length(storage.foldername(name), 1), 0) = 2
    AND EXISTS (
      SELECT 1
      FROM public.crm_files f
      JOIN public.crm_project_transactions t ON t.attachment_file_id = f.id
      JOIN public.crm_projects p ON p.id = t.project_id
      WHERE f.bucket_id = storage.objects.bucket_id
        AND f.object_path = storage.objects.name
        AND f.related_type = 'project'
        AND f.metadata->>'document_category' IN ('invoice_document','payment_receipt')
        AND p.id::text = (storage.foldername(name))[2]
        AND p.division_id = (storage.foldername(name))[1]
        AND app_private.has_division_financial_access(p.division_id, false)
    )
  );

DROP POLICY IF EXISTS company_expense_receipts_storage_insert ON storage.objects;
CREATE POLICY company_expense_receipts_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'roof-doctors-private'
    AND (storage.foldername(name))[1] IN ('TRD','CRD')
    AND (storage.foldername(name))[2] = 'company-expenses'
    AND COALESCE(array_length(storage.foldername(name), 1), 0) = 2
    AND app_private.has_division_financial_access((storage.foldername(name))[1], true)
  );

DROP POLICY IF EXISTS company_expense_receipts_storage_read ON storage.objects;
CREATE POLICY company_expense_receipts_storage_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'roof-doctors-private'
    AND (storage.foldername(name))[1] IN ('TRD','CRD')
    AND (storage.foldername(name))[2] = 'company-expenses'
    AND COALESCE(array_length(storage.foldername(name), 1), 0) = 2
    AND EXISTS (
      SELECT 1
      FROM public.crm_files f
      JOIN public.crm_company_expenses e ON e.receipt_file_id = f.id
      WHERE f.bucket_id = storage.objects.bucket_id
        AND f.object_path = storage.objects.name
        AND f.related_type = 'company_expense'
        AND f.metadata->>'document_category' = 'company_expense_receipt'
        AND f.division_id = (storage.foldername(name))[1]
        AND app_private.has_division_financial_access(f.division_id, false)
    )
  );
