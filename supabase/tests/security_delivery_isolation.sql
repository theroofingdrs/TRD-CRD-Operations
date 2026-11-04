-- Contract guards confer no new browser/service private authority.
do $$ declare t text; begin
 if has_function_privilege('authenticated','delivery_private.require_context_read_committed()','EXECUTE')
  or has_function_privilege('service_role','delivery_private.require_context_read_committed()','EXECUTE')
  or has_function_privilege('anon','delivery_private.source_context_isolation()','EXECUTE') then
  raise exception 'Isolation guard execution exposed';
 end if;
 foreach t in array array['public.crm_proposals','public.crm_customers','public.crm_properties','public.crm_proposal_templates','public.crm_files','storage.objects'] loop
  if not exists(select 1 from pg_trigger where tgrelid=t::regclass and tgname='aaa_proposal_context_isolation'
    and not tgisinternal and tgenabled='O' and tgtype=30) then
   raise exception 'Missing enabled statement INSERT/UPDATE/DELETE isolation guard on %',t;
  end if;
 end loop;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='delivery_private' and p.proname in ('require_context_read_committed','source_context_isolation')
   and p.proconfig is distinct from array['search_path=""']) then raise exception 'Unsafe isolation helper search_path'; end if;
end $$;
