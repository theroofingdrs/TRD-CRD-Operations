-- Every database-backed proposal source is covered, without trusting an app caller.
set request.jwt.claim.role='service_role';
set request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
do $$ declare t text; c uuid; p uuid; f uuid; doc uuid; path text; v timestamptz; op jsonb; before_epoch bigint; original_intro text; begin
 select introduction into original_intro from public.crm_proposal_templates where division_id='TRD';
 foreach t in array array['proposal','customer','property','template','file','storage'] loop
  c:=gen_random_uuid();p:=gen_random_uuid();f:=gen_random_uuid();doc:=gen_random_uuid();path:='TRD/'||p||'/roofr-epoch.pdf';
  insert into public.crm_customers(id,customer_type,display_name,email) values(c,'individual','Epoch synthetic','epoch@example.test');
  insert into public.crm_customer_divisions(customer_id,division_id) values(c,'TRD');
  insert into public.crm_properties(id,customer_id,address_line1,city,state) values(p,c,'Epoch A','Test','TX');
  insert into storage.objects(bucket_id,name,owner_id) values('roof-doctors-private',path,'10000000-0000-0000-0000-000000000001');
  insert into public.crm_files(id,division_id,related_type,related_id,bucket_id,object_path,original_filename,metadata)
   values(f,'TRD','property',p,'roof-doctors-private',path,'epoch.pdf','{"document_type":"roofr_measurement_report"}');
  insert into public.crm_proposals(id,division_id,customer_id,property_id,title,template_data)
   values(doc,'TRD',c,p,'Epoch test',jsonb_build_object('roofr_report_id',f));
  select updated_at into v from public.crm_proposals where id=doc;
  set local role service_role;
  op:=security_test.bound_claim('10000000-0000-0000-0000-000000000001','proposal',doc,v,'{"to":["epoch@example.test"],"subject":"Epoch"}',repeat('a',64));
  perform public.crm_finish_document_delivery((op->>'id')::uuid,(op->>'claim')::uuid,'accepted','epoch-provider',null);
  reset role;
  if (select status from public.crm_proposals where id=doc)<>'sent' then raise exception 'Valid completion failed'; end if;
  select source_epoch into before_epoch from delivery_private.proposal_context_epochs where proposal_id=doc;
  -- Ignored source metadata must not invalidate an unchanged rendering context.
  update public.crm_proposals set updated_at=clock_timestamp() where id=doc;
  update public.crm_properties set latitude=30.0,longitude=-97.0 where id=p;
  update public.crm_customers set phone='synthetic' where id=c;
  if (select source_epoch from delivery_private.proposal_context_epochs where proposal_id=doc)<>before_epoch
    or (select status from public.crm_proposals where id=doc)<>'sent' then raise exception 'Non-context edit invalidated sent state'; end if;
  perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
  set local role authenticated;
  -- Registered file identity and Storage metadata are immutable to browser roles.
  -- Exercise trusted maintenance edits without reopening those grants.
  if t in ('file','storage') then reset role; end if;
  case t
   when 'proposal' then update public.crm_proposals set title='Changed epoch' where id=doc;
   when 'customer' then update public.crm_customers set display_name='Changed epoch' where id=c;
   when 'property' then update public.crm_properties set address_line1='Changed epoch' where id=p;
   when 'template' then update public.crm_proposal_templates set introduction='Changed epoch' where division_id='TRD';
   when 'file' then update public.crm_files set metadata=metadata||'{"epoch_note":"changed"}' where id=f;
   when 'storage' then update storage.objects set metadata=metadata||'{"version":"B"}' where name=path and bucket_id='roof-doctors-private';
  end case;
  reset role;
  if (select status from public.crm_proposals where id=doc)<>'draft'
    or (select source_epoch from delivery_private.proposal_context_epochs where proposal_id=doc)<=before_epoch
    or (select sent_epoch from delivery_private.proposal_context_epochs where proposal_id=doc) is not null then raise exception 'Source % bypassed atomic epoch invalidation',t; end if;
  if (select status from public.crm_document_deliveries where id=(op->>'id')::uuid)<>'accepted'
    or (select count(*) from delivery_private.operations where document_id=doc)<>1 then raise exception 'Historical receipt changed'; end if;
  if t='template' then update public.crm_proposal_templates set introduction=original_intro where division_id='TRD'; end if;
  -- Financial/business terminal states are preserved rather than blanket reset.
  update public.crm_proposals set status='accepted' where id=doc;
  update public.crm_properties set address_line1='Another source epoch' where id=p;
  if (select status from public.crm_proposals where id=doc)<>'accepted' then raise exception 'Business acceptance state overwritten'; end if;
 end loop;
 if has_table_privilege('authenticated','delivery_private.proposal_context_epochs','SELECT,INSERT,UPDATE,DELETE')
  or has_table_privilege('service_role','delivery_private.context_change_audit','SELECT,INSERT,UPDATE,DELETE')
  or has_function_privilege('authenticated','delivery_private.mark_current_proposal_sent(uuid)','EXECUTE') then raise exception 'Epoch authority exposed'; end if;
end $$;
-- A deleted source document must not erase truthful historical acceptance.
do $$ declare doc uuid:=gen_random_uuid(); v timestamptz; op jsonb; begin
 insert into public.crm_proposals(id,division_id,customer_id,property_id,title)
 values(doc,'TRD','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Deleted-source receipt');
 select updated_at into v from public.crm_proposals where id=doc;
 set local role service_role;
 op:=security_test.bound_claim('10000000-0000-0000-0000-000000000001','proposal',doc,v,'{"to":["customer@example.test"],"subject":"Deleted source"}',repeat('a',64));
 reset role;
 perform set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
 set local role authenticated;
 delete from public.crm_proposals where id=doc;
 reset role;
 set local role service_role;
 perform public.crm_finish_document_delivery((op->>'id')::uuid,(op->>'claim')::uuid,'accepted','deleted-source-provider',null);
 reset role;
 if (select status from public.crm_document_deliveries where id=(op->>'id')::uuid)<>'accepted'
  or exists(select 1 from delivery_private.proposal_context_epochs where proposal_id=doc) then raise exception 'Deleted source broke historical receipt'; end if;
end $$;
