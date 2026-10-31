-- Migration recorded in Supabase production history as 20261031004739.
-- Restrict direct execution of the SECURITY DEFINER event trigger function.
-- The ensure_rls event trigger remains enabled and continues to enforce RLS
-- on newly created public tables.

REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
