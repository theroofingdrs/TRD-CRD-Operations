-- The public blog Edge Function uses the service role to enforce its own
-- published/scheduled visibility filter. RLS bypass does not replace SQL grants.
grant select on table public.crm_blog_posts to service_role;
