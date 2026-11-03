-- Corrective follow-up: preserve the original migration and all historical outcomes.
begin;
alter table delivery_private.operations add column context_fingerprint text
  check(context_fingerprint is null or context_fingerprint ~ '^[0-9a-f]{64}$');
-- Existing requests cannot be retroactively attested from current mutable records.
-- Leave their binding NULL and fail closed; retain payload/audit for manual recovery.
do $$ declare constraint_name text; begin
  select conname into strict constraint_name from pg_constraint
    where conrelid='delivery_private.operations'::regclass and contype='u'
      and pg_get_constraintdef(oid)='UNIQUE (document_type, document_id, document_version, recipient)';
  execute format('alter table delivery_private.operations drop constraint %I',constraint_name);
end $$;
create unique index operations_bound_context on delivery_private.operations(document_type,document_id,context_fingerprint)
  where context_fingerprint is not null;

create function delivery_private.context_fingerprint(t text,i uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare j jsonb; customer jsonb; property jsonb; extras jsonb:='{}'; report uuid;
begin
  case t
    when 'proposal' then select to_jsonb(x) into j from public.crm_proposals x where id=i;
    when 'inspection' then select to_jsonb(x) into j from public.crm_inspections x where id=i;
    when 'warranty' then select to_jsonb(x) into j from public.crm_warranties x where id=i;
    else raise exception 'Unsupported document';
  end case;
  if j is null then raise exception 'Missing document'; end if;
  select jsonb_build_object('id',id,'display_name',display_name,'email',trim(email)) into customer
    from public.crm_customers where id=(j->>'customer_id')::uuid;
  select jsonb_build_object('id',id,'customer_id',customer_id,'address_line1',address_line1,'city',city,'state',state,'postal_code',postal_code) into property
    from public.crm_properties where id=(j->>'property_id')::uuid;
  if t='proposal' then
    select jsonb_build_object('template',to_jsonb(x)-'updated_at'-'created_at') into extras
      from public.crm_proposal_templates x where division_id=j->>'division_id';
    report:=nullif(j->'template_data'->>'roofr_report_id','')::uuid;
  elsif t='inspection' then
    extras:=jsonb_build_object(
      'items',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]') from public.crm_inspection_items x where inspection_id=i),
      'photos',(select coalesce(jsonb_agg(jsonb_build_object('photo',to_jsonb(x),'file',to_jsonb(f),'object',to_jsonb(s)-'last_accessed_at') order by x.created_at,x.id),'[]')
        from public.crm_inspection_photos x left join public.crm_files f on f.id=x.file_id
        left join storage.objects s on s.bucket_id=f.bucket_id and s.name=f.object_path where x.inspection_id=i));
    report:=nullif(j->'measurements'->>'roofr_report_id','')::uuid;
  end if;
  if report is not null then
    extras:=coalesce(extras,'{}')||jsonb_build_object('report',(select jsonb_build_object('file',to_jsonb(f),'object',to_jsonb(s)-'last_accessed_at')
      from public.crm_files f left join storage.objects s on s.bucket_id=f.bucket_id and s.name=f.object_path where f.id=report));
  end if;
  -- Status and its updated_at trigger are lifecycle state, not rendered content.
  -- Content, relationship IDs, recipient identity/email, templates and attachments bind the operation.
  return encode(sha256(convert_to(jsonb_build_object('renderer','crm-pdf-v2','type',t,
    'document',j-'status'-'updated_at','customer',customer,'property',property,'extras',coalesce(extras,'{}'))::text,'UTF8')),'hex');
end $$;

