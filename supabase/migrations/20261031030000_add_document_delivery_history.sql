-- Stage 3: document delivery audit trail.
CREATE TABLE public.crm_document_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL REFERENCES public.crm_divisions(id),
  document_type text NOT NULL CHECK (document_type IN ('proposal','inspection','warranty')),
  document_id uuid NOT NULL,
  customer_id uuid NOT NULL REFERENCES public.crm_customers(id),
  property_id uuid NOT NULL REFERENCES public.crm_properties(id),
  recipient_email text NOT NULL,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending','sent','failed')),
  provider_message_id text,
  error_message text,
  created_by uuid REFERENCES auth.users(id),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_document_deliveries_document_idx ON public.crm_document_deliveries(division_id, document_type, document_id, created_at DESC);
ALTER TABLE public.crm_document_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_document_deliveries_read ON public.crm_document_deliveries
  FOR SELECT TO authenticated
  USING (app_private.has_division_resource_access(division_id,
    CASE document_type WHEN 'proposal' THEN 'leads' WHEN 'inspection' THEN 'inspections' ELSE 'projects' END, false));
CREATE POLICY crm_document_deliveries_insert ON public.crm_document_deliveries
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.has_division_resource_access(division_id,
      CASE document_type WHEN 'proposal' THEN 'leads' WHEN 'inspection' THEN 'inspections' ELSE 'projects' END, true)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND (
      (document_type = 'proposal' AND EXISTS (SELECT 1 FROM public.crm_proposals p WHERE p.id = crm_document_deliveries.document_id AND p.division_id = crm_document_deliveries.division_id AND p.customer_id = crm_document_deliveries.customer_id AND p.property_id = crm_document_deliveries.property_id))
      OR (document_type = 'inspection' AND EXISTS (SELECT 1 FROM public.crm_inspections i WHERE i.id = crm_document_deliveries.document_id AND i.division_id = crm_document_deliveries.division_id AND i.customer_id = crm_document_deliveries.customer_id AND i.property_id = crm_document_deliveries.property_id))
      OR (document_type = 'warranty' AND EXISTS (SELECT 1 FROM public.crm_warranties w WHERE w.id = crm_document_deliveries.document_id AND w.division_id = crm_document_deliveries.division_id AND w.customer_id = crm_document_deliveries.customer_id AND w.property_id = crm_document_deliveries.property_id))
    )
  );
CREATE POLICY crm_document_deliveries_update ON public.crm_document_deliveries
  FOR UPDATE TO authenticated
  USING (app_private.has_division_resource_access(division_id,
    CASE document_type WHEN 'proposal' THEN 'leads' WHEN 'inspection' THEN 'inspections' ELSE 'projects' END, true))
  WITH CHECK (app_private.has_division_resource_access(division_id,
    CASE document_type WHEN 'proposal' THEN 'leads' WHEN 'inspection' THEN 'inspections' ELSE 'projects' END, true));
GRANT SELECT, INSERT ON public.crm_document_deliveries TO authenticated;
GRANT UPDATE (status, provider_message_id, error_message, sent_at) ON public.crm_document_deliveries TO authenticated;
