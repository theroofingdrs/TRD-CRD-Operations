-- READ ONLY. Run later with approved administrative catalog access, never a browser key.
-- This script inspects configuration and metadata, not customer rows or secrets.
begin read only;
select version,name from supabase_migrations.schema_migrations order by version;
select schemaname,tablename,policyname,roles,cmd from pg_policies where schemaname in ('public','storage','intake_private','file_private','delivery_private') order by 1,2,3;
select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname in ('intake_private','file_private','delivery_private') or c.relname like 'crm_%' or c.relname='trd_records');
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,p.prosecdef,p.proconfig,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('intake_private','file_private','delivery_private') or (n.nspname='public' and p.proname like 'crm_%') order by 1,2;
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id in ('roof-doctors-private','roof-doctors-public');
select grantee,table_schema,table_name,privilege_type from information_schema.role_table_grants where table_schema in ('intake_private','file_private','delivery_private') or table_name='trd_records' order by 1,2,3,4;
rollback;
