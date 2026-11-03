-- Follow 20261102030000. Compatible callers must ship with this cutover.
begin;
do $$ begin
  if not exists(select 1 from storage.buckets where id='roof-doctors-private' and public=false) then raise exception 'Private bucket prerequisite missing or public'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='storage' and table_name='objects' and column_name='owner_id') then raise exception 'Reviewed Storage owner_id prerequisite missing'; end if;
end $$;
create schema file_private;
revoke all on schema file_private from public,anon,authenticated,service_role;
create table file_private.registration_audit(id bigint generated always as identity primary key,actor uuid, file_id uuid not null, action text not null default 'REGISTER', created_at timestamptz not null default now());
alter table file_private.registration_audit enable row level security;
revoke all on all tables in schema file_private from public,anon,authenticated,service_role;

-- Resolve only supported targets. Callers still require their resource role.
create function file_private.target_allowed(d text,t text,i uuid,w boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare c uuid; resource text;
begin
  if auth.uid() is null or not exists(select 1 from public.crm_divisions where id=d and active) then return false; end if;
  case t
  when 'customer' then c:=i; resource:='files';
  when 'property' then select customer_id into c from public.crm_properties where id=i; resource:='files';
  when 'inspection' then
    select p.customer_id into c from public.crm_inspections x join public.crm_properties p on p.id=x.property_id
      where x.id=i and x.division_id=d and (x.customer_id is null or x.customer_id=p.customer_id)
      and (x.lead_id is null or exists(select 1 from public.crm_leads l where l.id=x.lead_id and l.division_id=d and (l.customer_id is null or l.customer_id=p.customer_id) and (l.property_id is null or l.property_id=p.id)
        and (l.contact_id is null or exists(select 1 from public.crm_contacts c where c.id=l.contact_id and c.customer_id=p.customer_id))))
      and (x.appointment_id is null or exists(select 1 from public.crm_appointments a where a.id=x.appointment_id and a.division_id=d and (a.customer_id is null or a.customer_id=p.customer_id) and (a.property_id is null or a.property_id=p.id) and (a.lead_id is null or ((x.lead_id is null or a.lead_id=x.lead_id) and exists(select 1 from public.crm_leads al where al.id=a.lead_id and al.division_id=d and (al.customer_id is null or al.customer_id=p.customer_id) and (al.property_id is null or al.property_id=p.id) and (al.contact_id is null or exists(select 1 from public.crm_contacts ac where ac.id=al.contact_id and ac.customer_id=p.customer_id))))))); resource:='inspections';
  when 'project' then
    select p.customer_id into c from public.crm_projects x join public.crm_properties p on p.id=x.property_id and p.customer_id=x.customer_id where x.id=i and x.division_id=d
      and (x.lead_id is null or exists(select 1 from public.crm_leads l where l.id=x.lead_id and l.division_id=d and (l.customer_id is null or l.customer_id=p.customer_id) and (l.property_id is null or l.property_id=p.id)
        and (l.contact_id is null or exists(select 1 from public.crm_contacts c where c.id=l.contact_id and c.customer_id=p.customer_id))))
      and (x.claim_id is null or exists(select 1 from public.crm_claims cl where cl.id=x.claim_id and cl.division_id=d and cl.customer_id=p.customer_id and cl.property_id=p.id and (cl.project_id is null or cl.project_id=x.id))); resource:='projects';
  when 'supplement' then
    select p.customer_id into c from public.crm_project_supplements s join public.crm_projects x on x.id=s.project_id and x.division_id=s.division_id
      join public.crm_properties p on p.id=x.property_id and p.customer_id=x.customer_id where s.id=i and s.division_id=d and file_private.target_allowed(d,'project',x.id,w); resource:='projects';
  when 'company_expense' then
    return exists(select 1 from public.crm_company_expenses x where x.id=i and x.division_id=d) and app_private.has_division_financial_access(d,w);
  else return false;
  end case;
  return c is not null and exists(select 1 from public.crm_customer_divisions cd where cd.customer_id=c and cd.division_id=d)
    and app_private.has_division_resource_access(d,resource,w);
end $$;

create function file_private.path_matches(d text,t text,i uuid,path text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare parts text[]:=string_to_array(path,'/'); project uuid;
begin
  if path is null or string_to_array(path,'/') && array['.','..'] or position(chr(92) in path)>0 or parts[1]<>d or parts[array_length(parts,1)]='' then return false; end if;
  case t
  when 'property' then return array_length(parts,1)=2 or (array_length(parts,1)=3 and parts[2]=i::text and parts[3] like 'roofr-%');
  when 'customer' then return array_length(parts,1)=5 and parts[2]=i::text and parts[3]='invoice2go';
  when 'inspection' then return array_length(parts,1)=4 and parts[2]='inspections' and parts[3]=i::text;
  when 'project' then return array_length(parts,1)=3 and parts[2]=i::text;
  when 'supplement' then select project_id into project from public.crm_project_supplements where id=i and division_id=d; return array_length(parts,1)=3 and parts[2]=project::text;
  when 'company_expense' then return array_length(parts,1)=3 and parts[2]='company-expenses';
  else return false;
  end case;
end $$;

create function file_private.can_read(f public.crm_files) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from storage.objects o where o.bucket_id=f.bucket_id and o.name=f.object_path) or f.bucket_id<>'roof-doctors-private' or not file_private.target_allowed(f.division_id,f.related_type,f.related_id,false)
    or not file_private.path_matches(f.division_id,f.related_type,f.related_id,f.object_path) then return false; end if;
  case f.related_type
  when 'project' then
    return app_private.has_division_financial_access(f.division_id,false) and (
      exists(select 1 from public.crm_project_expenses e where e.receipt_file_id=f.id and e.project_id=f.related_id and e.division_id=f.division_id)
      or exists(select 1 from public.crm_project_transactions x where x.attachment_file_id=f.id and x.project_id=f.related_id and x.division_id=f.division_id));
  when 'company_expense' then return exists(select 1 from public.crm_company_expenses e where e.id=f.related_id and e.receipt_file_id=f.id and e.division_id=f.division_id);
  when 'inspection' then return exists(select 1 from public.crm_inspection_photos p where p.file_id=f.id and p.inspection_id=f.related_id and p.division_id=f.division_id);
  when 'customer' then return exists(select 1 from public.crm_historical_documents h where h.storage_file_id=f.id and h.customer_id=f.related_id and h.division_id=f.division_id);
  else return true;
  end case;
end $$;

-- Remove ALL historical permissive file/object policies for this bucket's
-- reviewed application policy set, rather than retaining an OR bypass.
do $$ declare p record; begin
  if exists(select 1 from pg_policies where schemaname='public' and tablename='crm_files' and policyname not in (
    'crm_files_update','crm_files_delete','crm_files_property_insert','crm_files_property_read','crm_files_inspection_insert','crm_files_inspection_read',
    'crm_files_expense_receipt_insert','crm_files_expense_receipt_read','crm_files_supplement_attachment_insert','crm_files_supplement_attachment_read',
    'crm_files_project_transaction_insert','crm_files_project_transaction_read','crm_files_company_expense_insert','crm_files_company_expense_read')) then raise exception 'Unexpected crm_files policy; reconcile before cutover'; end if;
  for p in select policyname from pg_policies where schemaname='public' and tablename='crm_files' loop execute format('drop policy %I on public.crm_files',p.policyname); end loop;
  if exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname not in (
    'crm_private_files_delete','crm_private_property_files_insert','crm_private_property_files_read','crm_private_property_files_update',
    'crm_inspection_photos_storage_insert','crm_inspection_photos_storage_read','crm_project_supplement_storage_insert','crm_project_supplement_storage_read',
    'project_expense_receipts_storage_insert','project_expense_receipts_storage_read','crm_project_transaction_storage_read',
    'company_expense_receipts_storage_insert','company_expense_receipts_storage_read',
    'crm_blog_media_owner_insert','crm_blog_media_owner_update','crm_blog_media_owner_delete')) then raise exception 'Unexpected Storage policy; reconcile before cutover'; end if;
  for p in select policyname from pg_policies where schemaname='storage' and tablename='objects'
    and (policyname like 'crm_private_%' or policyname like 'crm_inspection_photos_storage_%' or policyname like 'crm_project_%storage_%' or policyname like 'project_expense_receipts_storage_%' or policyname like 'company_expense_receipts_storage_%') loop
    execute format('drop policy %I on storage.objects',p.policyname);
  end loop;
