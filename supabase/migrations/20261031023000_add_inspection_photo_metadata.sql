-- Stage 2: structured inspection photo captions and labels.
-- Files remain in the existing private roof-doctors-private bucket.
CREATE TABLE public.crm_inspection_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL REFERENCES public.crm_divisions(id),
  inspection_id uuid NOT NULL REFERENCES public.crm_inspections(id) ON DELETE CASCADE,
  inspection_item_id uuid REFERENCES public.crm_inspection_items(id) ON DELETE SET NULL,
  file_id uuid NOT NULL REFERENCES public.crm_files(id) ON DELETE CASCADE,
  photo_label text NOT NULL DEFAULT 'Inspection photo',
  caption text,
  roof_section text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_inspection_photos_inspection_idx ON public.crm_inspection_photos(inspection_id, created_at);
ALTER TABLE public.crm_inspection_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_inspection_photos_read ON public.crm_inspection_photos
  FOR SELECT TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'inspections', false));
CREATE POLICY crm_inspection_photos_insert ON public.crm_inspection_photos
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.has_division_resource_access(division_id, 'inspections', true)
    AND EXISTS (SELECT 1 FROM public.crm_inspections i WHERE i.id = inspection_id AND i.division_id = division_id)
    AND EXISTS (SELECT 1 FROM public.crm_files f WHERE f.id = file_id AND f.division_id = division_id AND f.related_type = 'inspection' AND f.related_id = inspection_id)
    AND (inspection_item_id IS NULL OR EXISTS (SELECT 1 FROM public.crm_inspection_items ii WHERE ii.id = inspection_item_id AND ii.inspection_id = inspection_id))
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
  );
CREATE POLICY crm_inspection_photos_update ON public.crm_inspection_photos
  FOR UPDATE TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'inspections', true))
  WITH CHECK (
    app_private.has_division_resource_access(division_id, 'inspections', true)
    AND EXISTS (SELECT 1 FROM public.crm_inspections i WHERE i.id = inspection_id AND i.division_id = division_id)
    AND EXISTS (SELECT 1 FROM public.crm_files f WHERE f.id = file_id AND f.division_id = division_id AND f.related_type = 'inspection' AND f.related_id = inspection_id)
    AND (inspection_item_id IS NULL OR EXISTS (SELECT 1 FROM public.crm_inspection_items ii WHERE ii.id = inspection_item_id AND ii.inspection_id = inspection_id))
  );
CREATE POLICY crm_inspection_photos_delete ON public.crm_inspection_photos
  FOR DELETE TO authenticated
  USING (app_private.is_crm_owner());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_inspection_photos TO authenticated;