create function public.crm_document_delivery_context(p_actor uuid,p_type text,p_document uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare d record;
begin
  if p_type='proposal' then
    select id,division_id,customer_id,property_id,updated_at,status into d from public.crm_proposals where id=p_document;
  elsif p_type='inspection' then
    select id,division_id,customer_id,property_id,updated_at,status into d from public.crm_inspections where id=p_document;
  elsif p_type='warranty' then
    select id,division_id,customer_id,property_id,updated_at,status into d from public.crm_warranties where id=p_document;
  else raise exception 'Unsupported document' using errcode='22023'; end if;
  if d.id is null or not exists(select 1 from public.crm_memberships m join public.crm_divisions div on div.id=m.division_id
    where m.user_id=p_actor and m.division_id=d.division_id and m.active and div.active
    and (m.role in ('owner','division_admin','office_manager')
      or (p_type='proposal' and m.role='sales_rep')
      or (p_type in ('inspection','warranty') and m.role in ('project_manager','production_manager'))
      or (p_type='inspection' and m.role='field_inspector'))) then
    raise exception 'Document write authority required' using errcode='42501'; end if;
  if not delivery_private.graph_matches(p_type,p_document,d.division_id,d.customer_id,d.property_id)
    or not exists(select 1 from public.crm_customer_divisions cd join public.crm_properties p on p.customer_id=cd.customer_id
      where cd.customer_id=d.customer_id and cd.division_id=d.division_id and p.id=d.property_id) then
    raise exception 'Invalid customer/property relationship' using errcode='42501'; end if;
  return delivery_private.context_fingerprint(p_type,p_document);
end $$;
revoke all on function public.crm_document_delivery_context(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.crm_document_delivery_context(uuid,text,uuid) to service_role;
revoke all on function delivery_private.context_fingerprint(text,uuid) from public,anon,authenticated,service_role;

create or replace function public.crm_claim_document_delivery(p_actor uuid,p_type text,p_document uuid,p_version timestamptz,p_body text,p_context text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d record; c record; v_id uuid; o delivery_private.operations%rowtype; outcome public.crm_document_deliveries%rowtype; claim uuid; fingerprint text;
begin
  if p_type='proposal' then
    select id,division_id,customer_id,property_id,updated_at,status into d from public.crm_proposals where id=p_document for update;
  elsif p_type='inspection' then
    select id,division_id,customer_id,property_id,updated_at,status into d from public.crm_inspections where id=p_document for update;
  elsif p_type='warranty' then
    select id,division_id,customer_id,property_id,updated_at,status into d from public.crm_warranties where id=p_document for update;
  else raise exception 'Unsupported document' using errcode='22023'; end if;
  if d.id is null or not exists(select 1 from public.crm_memberships m join public.crm_divisions div on div.id=m.division_id
    where m.user_id=p_actor and m.division_id=d.division_id and m.active and div.active
    and (m.role in ('owner','division_admin','office_manager')
      or (p_type='proposal' and m.role='sales_rep')
      or (p_type in ('inspection','warranty') and m.role in ('project_manager','production_manager'))
      or (p_type='inspection' and m.role='field_inspector'))) then
    raise exception 'Document write authority required' using errcode='42501'; end if;
  if d.updated_at is distinct from p_version then raise exception 'Document changed; reload before sending' using errcode='40001'; end if;
  select cust.id,cust.email into c from public.crm_customers cust
    join public.crm_properties prop on prop.customer_id=cust.id and prop.id=d.property_id
    join public.crm_customer_divisions cd on cd.customer_id=cust.id and cd.division_id=d.division_id where cust.id=d.customer_id;
  if not delivery_private.graph_matches(p_type,p_document,d.division_id,d.customer_id,d.property_id) or c.id is null or c.email is null or length(p_body)>30000000 or jsonb_typeof(p_body::jsonb)<>'object'
    or p_body::jsonb->'to' is distinct from jsonb_build_array(trim(c.email))
    or coalesce(length(p_body::jsonb->>'subject'),0)=0 or coalesce(length(p_context),0)<>64 then
    raise exception 'Invalid customer/property/request relationship' using errcode='42501'; end if;
  fingerprint:=delivery_private.context_fingerprint(p_type,p_document);
  if p_body::jsonb->>'_crm_context' is distinct from fingerprint then
    raise exception 'Delivery context changed during rendering' using errcode='40001'; end if;
  p_body:=(p_body::jsonb-'_crm_context')::text;
  if exists(select 1 from delivery_private.operations oldop join public.crm_document_deliveries olddelivery on olddelivery.id=oldop.id
    where oldop.document_type=p_type and oldop.document_id=p_document
      and (oldop.context_fingerprint is null or
        (olddelivery.status in ('sending','uncertain') and oldop.context_fingerprint<>fingerprint))) then
    raise exception 'Prior or unbound operation requires owner reconciliation; resend disabled' using errcode='40001'; end if;
  -- Serialize by document; the first immutable request wins, including PDF bytes.
  select * into o from delivery_private.operations where document_type=p_type and document_id=p_document and context_fingerprint=fingerprint for update;
  if p_type='proposal' and d.status not in ('draft','ready_to_send') then
    if d.status='sent' and o.id is not null then
      select * into outcome from public.crm_document_deliveries where id=o.id;
      if outcome.status='accepted' then return jsonb_build_object('action','complete','id',o.id,'status','accepted'); end if;
    end if;
    raise exception 'Proposal is not eligible for this delivery context' using errcode='42501';
  end if;
  if o.id is null then
    insert into public.crm_document_deliveries(division_id,document_type,document_id,customer_id,property_id,recipient_email,subject,status,created_by,authority)
      values(d.division_id,p_type,p_document,d.customer_id,d.property_id,trim(c.email),p_body::jsonb->>'subject','sending',p_actor,'server') returning id into v_id;
    p_body:=jsonb_set(p_body::jsonb,'{tags}',jsonb_build_array(jsonb_build_object('name','crm_operation','value',v_id::text)))::text;
    insert into delivery_private.operations(id,document_type,document_id,document_version,recipient,provider_context,request_body,context_fingerprint)
      values(v_id,p_type,p_document,p_version,trim(c.email),p_context,p_body,fingerprint) returning * into o;
  end if;
  select * into outcome from public.crm_document_deliveries where id=o.id;
  if outcome.status in ('accepted','sent','failed') then return jsonb_build_object('action','complete','id',o.id,'status',outcome.status); end if;
  if o.provider_context<>p_context or (o.first_attempt_at is not null and o.first_attempt_at<clock_timestamp()-interval '23 hours') then
    update public.crm_document_deliveries set status='uncertain',error_message='Owner reconciliation required; resend disabled.' where id=o.id;
    return jsonb_build_object('action','review','id',o.id,'status','uncertain'); end if;
  if o.lease_until>clock_timestamp() then return jsonb_build_object('action','busy','id',o.id); end if;
  claim:=gen_random_uuid();
  update delivery_private.operations set first_attempt_at=coalesce(first_attempt_at,clock_timestamp()),lease_until=clock_timestamp()+interval '90 seconds',claim_id=claim where id=o.id;
  insert into delivery_private.attempt_audit(operation_id,actor,event) values(o.id,p_actor,'CLAIM');
  return jsonb_build_object('action','send','id',o.id,'claim',claim,'key','crm-document/'||o.id,'body',o.request_body);
end $$;

create or replace function public.crm_finish_document_delivery(p_id uuid,p_claim uuid,p_status text,p_provider text,p_error text)
returns void language plpgsql security definer set search_path='' as $$
declare o delivery_private.operations%rowtype;
begin
  if p_claim is null then raise exception 'Missing delivery claim' using errcode='40001'; end if;
  if p_status is null or p_status not in ('accepted','failed','uncertain') or (p_status='accepted' and coalesce(length(p_provider),0)=0) then raise exception 'Invalid result'; end if;
  select * into o from delivery_private.operations where id=p_id;
  if o.document_type='proposal' then perform 1 from public.crm_proposals where id=o.document_id for update;
  elsif o.document_type='inspection' then perform 1 from public.crm_inspections where id=o.document_id for update;
  elsif o.document_type='warranty' then perform 1 from public.crm_warranties where id=o.document_id for update; end if;
  select * into o from delivery_private.operations where id=p_id for update;
  if not found or o.claim_id is null or o.claim_id is distinct from p_claim or o.lease_until is null or o.lease_until<=clock_timestamp() then raise exception 'Stale delivery claim' using errcode='40001'; end if;
  perform 1 from public.crm_document_deliveries where id=p_id and status in ('sending','uncertain') for update;
  if not found then raise exception 'Terminal delivery outcome is immutable' using errcode='40001'; end if;
  update public.crm_document_deliveries set status=p_status,provider_message_id=p_provider,error_message=left(p_error,1000),sent_at=case when p_status='accepted' then clock_timestamp() end where id=p_id;
  insert into delivery_private.attempt_audit(operation_id,event) values(p_id,p_status);
  update delivery_private.operations set lease_until=null,claim_id=null where id=p_id;
  if p_status='accepted' and o.document_type='proposal' then
    -- Compare-and-set protects accepted/declined and concurrent content changes.
    update public.crm_proposals set status='sent' where id=o.document_id and updated_at=o.document_version and status in ('draft','ready_to_send')
      and delivery_private.context_fingerprint('proposal',o.document_id)=o.context_fingerprint;
  end if;
end $$;

create or replace function public.crm_delivery_reconciliation(p_actor uuid,p_id uuid,p_provider text default null,p_event text default null,p_evidence text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o delivery_private.operations%rowtype; d public.crm_document_deliveries%rowtype;
begin
  select * into o from delivery_private.operations where id=p_id;
  if o.document_type='proposal' then perform 1 from public.crm_proposals where id=o.document_id for update;
  elsif o.document_type='inspection' then perform 1 from public.crm_inspections where id=o.document_id for update;
  elsif o.document_type='warranty' then perform 1 from public.crm_warranties where id=o.document_id for update; end if;
  select * into o from delivery_private.operations where id=p_id for update;
  select * into d from public.crm_document_deliveries where id=p_id for update;
  if o.id is null or not exists(select 1 from public.crm_memberships m join public.crm_divisions v on v.id=m.division_id where m.user_id=p_actor and m.division_id=d.division_id and m.role='owner' and m.active and v.active) then raise exception 'Exact division owner required' using errcode='42501'; end if;
  if p_provider is null then return jsonb_build_object('id',o.id,'body',o.request_body,'provider_context',o.provider_context,'context_fingerprint',o.context_fingerprint,'status',d.status); end if;
  if coalesce(length(trim(p_evidence)),0) not between 3 and 500 or o.lease_until>clock_timestamp() then raise exception 'Evidence or idle operation required'; end if;
  if d.provider_message_id is not null and d.provider_message_id<>p_provider then raise exception 'Conflicting provider identity'; end if;
  update public.crm_document_deliveries set status='accepted',provider_message_id=p_provider,provider_last_event=left(p_event,64),sent_at=coalesce(sent_at,clock_timestamp()),error_message=null where id=p_id;
  update delivery_private.operations set lease_until=null,claim_id=null where id=p_id;
  insert into delivery_private.attempt_audit(operation_id,actor,event) values(p_id,p_actor,'RECONCILE '||p_provider||' '||p_evidence);
  if o.document_type='proposal' then update public.crm_proposals set status='sent' where id=o.document_id and updated_at=o.document_version and status in ('draft','ready_to_send')
      and delivery_private.context_fingerprint('proposal',o.document_id)=o.context_fingerprint; end if;
  return jsonb_build_object('id',p_id,'status','accepted','provider_last_event',left(p_event,64));
end $$;
commit;
