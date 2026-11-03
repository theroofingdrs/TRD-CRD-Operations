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
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
insert into public.crm_projects(id,division_id,customer_id,property_id,project_name) values ('50000000-0000-0000-0000-000000000001','TRD','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Synthetic project');
insert into public.crm_project_transactions(id,division_id,project_id,transaction_type,amount) values ('60000000-0000-0000-0000-000000000001','TRD','50000000-0000-0000-0000-000000000001','payment',10);
set role authenticated;
select set_config('request.jwt.claim.role','authenticated',false);
insert into storage.objects(bucket_id,name,owner_id) values ('roof-doctors-private','TRD/50000000-0000-0000-0000-000000000001/receipt.pdf',auth.uid()::text);
do $$ declare f jsonb; v jsonb:='{"division_id":"TRD","related_type":"project","related_id":"50000000-0000-0000-0000-000000000001","bucket_id":"roof-doctors-private","object_path":"TRD/50000000-0000-0000-0000-000000000001/receipt.pdf","original_filename":"receipt.pdf","uploaded_by":"10000000-0000-0000-0000-000000000001","metadata":{"document_category":"payment_receipt","transaction_id":"60000000-0000-0000-0000-000000000001"}}'; begin
 f:=public.crm_register_private_file(v);
 if public.crm_register_private_file(v) is distinct from f then raise exception 'Registration retry changed identity'; end if;
 if not exists(select 1 from public.crm_files where id=(f->>'id')::uuid) then raise exception 'Atomic file not readable'; end if;
 if not exists(select 1 from public.crm_project_transactions where attachment_file_id=(f->>'id')::uuid) then raise exception 'Atomic link missing'; end if;
 begin update public.crm_files set object_path='CRD/forged.pdf' where id=(f->>'id')::uuid; raise exception 'Mutable identity'; exception when insufficient_privilege then null; end;
 begin delete from public.crm_files where id=(f->>'id')::uuid; raise exception 'Global owner deleted file metadata'; exception when insufficient_privilege then null; end;
 begin insert into public.crm_files(division_id,related_type,related_id,bucket_id,object_path,original_filename) values('TRD','property','30000000-0000-0000-0000-000000000001','roof-doctors-private','TRD/forged.pdf','forged'); raise exception 'Direct insert bypass'; exception when insufficient_privilege then null; end;
 begin perform public.crm_register_private_file(v||'{"related_type":"unsupported"}'::jsonb); raise exception 'Unsupported target'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
do $$ begin
 if exists(select 1 from public.crm_files) or exists(select 1 from storage.objects) then raise exception 'Customer gained base file access'; end if;
 begin insert into storage.objects(bucket_id,name,owner_id) values('roof-doctors-private','TRD/forged.pdf',auth.uid()::text); raise exception 'Unlinked upload'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
do $$ begin
 if exists(select 1 from public.crm_files) or exists(select 1 from storage.objects) then raise exception 'Cross-division owner gained files'; end if;
 update storage.objects set name='CRD/forged.pdf'; if found then raise exception 'Cross-division update affected rows'; end if;
end $$;
reset role;
do $$ begin
 if has_table_privilege('authenticated','public.crm_files','INSERT,UPDATE,DELETE') then raise exception 'File mutation grant survived'; end if;
 if exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('crm_private_files_read','crm_private_files_update','crm_private_files_delete')) then raise exception 'Legacy storage bypass survived'; end if;
 if has_function_privilege('anon','public.crm_register_private_file(jsonb)','EXECUTE') then raise exception 'Anonymous registration'; end if;
