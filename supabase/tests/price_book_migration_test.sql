-- Disposable PostgreSQL test for the TRD / CRD editable price book migration.
-- Never run against production.
\set ON_ERROR_STOP on
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $body$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $body$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS app_private;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $body$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $body$;
CREATE TABLE public.crm_divisions(id text PRIMARY KEY);
CREATE TABLE public.crm_memberships(user_id uuid NOT NULL,division_id text NOT NULL,role text NOT NULL,active boolean NOT NULL DEFAULT true,PRIMARY KEY(user_id,division_id));
CREATE OR REPLACE FUNCTION app_private.has_division_resource_access(p_division_id text,p_resource text,p_write boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $body$ SELECT EXISTS(SELECT 1 FROM public.crm_memberships m WHERE m.user_id=(SELECT auth.uid()) AND m.division_id=p_division_id AND m.active AND (NOT p_write OR m.role IN ('owner','division_admin','office_manager','sales_rep'))) $body$;
CREATE OR REPLACE FUNCTION app_private.is_crm_owner()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $body$ SELECT EXISTS(SELECT 1 FROM public.crm_memberships m WHERE m.user_id=(SELECT auth.uid()) AND m.active AND m.role='owner') $body$;
GRANT USAGE ON SCHEMA auth,app_private TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.has_division_resource_access(text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.is_crm_owner() TO authenticated;
INSERT INTO public.crm_divisions(id) VALUES ('TRD'),('CRD');
INSERT INTO auth.users(id) VALUES ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
INSERT INTO public.crm_memberships(user_id,division_id,role) VALUES
 ('00000000-0000-0000-0000-000000000001','TRD','owner'),
 ('00000000-0000-0000-0000-000000000001','CRD','owner'),
 ('00000000-0000-0000-0000-000000000002','CRD','read_only');
\ir ../migrations/20261031190000_add_editable_price_book.sql
\ir ../migrations/20261031230000_seed_all_in_roofing_prices.sql
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
SET ROLE authenticated;
INSERT INTO public.crm_price_book(division_id,category,description,unit,unit_price,updated_by)
VALUES ('TRD','Unpriced catalog','Unpriced starter item','SQ',NULL,auth.uid()),
       ('TRD','Decking','7/16 inch OSB roof decking sheet','SHEET',38.75,auth.uid());
DO $body$
BEGIN
  IF (SELECT count(*) FROM public.crm_price_book
      WHERE unit_price IS NOT NULL
        AND ((division_id='TRD' AND category='Residential Roofing')
          OR (division_id='CRD' AND category='Commercial Roofing')
          OR category='Repairs and Other')) <> 55 THEN
    RAISE EXCEPTION 'Expected exactly 55 verified owner-supplied all-in rates';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='crm_price_book'
        AND column_name IN ('material_unit_price','labor_unit_price')) THEN
    RAISE EXCEPTION 'Price book must store one all-in unit price, not split material/labor fields';
  END IF;
  IF (SELECT unit_price FROM public.crm_price_book WHERE division_id='TRD' AND category='Residential Roofing' AND description='Architectural shingles' AND unit='SQ') <> 295.00 THEN
    RAISE EXCEPTION 'TRD all-in architectural shingle rate was not seeded';
  END IF;
  IF (SELECT unit_price FROM public.crm_price_book WHERE division_id='CRD' AND category='Commercial Roofing' AND description='TPO roofing system' AND unit='SQ') <> 870.00 THEN
    RAISE EXCEPTION 'CRD all-in TPO rate was not seeded';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.crm_price_book WHERE division_id='TRD' AND unit='SQ' AND unit_price IS NULL) THEN
    RAISE EXCEPTION 'Blank unit price was not preserved';
  END IF;
  IF (SELECT unit_price FROM public.crm_price_book WHERE division_id='TRD' AND category='Decking' AND description='7/16 inch OSB roof decking sheet' AND unit='SHEET') <> 38.75 THEN
    RAISE EXCEPTION 'Entered unit price was not saved precisely';
  END IF;
END $body$;
RESET ROLE;
SELECT 'price book migration test passed' AS result;
