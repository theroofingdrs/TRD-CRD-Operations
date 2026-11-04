-- READ ONLY. Run later with approved administrative catalog access, never a browser key.
-- This script inspects configuration and metadata, not customer rows or secrets.
begin read only;
select version,name from supabase_migrations.schema_migrations order by version;
select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname in ('public','storage','intake_private','file_private','delivery_private') order by 1,2,3;
select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and (n.nspname in ('intake_private','file_private','delivery_private') or c.relname like 'crm_%' or c.relname='trd_records');
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,p.prosecdef,p.proconfig,p.proacl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('intake_private','file_private','delivery_private') or (n.nspname='public' and p.proname like 'crm_%') order by 1,2;
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id in ('roof-doctors-private','roof-doctors-public');
select grantee,table_schema,table_name,privilege_type from information_schema.role_table_grants where table_schema in ('intake_private','file_private','delivery_private') or table_name='trd_records' or table_name like 'crm_%' order by 1,2,3,4;
-- Unknown appointment end times conservatively block subsequent booking capacity.
select count(*) as active_appointments_without_end from public.crm_appointments where status not in ('cancelled','completed','no_show') and ends_at is null;
-- Default grants and schema visibility can undo otherwise correct table RLS.
select defaclrole::regrole,defaclnamespace::regnamespace,defaclobjtype,defaclacl from pg_default_acl;
select nspname,nspacl from pg_namespace where nspname in ('public','app_private','intake_private','file_private','delivery_private');
select id,enabled from intake_private.booking_settings;
select id,capture_enabled,delivery_enabled,reminder_minutes from intake_private.notification_settings;
-- Only counts: no customer or employee record contents.
select count(*) as inconsistent_appointment_links from public.crm_appointments a join public.crm_leads l on l.id=a.lead_id where a.division_id<>l.division_id or (a.customer_id is not null and l.customer_id is not null and a.customer_id<>l.customer_id) or (a.property_id is not null and l.property_id is not null and a.property_id<>l.property_id);
rollback;
