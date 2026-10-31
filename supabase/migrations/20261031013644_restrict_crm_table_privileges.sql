-- Migration recorded in Supabase production history as 20261031013644.
-- Remove non row-level privileges from the CRM API roles. TRUNCATE bypasses
-- row level security, so neither anonymous nor authenticated API roles should
-- hold it. Authenticated CRUD remains governed by the existing CRM RLS policies.

DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname LIKE 'crm_%'
      AND c.relkind = 'r'
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', item.relname);
    EXECUTE format('REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.%I FROM authenticated', item.relname);
  END LOOP;
END;
$$;
