-- R3: advisory locks do not refresh REPEATABLE READ / SERIALIZABLE snapshots.
-- Enforce the supported isolation before every source statement, including
-- zero-row statements and privileged writes. No changes to data, RLS or grants.
begin;
-- Fail closed rather than create missing RPCs with default PUBLIC execution.
do $$ declare signature text; f regprocedure; begin
 if to_regclass('delivery_private.proposal_context_epochs') is null
  or to_regprocedure('delivery_private.source_context_after()') is null then
  raise exception 'Reviewed R2 epoch migration required before R3';
 end if;
 foreach signature in array array[
  'public.crm_freeze_document_render(uuid,text,uuid,jsonb)',
  'public.crm_claim_document_delivery(uuid,text,uuid,timestamp with time zone,text,text)',
  'public.crm_finish_document_delivery(uuid,uuid,text,text,text)',
  'public.crm_delivery_reconciliation(uuid,uuid,text,text,text)'] loop
  f:=to_regprocedure(signature);
  if f is null then raise exception 'Reviewed R2 RPC missing: %',signature; end if;
  if has_function_privilege('anon',f,'EXECUTE') or has_function_privilege('authenticated',f,'EXECUTE')
   or not has_function_privilege('service_role',f,'EXECUTE') then
   raise exception 'Unexpected R2 execution grants: %',signature;
  end if;
  if not exists(select 1 from pg_proc where oid=f and prosecdef
    and proconfig=array['search_path=""']) then
   raise exception 'Unexpected R2 function configuration: %',signature;
  end if;
 end loop;
end $$;
create function delivery_private.require_context_read_committed() returns void
language plpgsql stable set search_path='' as $$ begin
 if current_setting('transaction_isolation') <> 'read committed' then
  raise exception 'Document context requires READ COMMITTED; roll back and restart the entire transaction at READ COMMITTED'
   using errcode='25001';
 end if;
end $$;
revoke all on function delivery_private.require_context_read_committed() from public,anon,authenticated,service_role;

create function delivery_private.source_context_isolation() returns trigger
language plpgsql security definer set search_path='' as $$ begin
 perform delivery_private.require_context_read_committed();
 return null;
end $$;
revoke all on function delivery_private.source_context_isolation() from public,anon,authenticated,service_role;

do $$ declare t text; begin
 foreach t in array array['public.crm_proposals','public.crm_customers','public.crm_properties','public.crm_proposal_templates','public.crm_files','storage.objects'] loop
  execute format('create trigger aaa_proposal_context_isolation before insert or update or delete on %s for each statement execute function delivery_private.source_context_isolation()',t);
 end loop;
end $$;

