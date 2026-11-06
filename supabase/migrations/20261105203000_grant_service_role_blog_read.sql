-- crm_blog_posts is public-readable only through its published/scheduled RLS
-- policy. Keep the API grants narrowly aligned with the CMS and public reader.
revoke all privileges on table public.crm_blog_posts from anon;
grant select on table public.crm_blog_posts to anon;

revoke truncate, references, trigger, maintain
  on table public.crm_blog_posts from authenticated;

-- The public Edge Function only reads this table; RLS bypass does not replace
-- SQL grants, and the service key does not need write or table-maintenance rights.
revoke all privileges on table public.crm_blog_posts from service_role;
grant select on table public.crm_blog_posts to service_role;
