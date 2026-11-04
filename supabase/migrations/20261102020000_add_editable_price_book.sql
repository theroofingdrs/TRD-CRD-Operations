-- TRD / CRD editable price book. Prices intentionally start blank.
-- Starter descriptions are maintained in src/estimateCatalog.ts; only verified prices are stored here.
CREATE TABLE public.crm_price_book (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL REFERENCES public.crm_divisions(id),
  category text NOT NULL CHECK (length(trim(category)) BETWEEN 1 AND 100),
  item_code text,
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 240),
  unit text NOT NULL CHECK (unit IN ('SQ','SF','LF','EA','HR','DAY','WK','MO','LS','CY','SHEET','ROLL','GAL','BDL','BOX','PAIL','TUBE','PALLET')),
  unit_price numeric(14,2) CHECK (unit_price IS NULL OR unit_price >= 0),
  is_active boolean NOT NULL DEFAULT true,
  effective_from date,
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (division_id, category, description, unit)
);
CREATE INDEX crm_price_book_division_category_idx ON public.crm_price_book (division_id, category, is_active, description);
ALTER TABLE public.crm_price_book ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_price_book_read ON public.crm_price_book FOR SELECT TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'leads', false));
CREATE POLICY crm_price_book_insert ON public.crm_price_book FOR INSERT TO authenticated
  WITH CHECK (app_private.is_crm_owner() AND (updated_by IS NULL OR updated_by = (SELECT auth.uid())));
CREATE POLICY crm_price_book_update ON public.crm_price_book FOR UPDATE TO authenticated
  USING (app_private.is_crm_owner()) WITH CHECK (app_private.is_crm_owner());
CREATE POLICY crm_price_book_delete ON public.crm_price_book FOR DELETE TO authenticated
  USING (app_private.is_crm_owner());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_price_book TO authenticated;