end $$;
-- Positive lifecycles for every formerly circular registration category.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
insert into public.crm_inspections(id,division_id,customer_id,property_id) values ('70000000-0000-0000-0000-000000000001','TRD','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001');
insert into public.crm_project_expenses(id,division_id,project_id,category,amount) values('80000000-0000-0000-0000-000000000001','TRD','50000000-0000-0000-0000-000000000001','materials',10);
insert into public.crm_company_expenses(id,division_id,category,amount) values('80000000-0000-0000-0000-000000000002','TRD','utilities',10);
insert into public.crm_project_supplements(id,division_id,project_id,supplement_number,requested_amount) values('80000000-0000-0000-0000-000000000003','TRD','50000000-0000-0000-0000-000000000001',1,10);
insert into public.crm_import_batches(id,division_id,source_system,batch_name) values('80000000-0000-0000-0000-000000000004','TRD','Invoice2go','Synthetic batch');
set role authenticated;
do $$ declare sample record; f jsonb; result jsonb; begin
 for sample in select * from (values
 ('property','30000000-0000-0000-0000-000000000001','TRD/property.pdf','{}'),
 ('property','30000000-0000-0000-0000-000000000001','TRD/30000000-0000-0000-0000-000000000001/roofr-test.pdf','{"document_type":"roofr_measurement_report"}'),
 ('inspection','70000000-0000-0000-0000-000000000001','TRD/inspections/70000000-0000-0000-0000-000000000001/photo.jpg','{"photo_label":"Synthetic"}'),
 ('project','50000000-0000-0000-0000-000000000001','TRD/50000000-0000-0000-0000-000000000001/expense.pdf','{"document_category":"expense_receipt","expense_id":"80000000-0000-0000-0000-000000000001"}'),
 ('company_expense','80000000-0000-0000-0000-000000000002','TRD/company-expenses/test.pdf','{"document_category":"company_expense_receipt"}'),
 ('supplement','80000000-0000-0000-0000-000000000003','TRD/50000000-0000-0000-0000-000000000001/supplement.pdf','{"document_category":"supplement_attachment"}'),
 ('customer','20000000-0000-0000-0000-000000000001','TRD/20000000-0000-0000-0000-000000000001/invoice2go/80000000-0000-0000-0000-000000000004/invoice.pdf','{"source_system":"Invoice2go","import_batch_id":"80000000-0000-0000-0000-000000000004","historical_document_type":"invoice"}')
 ) as cases(target,id,path,metadata) loop
   insert into storage.objects(bucket_id,name,owner_id) values('roof-doctors-private',sample.path,auth.uid()::text);
   f:=jsonb_build_object('division_id','TRD','related_type',sample.target,'related_id',sample.id,'bucket_id','roof-doctors-private','object_path',sample.path,'uploaded_by',auth.uid(),'original_filename','synthetic','metadata',sample.metadata::jsonb);
   result:=public.crm_register_private_file(f);
   if not exists(select 1 from public.crm_files where id=(result->>'id')::uuid) or not exists(select 1 from storage.objects where name=sample.path) then raise exception 'Registration/read failed: %',sample.target; end if;
 end loop;
 -- Required-link failure rolls the file insertion back.
 insert into storage.objects(bucket_id,name,owner_id) values('roof-doctors-private','TRD/50000000-0000-0000-0000-000000000001/bad.pdf',auth.uid()::text);
 begin
   perform public.crm_register_private_file('{"division_id":"TRD","related_type":"project","related_id":"50000000-0000-0000-0000-000000000001","bucket_id":"roof-doctors-private","object_path":"TRD/50000000-0000-0000-0000-000000000001/bad.pdf","original_filename":"bad.pdf","uploaded_by":"10000000-0000-0000-0000-000000000001","metadata":{"document_category":"payment_receipt","transaction_id":"00000000-0000-0000-0000-000000000099"}}');
   raise exception 'Bad link accepted';
 exception when raise_exception then if sqlerrm='Bad link accepted' then raise; end if; end;
 if exists(select 1 from public.crm_files where object_path like '%/bad.pdf') then raise exception 'Partial file graph committed'; end if;
end $$;
reset role;
-- Every actual role reads only its division; no active role gets identity edits.
do $$ declare r text; uid uuid; begin
 foreach r in array array['owner','division_admin','office_manager','sales_rep','project_manager','field_inspector','production_manager','accounting','read_only'] loop
  uid:=gen_random_uuid(); insert into auth.users(id) values(uid); insert into public.crm_memberships(user_id,division_id,role) values(uid,'TRD',r);
 end loop;
end $$;
set role authenticated;
do $$ declare r record; begin
 for r in select user_id,role from public.crm_memberships where division_id='TRD' loop
   perform set_config('request.jwt.claim.sub',r.user_id::text,true);
   if (select count(*) from public.crm_files)<>8 then raise exception 'Role % lost legitimate division file reads',r.role; end if;
   if has_column_privilege('authenticated','public.crm_files','object_path','UPDATE') then raise exception 'Role can mutate immutable path'; end if;
 end loop;
