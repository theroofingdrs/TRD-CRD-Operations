-- Separate material and labor unit pricing while retaining the legacy column for backward compatibility.
ALTER TABLE public.crm_price_book
  ADD COLUMN IF NOT EXISTS material_unit_price numeric(14,2) CHECK (material_unit_price IS NULL OR material_unit_price >= 0),
  ADD COLUMN IF NOT EXISTS labor_unit_price numeric(14,2) CHECK (labor_unit_price IS NULL OR labor_unit_price >= 0);

COMMENT ON COLUMN public.crm_price_book.material_unit_price IS 'Verified material-only price per catalog unit.';
COMMENT ON COLUMN public.crm_price_book.labor_unit_price IS 'Verified labor-only price per catalog unit.';