-- Explicit copies of the R2 entrypoints preserve their signatures, ACLs,
-- authorization, artifact assertions and lock ordering. Only the first
-- executable statement is new. Check isolation before inspecting any context.
create or replace function public.crm_freeze_document_render(p_actor uuid,p_type text,p_document uuid,p_inputs jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actual jsonb; fingerprint text; s delivery_private.render_snapshots%rowtype; o delivery_private.operations%rowtype;
begin
 perform delivery_private.require_context_read_committed();
 perform public.crm_document_delivery_context(p_actor,p_type,p_document);
 if p_type='proposal' then perform delivery_private.lock_proposal_context(); end if;
 case p_type
 when 'proposal' then perform 1 from public.crm_proposals where id=p_document for update;
 when 'inspection' then perform 1 from public.crm_inspections where id=p_document for update;
 when 'warranty' then perform 1 from public.crm_warranties where id=p_document for update;
 end case;
 -- Recheck after acquiring the lock, including membership and graph changes.
 perform public.crm_document_delivery_context(p_actor,p_type,p_document);
 actual:=public.crm_document_render_inputs(p_type,p_document);
 if actual is distinct from p_inputs then raise exception 'Source changed before snapshot freeze' using errcode='40001'; end if;
 fingerprint:=delivery_private.render_fingerprint(actual);
 insert into delivery_private.render_snapshots(document_type,document_id,actor,context_fingerprint,inputs)
  values(p_type,p_document,p_actor,fingerprint,actual) on conflict(document_type,document_id,context_fingerprint) do nothing;
 select * into strict s from delivery_private.render_snapshots where document_type=p_type and document_id=p_document and context_fingerprint=fingerprint;
 select * into o from delivery_private.operations where document_type=p_type and document_id=p_document and context_fingerprint=fingerprint;
 return jsonb_build_object('id',s.id,'inputs',s.inputs,'context',fingerprint,'captured_at',s.captured_at,
  'current_version',actual->>'version','cached_body',case when o.render_snapshot_id=s.id then o.request_body end);
end $$;

create or replace function public.crm_claim_document_delivery(p_actor uuid,p_type text,p_document uuid,p_version timestamptz,p_body text,p_context text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d record; c record; v_id uuid; o delivery_private.operations%rowtype; outcome public.crm_document_deliveries%rowtype; claim uuid; fingerprint text; s delivery_private.render_snapshots%rowtype; artifact text;
begin
 perform delivery_private.require_context_read_committed();
  if p_type='proposal' then
    perform public.crm_document_delivery_context(p_actor,p_type,p_document);
    perform delivery_private.lock_proposal_context();
  end if;
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
  select * into s from delivery_private.render_snapshots where id=nullif(p_body::jsonb->>'_crm_snapshot','')::uuid;
  artifact:=encode(sha256(decode(p_body::jsonb->'attachments'->0->>'content','base64')),'hex');
  if s.id is null or s.document_type<>p_type or s.document_id<>p_document or s.context_fingerprint<>fingerprint
    or artifact is null or artifact is distinct from p_body::jsonb->>'_crm_pdf_sha256' then
    raise exception 'Snapshot/artifact binding required' using errcode='40001'; end if;
  p_body:=(p_body::jsonb-'_crm_context'-'_crm_snapshot'-'_crm_pdf_sha256')::text;
  if exists(select 1 from delivery_private.operations oldop join public.crm_document_deliveries olddelivery on olddelivery.id=oldop.id
    where oldop.document_type=p_type and oldop.document_id=p_document
      and (oldop.render_snapshot_id is null or oldop.context_fingerprint is null or
        (olddelivery.status in ('sending','uncertain') and oldop.context_fingerprint<>fingerprint))) then
    raise exception 'Prior or unbound operation requires owner reconciliation; resend disabled' using errcode='40001'; end if;
  -- Serialize by document; the first immutable request wins, including PDF bytes.
  select * into o from delivery_private.operations where document_type=p_type and document_id=p_document and context_fingerprint=fingerprint for update;
  if o.id is not null then
    perform delivery_private.assert_render_artifact(o.id);
    p_body:=jsonb_set(p_body::jsonb,'{tags}',jsonb_build_array(jsonb_build_object('name','crm_operation','value',o.id::text)))::text;
    if o.render_snapshot_id is distinct from s.id or o.artifact_sha256 is distinct from artifact or o.request_body is distinct from p_body then
      raise exception 'Existing operation has different artifact/request' using errcode='40001'; end if;
  end if;
  if p_type='proposal' and d.status not in ('draft','ready_to_send') then
    if d.status='sent' and o.id is not null then
      select * into outcome from public.crm_document_deliveries where id=o.id;
      if outcome.status='accepted' then return jsonb_build_object('action','complete','id',o.id,'status','accepted'); end if;
    end if;
    raise exception 'Proposal is not eligible for this delivery context' using errcode='42501';
  end if;
  if o.id is null then
    insert into public.crm_document_deliveries(division_id,document_type,document_id,customer_id,property_id,recipient_email,subject,status,created_by,authority,render_snapshot_id,artifact_sha256)
      values(d.division_id,p_type,p_document,d.customer_id,d.property_id,trim(c.email),p_body::jsonb->>'subject','sending',p_actor,'server',s.id,artifact) returning id into v_id;
    p_body:=jsonb_set(p_body::jsonb,'{tags}',jsonb_build_array(jsonb_build_object('name','crm_operation','value',v_id::text)))::text;
    insert into delivery_private.operations(id,document_type,document_id,document_version,recipient,provider_context,request_body,context_fingerprint,render_snapshot_id,artifact_sha256,request_sha256)
      values(v_id,p_type,p_document,p_version,trim(c.email),p_context,p_body,fingerprint,s.id,artifact,encode(sha256(convert_to(p_body,'UTF8')),'hex')) returning * into o;
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
 perform delivery_private.require_context_read_committed();
  if p_claim is null then raise exception 'Missing delivery claim' using errcode='40001'; end if;
  if p_status is null or p_status not in ('accepted','failed','uncertain') or (p_status='accepted' and coalesce(length(p_provider),0)=0) then raise exception 'Invalid result'; end if;
  select * into o from delivery_private.operations where id=p_id;
  if o.document_type='proposal' then perform delivery_private.lock_proposal_context(); end if;
  if o.document_type='proposal' then perform 1 from public.crm_proposals where id=o.document_id for update;
  elsif o.document_type='inspection' then perform 1 from public.crm_inspections where id=o.document_id for update;
  elsif o.document_type='warranty' then perform 1 from public.crm_warranties where id=o.document_id for update; end if;
  select * into o from delivery_private.operations where id=p_id for update;
  if not found or o.claim_id is null or o.claim_id is distinct from p_claim or o.lease_until is null or o.lease_until<=clock_timestamp() then raise exception 'Stale delivery claim' using errcode='40001'; end if;
  perform 1 from public.crm_document_deliveries where id=p_id and status in ('sending','uncertain') for update;
  if not found then raise exception 'Terminal delivery outcome is immutable' using errcode='40001'; end if;
  perform delivery_private.assert_render_artifact(p_id);
  update public.crm_document_deliveries set status=p_status,provider_message_id=p_provider,error_message=left(p_error,1000),sent_at=case when p_status='accepted' then clock_timestamp() end where id=p_id;
  insert into delivery_private.attempt_audit(operation_id,event) values(p_id,p_status);
  update delivery_private.operations set lease_until=null,claim_id=null where id=p_id;
  if p_status='accepted' and o.document_type='proposal' then perform delivery_private.mark_current_proposal_sent(p_id); end if;
end $$;

create or replace function public.crm_delivery_reconciliation(p_actor uuid,p_id uuid,p_provider text default null,p_event text default null,p_evidence text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o delivery_private.operations%rowtype; d public.crm_document_deliveries%rowtype;
begin
 perform delivery_private.require_context_read_committed();
  select * into o from delivery_private.operations where id=p_id;
  if o.document_type='proposal' then
    if not exists(select 1 from public.crm_memberships m join public.crm_divisions v on v.id=m.division_id
      join public.crm_document_deliveries receipt on receipt.division_id=m.division_id and receipt.id=p_id
      where m.user_id=p_actor and m.role='owner' and m.active and v.active) then
      raise exception 'Exact division owner required' using errcode='42501'; end if;
    perform delivery_private.lock_proposal_context();
  end if;
  if o.document_type='proposal' then perform 1 from public.crm_proposals where id=o.document_id for update;
  elsif o.document_type='inspection' then perform 1 from public.crm_inspections where id=o.document_id for update;
  elsif o.document_type='warranty' then perform 1 from public.crm_warranties where id=o.document_id for update; end if;
  select * into o from delivery_private.operations where id=p_id for update;
  select * into d from public.crm_document_deliveries where id=p_id for update;
  if o.id is null or not exists(select 1 from public.crm_memberships m join public.crm_divisions v on v.id=m.division_id where m.user_id=p_actor and m.division_id=d.division_id and m.role='owner' and m.active and v.active) then raise exception 'Exact division owner required' using errcode='42501'; end if;
  if p_provider is null then return jsonb_build_object('id',o.id,'body',o.request_body,'provider_context',o.provider_context,'context_fingerprint',o.context_fingerprint,'render_snapshot_id',o.render_snapshot_id,'status',d.status); end if;
  if coalesce(length(trim(p_evidence)),0) not between 3 and 500 or o.lease_until>clock_timestamp() then raise exception 'Evidence or idle operation required'; end if;
  if d.provider_message_id is not null and d.provider_message_id<>p_provider then raise exception 'Conflicting provider identity'; end if;
  if o.render_snapshot_id is not null then perform delivery_private.assert_render_artifact(p_id); end if;
  update public.crm_document_deliveries set status='accepted',provider_message_id=p_provider,provider_last_event=left(p_event,64),sent_at=coalesce(sent_at,clock_timestamp()),error_message=null where id=p_id;
  update delivery_private.operations set lease_until=null,claim_id=null where id=p_id;
  insert into delivery_private.attempt_audit(operation_id,actor,event) values(p_id,p_actor,'RECONCILE '||p_provider||' '||p_evidence);
  if o.document_type='proposal' then perform delivery_private.mark_current_proposal_sent(p_id); end if;
  return jsonb_build_object('id',p_id,'status','accepted','provider_last_event',left(p_event,64));
end $$;

commit;
