-- Synthetic identities only. Run after the actual baseline and ordered migrations.
insert into auth.users(id,email) values
('10000000-0000-0000-0000-000000000001','owner@example.test'),
('10000000-0000-0000-0000-000000000002','unlinked@example.test'),
('10000000-0000-0000-0000-000000000003','other@example.test');
insert into public.crm_divisions(id,name,business_scope) values ('TRD','Test residential','Residential'),('CRD','Test commercial','Commercial') on conflict(id) do nothing;
insert into public.crm_memberships(user_id,division_id,role) values ('10000000-0000-0000-0000-000000000001','TRD','owner'),('10000000-0000-0000-0000-000000000003','CRD','owner');
insert into public.crm_customers(id,customer_type,display_name,email) values ('20000000-0000-0000-0000-000000000001','individual','Synthetic customer','customer@example.test');
insert into public.crm_customer_divisions(customer_id,division_id) values ('20000000-0000-0000-0000-000000000001','TRD');
insert into public.crm_properties(id,customer_id,address_line1,city,state) values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Synthetic','Test','TX');
insert into public.crm_proposals(id,division_id,customer_id,property_id,title,updated_at) values
('40000000-0000-0000-0000-000000000001','TRD','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Synthetic proposal','2026-11-03T00:00:00Z');
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
select set_config('request.jwt.claim.role','authenticated',false);
do $$ begin
 begin insert into public.crm_document_deliveries(division_id,document_type,document_id,customer_id,property_id,recipient_email,subject,status) values('TRD','proposal','40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','x@example.test','forged','sent'); raise exception 'Client forged delivery'; exception when insufficient_privilege then null; end;
 begin update public.crm_proposals set status='sent' where id='40000000-0000-0000-0000-000000000001'; raise exception 'Client forged sent'; exception when insufficient_privilege then null; end;
 begin perform public.crm_claim_document_delivery('10000000-0000-0000-0000-000000000001','proposal','40000000-0000-0000-0000-000000000001','2026-11-03T00:00:00Z','{}',repeat('a',64)); raise exception 'Client invoked server path'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role service_role;
select set_config('request.jwt.claim.role','service_role',false);
do $$ declare op jsonb; duplicate jsonb; begin
 begin perform public.crm_claim_document_delivery('10000000-0000-0000-0000-000000000002','proposal','40000000-0000-0000-0000-000000000001','2026-11-03T00:00:00Z','{"to":["customer@example.test"],"subject":"Test"}',repeat('a',64)); raise exception 'Unlinked actor sent'; exception when insufficient_privilege then null; end;
 begin perform public.crm_claim_document_delivery('10000000-0000-0000-0000-000000000003','proposal','40000000-0000-0000-0000-000000000001','2026-11-03T00:00:00Z','{"to":["customer@example.test"],"subject":"Test"}',repeat('a',64)); raise exception 'Wrong division actor sent'; exception when insufficient_privilege then null; end;
 op:=public.crm_claim_document_delivery('10000000-0000-0000-0000-000000000001','proposal','40000000-0000-0000-0000-000000000001','2026-11-03T00:00:00Z','{"to":["customer@example.test"],"subject":"Test"}',repeat('a',64));
 if op->>'action'<>'send' then raise exception 'No send claim'; end if;
 duplicate:=public.crm_claim_document_delivery('10000000-0000-0000-0000-000000000001','proposal','40000000-0000-0000-0000-000000000001','2026-11-03T00:00:00Z','{"to":["customer@example.test"],"subject":"New bytes ignored"}',repeat('a',64));
 if duplicate->>'action'<>'busy' then raise exception 'Concurrent claim was not serialized'; end if;
 perform public.crm_finish_document_delivery((op->>'id')::uuid,(op->>'claim')::uuid,'uncertain',null,'Synthetic timeout');
 duplicate:=public.crm_claim_document_delivery('10000000-0000-0000-0000-000000000001','proposal','40000000-0000-0000-0000-000000000001','2026-11-03T00:00:00Z','{"to":["customer@example.test"],"subject":"Different PDF"}',repeat('a',64));
 if duplicate->>'key'<>op->>'key' or duplicate->>'body'<>op->>'body' then raise exception 'Retry payload/key changed'; end if;
 perform public.crm_finish_document_delivery((duplicate->>'id')::uuid,(duplicate->>'claim')::uuid,'accepted','synthetic-provider-id',null);
end $$;
reset role;
do $$ begin
 if (select count(*) from public.crm_document_deliveries)<>1 then raise exception 'Duplicate durable deliveries'; end if;
 if (select status from public.crm_document_deliveries limit 1)<>'accepted' then raise exception 'Acceptance not persisted'; end if;
 if (select status from public.crm_proposals where id='40000000-0000-0000-0000-000000000001')<>'sent' then raise exception 'Eligible proposal not transitioned'; end if;
 if has_column_privilege('authenticated','public.crm_document_deliveries','status','UPDATE') then raise exception 'Column update grant survived'; end if;
 if has_function_privilege('anon','public.crm_claim_document_delivery(uuid,text,uuid,timestamptz,text,text)','EXECUTE') then raise exception 'Anonymous server grant'; end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'crm_%document_delivery' and (not p.prosecdef or p.proconfig is distinct from array['search_path=""'])) then raise exception 'Unsafe function config'; end if;