end $$;
revoke insert,update,delete on public.crm_files from public,anon,authenticated;
do $$ declare a record; begin
  for a in select attname from pg_attribute where attrelid='public.crm_files'::regclass and attnum>0 and not attisdropped loop
    if has_column_privilege('authenticated','public.crm_files',a.attname,'INSERT,UPDATE') or has_column_privilege('anon','public.crm_files',a.attname,'INSERT,UPDATE') then raise exception 'Unexpected file column grant'; end if;
  end loop;
end $$;
create policy crm_files_registered_read on public.crm_files for select to authenticated using(file_private.can_read(crm_files));

create function public.crm_register_private_file(p_file jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d text:=p_file->>'division_id'; t text:=p_file->>'related_type'; target uuid:=(p_file->>'related_id')::uuid;
  path text:=p_file->>'object_path'; meta jsonb:=coalesce(p_file->'metadata','{}'); fid uuid; linked uuid; existing public.crm_files%rowtype; category text:=meta->>'document_category';
begin
  if not (file_private.target_allowed(d,t,target,true) or (t='project' and file_private.target_allowed(d,t,target,false) and app_private.has_division_financial_access(d,true))) or p_file->>'bucket_id'<>'roof-doctors-private'
    or not file_private.path_matches(d,t,target,path) or p_file->>'uploaded_by' is distinct from auth.uid()::text
    or jsonb_typeof(meta)<>'object' then raise exception 'File authorization or identity mismatch' using errcode='42501'; end if;
  -- The actual Storage object must have been uploaded by this verified actor.
  perform 1 from storage.objects where bucket_id='roof-doctors-private' and name=path and owner_id=auth.uid()::text for update;
  if not found then raise exception 'Owned upload required' using errcode='42501'; end if;
  select * into existing from public.crm_files where bucket_id='roof-doctors-private' and object_path=path;
  if found then
    if existing.uploaded_by is distinct from auth.uid() or existing.related_type<>t or existing.related_id<>target or existing.division_id<>d or existing.metadata<>meta then raise exception 'Registered file identity is immutable' using errcode='42501'; end if;
    return jsonb_build_object('id',existing.id);
  end if;
  if t='project' and not app_private.has_division_financial_access(d,true) then raise exception 'Financial write required' using errcode='42501'; end if;
  insert into public.crm_files(division_id,related_type,related_id,bucket_id,object_path,original_filename,content_type,file_size_bytes,uploaded_by,metadata)
    values(d,t,target,'roof-doctors-private',path,p_file->>'original_filename',p_file->>'content_type',(p_file->>'file_size_bytes')::bigint,auth.uid(),meta) returning id into fid;
  if t='project' and category='expense_receipt' then
    update public.crm_project_expenses set receipt_file_id=fid where id=(meta->>'expense_id')::uuid and project_id=target and division_id=d and receipt_file_id is null returning id into linked;
  elsif t='project' and category in ('invoice_document','payment_receipt') then
    update public.crm_project_transactions set attachment_file_id=fid where id=(meta->>'transaction_id')::uuid and project_id=target and division_id=d and attachment_file_id is null
      and transaction_type=case when category='invoice_document' then 'invoice' else 'payment' end returning id into linked;
  elsif t='company_expense' and category='company_expense_receipt' then
    update public.crm_company_expenses set receipt_file_id=fid where id=target and division_id=d and receipt_file_id is null returning id into linked;
  elsif t='inspection' then
    if meta->>'inspection_item_id' is not null and not exists(select 1 from public.crm_inspection_items where id=(meta->>'inspection_item_id')::uuid and inspection_id=target) then raise exception 'Inspection item mismatch'; end if;
    insert into public.crm_inspection_photos(division_id,inspection_id,inspection_item_id,file_id,photo_label,caption,roof_section,created_by)
      values(d,target,(meta->>'inspection_item_id')::uuid,fid,coalesce(meta->>'photo_label','Inspection photo'),meta->>'caption',meta->>'roof_section',auth.uid()) returning id into linked;
  elsif t='customer' then
    if (string_to_array(path,'/'))[4] is distinct from meta->>'import_batch_id' or not exists(select 1 from public.crm_import_batches where id=(meta->>'import_batch_id')::uuid and division_id=d) then raise exception 'Import batch mismatch'; end if;
    insert into public.crm_historical_documents(division_id,customer_id,document_type,original_filename,storage_file_id,source_system,import_batch_id,metadata,created_by)
      values(d,target,meta->>'historical_document_type',p_file->>'original_filename',fid,'Invoice2go',(meta->>'import_batch_id')::uuid,'{"imported_as_attachment":true}',auth.uid()) returning id into linked;
  elsif t='supplement' and category='supplement_attachment' then linked:=target;
  elsif t='property' then linked:=target;
  end if;
  if linked is null then raise exception 'Unsupported or already linked attachment'; end if;
  insert into file_private.registration_audit(actor,file_id) values(auth.uid(),fid);
  return jsonb_build_object('id',fid);
end $$;

-- No mutable identity/path operation. Only owner-scoped, unreferenced property
-- deletion below is allowed; linked evidence has no client detach/delete path.
create policy crm_registered_objects_read on storage.objects for select to authenticated using(
  bucket_id='roof-doctors-private' and exists(select 1 from public.crm_files f where f.bucket_id=storage.objects.bucket_id and f.object_path=storage.objects.name and file_private.can_read(f)));
-- Upload policies constrain supported path grammars and actual target authority.
create function file_private.can_upload(path text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare p text[]:=string_to_array(path,'/'); i uuid;
begin
  if exists(select 1 from public.crm_files where bucket_id='roof-doctors-private' and object_path=path) then return false; end if;
  if auth.uid() is null or array_position(p,'') is not null or string_to_array(path,'/') && array['.','..'] or position(chr(92) in path)>0 then return false; end if;
  if array_length(p,1)=2 then return app_private.has_division_resource_access(p[1],'files',true); end if;
  if p[2]='company-expenses' and array_length(p,1)=3 then return app_private.has_division_financial_access(p[1],true); end if;
  if p[2]='inspections' and array_length(p,1)=4 then return file_private.target_allowed(p[1],'inspection',p[3]::uuid,true); end if;
  i:=p[2]::uuid;
  if array_length(p,1)=3 and p[3] like 'roofr-%' then return file_private.target_allowed(p[1],'property',i,true); end if;
  if array_length(p,1)=3 then return file_private.target_allowed(p[1],'project',i,true) or (file_private.target_allowed(p[1],'project',i,false) and app_private.has_division_financial_access(p[1],true)); end if;
  if array_length(p,1)=5 and p[3]='invoice2go' then return file_private.target_allowed(p[1],'customer',i,true); end if;
  return false;
exception when invalid_text_representation then return false;
end $$;
create policy crm_registered_objects_upload on storage.objects for insert to authenticated with check(bucket_id='roof-doctors-private' and owner_id=auth.uid()::text and file_private.can_upload(name));
create policy crm_owned_upload_read on storage.objects for select to authenticated using(
  bucket_id='roof-doctors-private' and owner_id=auth.uid()::text and file_private.can_upload(name)
  and not exists(select 1 from public.crm_files f where f.bucket_id=storage.objects.bucket_id and f.object_path=storage.objects.name));
create policy crm_unregistered_upload_cleanup on storage.objects for delete to authenticated using(
  bucket_id='roof-doctors-private' and owner_id=auth.uid()::text and file_private.can_upload(name)
  and not exists(select 1 from public.crm_files f where f.bucket_id=storage.objects.bucket_id and f.object_path=storage.objects.name));
-- An exact division owner may delete an unreferenced property upload. Linked
-- financial/photo/history evidence cannot be detached by this file operation.
create function file_private.can_delete_property(path text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare f public.crm_files%rowtype;
begin
  select * into f from public.crm_files where bucket_id='roof-doctors-private' and object_path=path;
  if not found or f.related_type<>'property' or not file_private.target_allowed(f.division_id,f.related_type,f.related_id,true)
    or not exists(select 1 from public.crm_memberships where user_id=auth.uid() and division_id=f.division_id and role='owner' and active) then return false; end if;
  -- Lock before checking references. Reference writers take KEY SHARE on this
  -- same object, so post-wait checks see their committed references.
  perform 1 from storage.objects where bucket_id=f.bucket_id and name=f.object_path for update;
  if not found then return false; end if;
  return not exists(select 1 from public.crm_project_expenses where receipt_file_id=f.id)
    and not exists(select 1 from public.crm_project_transactions where attachment_file_id=f.id)
    and not exists(select 1 from public.crm_company_expenses where receipt_file_id=f.id)
    and not exists(select 1 from public.crm_inspection_photos where file_id=f.id)
    and not exists(select 1 from public.crm_historical_documents where storage_file_id=f.id)
    and not exists(select 1 from public.crm_warranties where document_file_id=f.id)
    and not exists(select 1 from public.crm_proposals where template_data->>'roofr_report_id'=f.id::text)
    and not exists(select 1 from public.crm_inspections where measurements->>'roofr_report_id'=f.id::text);
end $$;
create policy crm_unreferenced_property_delete on storage.objects for delete to authenticated using(bucket_id='roof-doctors-private' and file_private.can_delete_property(name));
create function file_private.audit_delete() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into file_private.registration_audit(actor,file_id,action) select auth.uid(),id,'DELETE_OBJECT' from public.crm_files where bucket_id=old.bucket_id and object_path=old.name;
  return old;
end $$;
create trigger crm_audit_private_object_delete after delete on storage.objects for each row execute function file_private.audit_delete();
-- Prevent new references racing an authorized physical deletion. This grants
-- no resource permission; the parent table's existing RLS still applies.
create function file_private.guard_reference() returns trigger language plpgsql security definer set search_path='' as $$
declare j jsonb:=to_jsonb(new); oldj jsonb; value text; previous text; f public.crm_files%rowtype;
begin
  if tg_op='UPDATE' then oldj:=to_jsonb(old); end if;
  case tg_table_name
  when 'crm_proposals' then value:=j->'template_data'->>'roofr_report_id'; previous:=oldj->'template_data'->>'roofr_report_id';
  when 'crm_inspections' then value:=j->'measurements'->>'roofr_report_id'; previous:=oldj->'measurements'->>'roofr_report_id';
  else value:=j->>tg_argv[0]; previous:=oldj->>tg_argv[0];
  end case;
  if nullif(value,'') is null or (tg_op='UPDATE' and value is not distinct from previous) then return new; end if;
  select * into f from public.crm_files where id=value::uuid;
  if not found then raise exception 'Referenced file does not exist' using errcode='23503'; end if;
  if f.division_id is distinct from j->>'division_id' or not file_private.target_allowed(f.division_id,f.related_type,f.related_id,false) then raise exception 'Referenced file division/authority mismatch' using errcode='42501'; end if;
  if tg_table_name in ('crm_proposals','crm_inspections') then
    if f.related_type<>'property' or f.related_id::text is distinct from j->>'property_id' or f.metadata->>'document_type' is distinct from 'roofr_measurement_report' then raise exception 'Roofr file relationship mismatch' using errcode='42501'; end if;
  elsif tg_table_name='crm_inspection_photos' then
    if f.related_type<>'inspection' or f.related_id::text is distinct from j->>'inspection_id' then raise exception 'Photo file relationship mismatch' using errcode='42501'; end if;
  elsif tg_table_name in ('crm_project_expenses','crm_project_transactions') then
    if f.related_type<>'project' or f.related_id::text is distinct from j->>'project_id' then raise exception 'Financial file relationship mismatch' using errcode='42501'; end if;
  elsif tg_table_name='crm_company_expenses' then
    if f.related_type<>'company_expense' or f.related_id::text is distinct from j->>'id' then raise exception 'Expense file relationship mismatch' using errcode='42501'; end if;
  elsif tg_table_name='crm_historical_documents' then
    if f.related_type<>'customer' or f.related_id::text is distinct from j->>'customer_id' then raise exception 'Customer file relationship mismatch' using errcode='42501'; end if;
  elsif tg_table_name='crm_warranties' then
    if f.related_type<>'property' or f.related_id::text is distinct from j->>'property_id' then raise exception 'Warranty file relationship mismatch' using errcode='42501'; end if;
  end if;
  perform 1 from storage.objects where bucket_id=f.bucket_id and name=f.object_path for key share;
  if not found then raise exception 'Referenced object is deleted or unavailable' using errcode='23503'; end if;
  return new;
end $$;
create trigger crm_file_reference before insert or update of template_data on public.crm_proposals for each row execute function file_private.guard_reference();
create trigger crm_file_reference before insert or update of measurements on public.crm_inspections for each row execute function file_private.guard_reference();
create trigger crm_file_reference before insert or update of document_file_id on public.crm_warranties for each row execute function file_private.guard_reference('document_file_id');
create trigger crm_file_reference before insert or update of file_id on public.crm_inspection_photos for each row execute function file_private.guard_reference('file_id');
create trigger crm_file_reference before insert or update of storage_file_id on public.crm_historical_documents for each row execute function file_private.guard_reference('storage_file_id');
create trigger crm_file_reference before insert or update of receipt_file_id on public.crm_project_expenses for each row execute function file_private.guard_reference('receipt_file_id');
create trigger crm_file_reference before insert or update of attachment_file_id on public.crm_project_transactions for each row execute function file_private.guard_reference('attachment_file_id');
create trigger crm_file_reference before insert or update of receipt_file_id on public.crm_company_expenses for each row execute function file_private.guard_reference('receipt_file_id');
revoke all on all functions in schema file_private from public,anon,authenticated,service_role;
grant usage on schema file_private to authenticated;
grant execute on function file_private.can_read(public.crm_files),file_private.can_upload(text),file_private.can_delete_property(text) to authenticated;
revoke all on function public.crm_register_private_file(jsonb) from public,anon,service_role;
grant execute on function public.crm_register_private_file(jsonb) to authenticated;
commit;