end $$;
reset role;
-- Exact-division owner property deletion preserves the metadata tombstone.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
set role authenticated;
delete from storage.objects where name='TRD/property.pdf';
reset role;
do $$ begin if not exists(select 1 from storage.objects where name='TRD/property.pdf') then raise exception 'Cross-division property delete'; end if; end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
set role authenticated;
delete from storage.objects where name='TRD/property.pdf';
do $$ begin
 if exists(select 1 from public.crm_files where object_path='TRD/property.pdf') then raise exception 'Deleted object remains advertised'; end if;
 begin insert into storage.objects(bucket_id,name,owner_id) values('roof-doctors-private','TRD/property.pdf',auth.uid()::text); raise exception 'Deleted identity rebound'; exception when insufficient_privilege then null; end;
 delete from storage.objects where name='TRD/50000000-0000-0000-0000-000000000001/receipt.pdf';
 if found then raise exception 'Linked financial evidence deleted'; end if;
end $$;
reset role;
do $$ begin
 if not exists(select 1 from public.crm_files where object_path='TRD/property.pdf') then raise exception 'Immutable deletion history lost'; end if;
 if not exists(select 1 from file_private.registration_audit where action='DELETE_OBJECT') then raise exception 'Deletion audit missing'; end if;
end $$;
-- Registration permission matrix: actual authenticated roles, valid targets,
-- and unlinked per-role receipts so a false authorization grant is detectable.
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
create temp table registration_role_cases as select user_id,role,gen_random_uuid() as receipt from public.crm_memberships where division_id='TRD';
grant select on registration_role_cases to authenticated;
insert into public.crm_project_transactions(id,division_id,project_id,transaction_type,amount)
select receipt,'TRD','50000000-0000-0000-0000-000000000001','payment',1 from registration_role_cases;
set role authenticated;
do $$ declare r record; kind text; allowed boolean; path text; f jsonb; begin
 for r in select * from pg_temp.registration_role_cases loop
  perform set_config('request.jwt.claim.sub',r.user_id::text,true);
  foreach kind in array array['property','project'] loop
   allowed:=case when kind='property' then r.role in ('owner','division_admin','office_manager','sales_rep','project_manager','field_inspector','production_manager') else r.role in ('owner','division_admin','office_manager','project_manager','accounting') end;
   path:=case when kind='property' then 'TRD/role-' else 'TRD/50000000-0000-0000-0000-000000000001/role-' end||r.user_id||'.pdf';
   f:=jsonb_build_object('division_id','TRD','related_type',kind,'related_id',case when kind='property' then '30000000-0000-0000-0000-000000000001' else '50000000-0000-0000-0000-000000000001' end,'bucket_id','roof-doctors-private','object_path',path,'uploaded_by',r.user_id,'original_filename','role.pdf','metadata',case when kind='project' then jsonb_build_object('document_category','payment_receipt','transaction_id',r.receipt) else '{}'::jsonb end);
   begin
    insert into storage.objects(bucket_id,name,owner_id) values('roof-doctors-private',path,auth.uid()::text);
    perform public.crm_register_private_file(f);
    if not allowed then raise exception 'Role % gained unauthorized % registration',r.role,kind; end if;
   exception when insufficient_privilege then if allowed then raise; end if; end;
  end loop;
 end loop;
end $$;
reset role;
do $$ declare f record; begin
 for f in select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='file_private' or (n.nspname='public' and p.proname='crm_register_private_file') loop
  if not f.prosecdef or f.proconfig is distinct from array['search_path=""'] or pg_has_role('authenticated',f.proowner,'MEMBER') then raise exception 'Unsafe file function owner/path'; end if;
 end loop;
 if has_function_privilege('authenticated','file_private.target_allowed(text,text,uuid,boolean)','EXECUTE') or has_function_privilege('authenticated','file_private.guard_reference()','EXECUTE') then raise exception 'Internal helper exposed'; end if;
 if has_table_privilege('authenticated','file_private.registration_audit','SELECT,INSERT,UPDATE,DELETE') then raise exception 'File audit writable/readable'; end if;
end $$;