end $$;
set role authenticated;
do $$ begin
 begin update public.crm_document_deliveries set status='sent'; raise exception 'Client outcome update succeeded'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Table-driven authorization against the current Operations role model.
create temp table delivery_role_cases(actor uuid,type text,doc uuid,allowed boolean);
grant select on delivery_role_cases to service_role;
do $$ declare r text; t text; u uuid; doc uuid; begin
 foreach r in array array['owner','division_admin','office_manager','sales_rep','project_manager','field_inspector','production_manager','accounting','read_only'] loop
  u:=gen_random_uuid(); insert into auth.users(id) values(u); insert into public.crm_memberships(user_id,division_id,role) values(u,'TRD',r);
  foreach t in array array['proposal','inspection','warranty'] loop
   doc:=gen_random_uuid();
   if t='proposal' then insert into public.crm_proposals(id,division_id,customer_id,property_id,title,updated_at) values(doc,'TRD','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Role fixture','2026-11-03T00:00:00Z');
   elsif t='inspection' then insert into public.crm_inspections(id,division_id,customer_id,property_id,updated_at) values(doc,'TRD','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','2026-11-03T00:00:00Z');
   else insert into public.crm_warranties(id,division_id,customer_id,property_id,title,updated_at) values(doc,'TRD','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Role fixture','2026-11-03T00:00:00Z'); end if;
   insert into delivery_role_cases values(u,t,doc,r in ('owner','division_admin','office_manager') or (t='proposal' and r='sales_rep') or (t in ('inspection','warranty') and r in ('project_manager','production_manager')) or (t='inspection' and r='field_inspector'));
  end loop;
 end loop;
end $$;
set role service_role;
select set_config('request.jwt.claim.role','service_role',false);
do $$ declare r record; result jsonb; begin
 for r in select * from pg_temp.delivery_role_cases loop
  begin
   result:=public.crm_claim_document_delivery(r.actor,r.type,r.doc,'2026-11-03T00:00:00Z','{"to":["customer@example.test"],"subject":"Role test"}',repeat('a',64));
   if not r.allowed then raise exception 'Unauthorized role sent'; end if;
   perform public.crm_finish_document_delivery((result->>'id')::uuid,(result->>'claim')::uuid,'failed',null,'Synthetic rejection');
  exception when insufficient_privilege then if r.allowed then raise; end if; end;
 end loop;
end $$;
reset role;
-- An eligible version can become declined while the provider request is in flight.
insert into public.crm_proposals(id,division_id,customer_id,property_id,title,updated_at) values('40000000-0000-0000-0000-000000000003','TRD','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Concurrent edit fixture','2026-11-03T00:00:00Z');
set role service_role;
select public.crm_claim_document_delivery('10000000-0000-0000-0000-000000000001','proposal','40000000-0000-0000-0000-000000000003','2026-11-03T00:00:00Z','{"to":["customer@example.test"],"subject":"Version test"}',repeat('a',64)) as claim \gset
reset role;
update public.crm_proposals set status='declined' where id='40000000-0000-0000-0000-000000000003';
set role service_role;
select public.crm_finish_document_delivery((:'claim'::jsonb->>'id')::uuid,(:'claim'::jsonb->>'claim')::uuid,'accepted','synthetic-edited',null);
reset role;
do $$ begin if (select status from public.crm_proposals where id='40000000-0000-0000-0000-000000000003')<>'declined' then raise exception 'Concurrent proposal state overwritten'; end if; end $$;
-- Execution-owner, search_path and private payload boundary assertions.
do $$ declare f record; begin
 for f in select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='delivery_private' and p.prosecdef) or (n.nspname='public' and p.proname in ('crm_claim_document_delivery','crm_finish_document_delivery','crm_delivery_reconciliation')) loop
  if not f.prosecdef or f.proconfig is distinct from array['search_path=""'] or pg_has_role('authenticated',f.proowner,'MEMBER') then raise exception 'Unsafe execution owner/path'; end if;
 end loop;
 if has_schema_privilege('authenticated','delivery_private','USAGE') or has_table_privilege('authenticated','delivery_private.operations','SELECT,INSERT,UPDATE,DELETE') then raise exception 'Private payload access'; end if;
 if has_function_privilege('authenticated','public.crm_delivery_reconciliation(uuid,uuid,text,text,text)','EXECUTE') then raise exception 'Customer can invoke privileged reconciliation'; end if;
end $$;
