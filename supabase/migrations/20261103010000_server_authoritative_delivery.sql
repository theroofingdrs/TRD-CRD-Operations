-- After the reviewed Operations pricing stack. Never applied by application startup.
begin;
do $$ begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='crm_proposals' and column_name='updated_at' and data_type='timestamp with time zone') then
    raise exception 'Reviewed proposal version column required';
  end if;
end $$;
revoke insert, update, delete on public.crm_document_deliveries from public,anon,authenticated;
-- Table revocation does not revoke historical column-level privileges.
revoke update(status,provider_message_id,error_message,sent_at) on public.crm_document_deliveries from public,anon,authenticated;
drop policy if exists crm_document_deliveries_insert on public.crm_document_deliveries;
drop policy if exists crm_document_deliveries_update on public.crm_document_deliveries;
do $$ declare a record; begin
  if exists(select 1 from pg_policies where schemaname='public' and tablename='crm_document_deliveries' and policyname<>'crm_document_deliveries_read') then raise exception 'Unexpected delivery policy; reconcile before cutover'; end if;
  for a in select attname from pg_attribute where attrelid='public.crm_document_deliveries'::regclass and attnum>0 and not attisdropped loop
    if has_column_privilege('authenticated','public.crm_document_deliveries',a.attname,'INSERT,UPDATE') or has_column_privilege('anon','public.crm_document_deliveries',a.attname,'INSERT,UPDATE') then raise exception 'Unexpected delivery column grant'; end if;
  end loop;
end $$;
alter table public.crm_document_deliveries drop constraint crm_document_deliveries_status_check;
alter table public.crm_document_deliveries add constraint crm_document_deliveries_status_check
  check(status in ('sending','sent','failed','accepted','uncertain'));
alter table public.crm_document_deliveries add column authority text not null default 'legacy_unverified' check(authority in ('legacy_unverified','server'));
alter table public.crm_document_deliveries add column provider_last_event text;
create schema delivery_private;
revoke all on schema delivery_private from public,anon,authenticated,service_role;
create table delivery_private.operations (
  id uuid primary key references public.crm_document_deliveries(id),
  document_type text not null,
  document_id uuid not null,
  document_version timestamptz not null,
  recipient text not null,
  provider_context text not null,
  request_body text not null,
  first_attempt_at timestamptz,
  lease_until timestamptz,
  claim_id uuid,
  unique(document_type,document_id,document_version,recipient)
);
alter table delivery_private.operations enable row level security;
create table delivery_private.attempt_audit(id bigint generated always as identity primary key,operation_id uuid not null references delivery_private.operations(id),actor uuid, event text not null,created_at timestamptz not null default now());
alter table delivery_private.attempt_audit enable row level security;
revoke all on all tables in schema delivery_private from public,anon,authenticated,service_role;

-- Validate every optional stored parent before any provider operation.
create function delivery_private.graph_matches(t text,i uuid,d text,c uuid,p uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare j jsonb;
begin
  case t
  when 'proposal' then select to_jsonb(x) into j from public.crm_proposals x where id=i;
  when 'inspection' then select to_jsonb(x) into j from public.crm_inspections x where id=i;
  when 'warranty' then select to_jsonb(x) into j from public.crm_warranties x where id=i;
  when 'project' then select to_jsonb(x) into j from public.crm_projects x where id=i;
  when 'lead' then select to_jsonb(x) into j from public.crm_leads x where id=i;
  when 'appointment' then select to_jsonb(x) into j from public.crm_appointments x where id=i;
  else return false;
  end case;
  if j is null or j->>'division_id' is distinct from d
    or (j->>'customer_id' is not null and j->>'customer_id'<>c::text)
    or (j->>'property_id' is not null and j->>'property_id'<>p::text) then return false; end if;
  if j->>'contact_id' is not null and not exists(select 1 from public.crm_contacts where id=(j->>'contact_id')::uuid and customer_id=c) then return false; end if;
  if t<>'lead' and j->>'lead_id' is not null and not delivery_private.graph_matches('lead',(j->>'lead_id')::uuid,d,c,p) then return false; end if;
  if t in ('proposal','warranty') and j->>'project_id' is not null and not delivery_private.graph_matches('project',(j->>'project_id')::uuid,d,c,p) then return false; end if;
  if t='warranty' and j->>'proposal_id' is not null and not delivery_private.graph_matches('proposal',(j->>'proposal_id')::uuid,d,c,p) then return false; end if;
  if t='project' and j->>'claim_id' is not null and not exists(select 1 from public.crm_claims cl where cl.id=(j->>'claim_id')::uuid and cl.division_id=d and cl.customer_id=c and cl.property_id=p and (cl.project_id is null or cl.project_id=i) and (cl.lead_id is null or cl.lead_id::text=j->>'lead_id')) then return false; end if;
  if t='inspection' and j->>'appointment_id' is not null and not delivery_private.graph_matches('appointment',(j->>'appointment_id')::uuid,d,c,p) then return false; end if;
  return true;
end $$;

-- Service-only boundary: p_actor MUST be the user returned by auth.getUser in
-- the Edge Function. Ordinary clients cannot execute these functions.
create function public.crm_claim_document_delivery(p_actor uuid,p_type text,p_document uuid,p_version timestamptz,p_body text,p_context text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d record; c record; v_id uuid; o delivery_private.operations%rowtype; outcome public.crm_document_deliveries%rowtype; claim uuid;
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
  if p_type='proposal' and d.status not in ('draft','ready_to_send') then
    select * into outcome from public.crm_document_deliveries where document_type=p_type and document_id=p_document and status='accepted' order by created_at desc limit 1;
    if found and d.status='sent' then return jsonb_build_object('action','complete','id',outcome.id,'status','accepted'); end if;
    raise exception 'Proposal is not eligible for delivery' using errcode='42501';
  end if;
  if d.updated_at is distinct from p_version then raise exception 'Document changed; reload before sending' using errcode='40001'; end if;
  select cust.id,cust.email into c from public.crm_customers cust
    join public.crm_properties prop on prop.customer_id=cust.id and prop.id=d.property_id
    join public.crm_customer_divisions cd on cd.customer_id=cust.id and cd.division_id=d.division_id where cust.id=d.customer_id;
  if not delivery_private.graph_matches(p_type,p_document,d.division_id,d.customer_id,d.property_id) or c.id is null or c.email is null or length(p_body)>30000000 or jsonb_typeof(p_body::jsonb)<>'object'
    or p_body::jsonb->'to' is distinct from jsonb_build_array(trim(c.email))
    or coalesce(length(p_body::jsonb->>'subject'),0)=0 or coalesce(length(p_context),0)<>64 then
    raise exception 'Invalid customer/property/request relationship' using errcode='42501'; end if;
  if exists(select 1 from delivery_private.operations oldop join public.crm_document_deliveries olddelivery on olddelivery.id=oldop.id
    where oldop.document_type=p_type and oldop.document_id=p_document and olddelivery.status in ('sending','uncertain') and (oldop.document_version<>p_version or oldop.recipient<>trim(c.email))) then
    raise exception 'Prior document version requires delivery reconciliation' using errcode='40001'; end if;
  -- Serialize by document; the first immutable request wins, including PDF bytes.
  select * into o from delivery_private.operations where document_type=p_type and document_id=p_document and document_version=p_version and recipient=trim(c.email) for update;
  if not found then
    insert into public.crm_document_deliveries(division_id,document_type,document_id,customer_id,property_id,recipient_email,subject,status,created_by,authority)
      values(d.division_id,p_type,p_document,d.customer_id,d.property_id,trim(c.email),p_body::jsonb->>'subject','sending',p_actor,'server') returning id into v_id;
    p_body:=jsonb_set(p_body::jsonb,'{tags}',jsonb_build_array(jsonb_build_object('name','crm_operation','value',v_id::text)))::text;
    insert into delivery_private.operations(id,document_type,document_id,document_version,recipient,provider_context,request_body)
      values(v_id,p_type,p_document,p_version,trim(c.email),p_context,p_body) returning * into o;
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

create function public.crm_finish_document_delivery(p_id uuid,p_claim uuid,p_status text,p_provider text,p_error text)
returns void language plpgsql security definer set search_path='' as $$
declare o delivery_private.operations%rowtype;
begin
  if p_status not in ('accepted','failed','uncertain') or (p_status='accepted' and coalesce(length(p_provider),0)=0) then raise exception 'Invalid result'; end if;
  select * into o from delivery_private.operations where id=p_id;
  if o.document_type='proposal' then perform 1 from public.crm_proposals where id=o.document_id for update;
  elsif o.document_type='inspection' then perform 1 from public.crm_inspections where id=o.document_id for update;
  elsif o.document_type='warranty' then perform 1 from public.crm_warranties where id=o.document_id for update; end if;
  select * into o from delivery_private.operations where id=p_id for update;
  if not found or o.claim_id is distinct from p_claim then raise exception 'Stale delivery claim' using errcode='40001'; end if;
  update public.crm_document_deliveries set status=p_status,provider_message_id=p_provider,error_message=left(p_error,1000),sent_at=case when p_status='accepted' then clock_timestamp() end where id=p_id;
  insert into delivery_private.attempt_audit(operation_id,event) values(p_id,p_status);
  update delivery_private.operations set lease_until=null,claim_id=null where id=p_id;
  if p_status='accepted' and o.document_type='proposal' then
    -- Compare-and-set protects accepted/declined and concurrent content changes.
    update public.crm_proposals set status='sent' where id=o.document_id and updated_at=o.document_version and status in ('draft','ready_to_send');
  end if;
end $$;

-- Read-only provider recovery uses an exact operation tag, not email/name matching.
create function public.crm_delivery_reconciliation(p_actor uuid,p_id uuid,p_provider text default null,p_event text default null,p_evidence text default null)
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
  if p_provider is null then return jsonb_build_object('id',o.id,'body',o.request_body,'provider_context',o.provider_context,'status',d.status); end if;
  if coalesce(length(trim(p_evidence)),0) not between 3 and 500 or o.lease_until>clock_timestamp() then raise exception 'Evidence or idle operation required'; end if;
  if d.provider_message_id is not null and d.provider_message_id<>p_provider then raise exception 'Conflicting provider identity'; end if;
  update public.crm_document_deliveries set status='accepted',provider_message_id=p_provider,provider_last_event=left(p_event,64),sent_at=coalesce(sent_at,clock_timestamp()),error_message=null where id=p_id;
  update delivery_private.operations set lease_until=null,claim_id=null where id=p_id;
  insert into delivery_private.attempt_audit(operation_id,actor,event) values(p_id,p_actor,'RECONCILE '||p_provider||' '||p_evidence);
  if o.document_type='proposal' then update public.crm_proposals set status='sent' where id=o.document_id and updated_at=o.document_version and status in ('draft','ready_to_send'); end if;
  return jsonb_build_object('id',p_id,'status','accepted','provider_last_event',left(p_event,64));
end $$;
revoke all on function public.crm_delivery_reconciliation(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.crm_delivery_reconciliation(uuid,uuid,text,text,text) to service_role;

create function delivery_private.guard_proposal_sent() returns trigger language plpgsql set search_path='' as $$
begin
  if new.status='sent' and (tg_op='INSERT' or old.status is distinct from new.status)
    and coalesce(auth.role(),'')<>'service_role' then raise exception 'Trusted delivery required' using errcode='42501'; end if;
  return new;
end $$;
create trigger crm_proposals_guard_sent before insert or update of status on public.crm_proposals for each row execute function delivery_private.guard_proposal_sent();
revoke all on all functions in schema delivery_private from public,anon,authenticated,service_role;
revoke all on function public.crm_claim_document_delivery(uuid,text,uuid,timestamptz,text,text) from public,anon,authenticated;
revoke all on function public.crm_finish_document_delivery(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.crm_claim_document_delivery(uuid,text,uuid,timestamptz,text,text) to service_role;
grant execute on function public.crm_finish_document_delivery(uuid,uuid,text,text,text) to service_role;
commit;
