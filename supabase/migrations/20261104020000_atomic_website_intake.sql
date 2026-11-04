-- Additive, service-only intake. Never backfills or changes historical inquiries.
begin;
create schema intake_private;
revoke all on schema intake_private from public,anon,authenticated,service_role;
create table intake_private.submissions (
 division_id text not null references public.crm_divisions(id), submission_key uuid not null,
 payload jsonb not null check(jsonb_typeof(payload)='object'), fingerprint text not null,
 received_at timestamptz not null default clock_timestamp(), status text not null default 'pending' check(status in ('pending','failed','delivered')),
 attempts integer not null default 0, lead_id uuid references public.crm_leads(id) on delete restrict,
 source_id text not null unique, matching text, error_code text, error_message text,
 primary key(division_id,submission_key)
);
create table intake_private.attempts (
 id bigint generated always as identity primary key, division_id text not null, submission_key uuid not null,
 attempted_at timestamptz not null default clock_timestamp(), actor_id uuid, outcome text not null, error_code text, error_message text,
 foreign key(division_id,submission_key) references intake_private.submissions
);
create table intake_private.attachments (
 id uuid primary key default gen_random_uuid(),division_id text not null,submission_key uuid not null,
 lead_id uuid not null references public.crm_leads(id) on delete restrict,ordinal integer not null,
 filename text not null,mime text not null,size_bytes integer not null,sha256 text not null,
 foreign key(division_id,submission_key) references intake_private.submissions,
 unique(division_id,submission_key,ordinal)
);
alter table intake_private.attachments enable row level security;
create table intake_private.notifications (
 id uuid primary key default gen_random_uuid(), division_id text not null, submission_key uuid not null,
 recipient_kind text not null check(recipient_kind in ('internal','customer')),
 status text not null default 'pending' check(status in ('pending','sending','sent','uncertain','failed')),
 body text, body_hash text, claim_token uuid, started_at timestamptz, provider_id text, last_error text,
 created_at timestamptz not null default now(), unique(division_id,submission_key,recipient_kind),
 foreign key(division_id,submission_key) references intake_private.submissions
);
alter table intake_private.submissions enable row level security;
alter table intake_private.attempts enable row level security;
alter table intake_private.notifications enable row level security;
revoke all on all tables in schema intake_private from public,anon,authenticated,service_role;
revoke all on all sequences in schema intake_private from public,anon,authenticated,service_role;
-- Legacy public-site mirror uses the existing documented website table contract.
-- CREATE IF NOT EXISTS does not alter its existing schema, policies or rows.
create table if not exists public.trd_records (
 id text primary key, record_type text not null, payload jsonb not null default '{}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint trd_records_payload_is_object check(jsonb_typeof(payload)='object')
);
alter table public.trd_records enable row level security;
-- Fail closed if the pre-existing source table has browser write/read access.
do $$ begin
 if exists(select 1 from pg_policies where schemaname='public' and tablename='trd_records')
 then
 raise exception 'Reconcile existing website intake grants/policies before cutover'; end if;
end $$;
revoke all on public.trd_records from anon,authenticated;
create function intake_private.process(d text,k uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare r intake_private.submissions%rowtype; p jsonb; customer uuid; contact uuid; property uuid; lead uuid; operator uuid;
 name text; email text; phone text; company text; address text; city text; state text; postal text; service text;
 candidates uuid[]; matched text:='new'; code text; detail text; replay boolean; photo jsonb; photo_position integer; media text; bytes bytea; manifest jsonb:='[]';
begin
 select * into strict r from intake_private.submissions where division_id=d and submission_key=k for update;
 replay:=r.status='delivered';
 if not replay then
  update intake_private.submissions set attempts=attempts+1,error_code=null,error_message=null where division_id=d and submission_key=k;
  begin
   p:=r.payload;
   name:=btrim(coalesce(nullif(p->'contactRecord'->>'fullName',''),nullif(concat_ws(' ',p->'contactRecord'->>'firstName',p->'contactRecord'->>'lastName'),''),nullif(p->>'name',''),nullif(p->>'fullName',''),nullif(p->>'contactName',''),nullif(concat_ws(' ',p->>'firstName',p->>'lastName'),''),''));
   email:=lower(btrim(coalesce(p->'contactRecord'->>'email',p->>'email','')));
   phone:=btrim(coalesce(p->'contactRecord'->>'phone',p->>'phone',''));
   company:=btrim(coalesce(p->'organizationRecord'->>'companyName',p->>'companyName',''));
   address:=btrim(coalesce(p->'propertyRecord'->>'address',p->>'address',p->>'propertyAddress',''));
   city:=btrim(coalesce(p->'propertyRecord'->>'city',p->>'city',''));
   state:=upper(btrim(coalesce(p->'propertyRecord'->>'state',p->>'state','')));
   postal:=btrim(coalesce(p->'propertyRecord'->>'zip',p->>'zip',''));
   service:=coalesce(nullif(btrim(p->>'serviceRequested'),''),nullif(btrim(p->>'leadType'),''),'Roofing inquiry');
   if email<>'' and email !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then email:='';end if;
   if length(regexp_replace(phone,'[^0-9]','','g'))<7 then phone:='';end if;
   if email='' and phone='' then raise exception 'Contact method is required' using errcode='22023'; end if;
   if name='' and company='' then raise exception 'Contact or company name is required' using errcode='22023'; end if;
   -- Serialize matching within the division; never attach an uncertain identity.
   perform pg_advisory_xact_lock(hashtextextended('website-customer:'||d,0));
   if email<>'' and regexp_replace(phone,'[^0-9]','','g')<>'' then
    select array_agg(c.id) into candidates from public.crm_customers c
    join public.crm_customer_divisions cd on cd.customer_id=c.id and cd.division_id=d
    where lower(btrim(c.email))=email and regexp_replace(c.phone,'[^0-9]','','g')=regexp_replace(phone,'[^0-9]','','g')
    and lower(btrim(c.display_name))=lower(coalesce(nullif(company,''),name))
    and c.customer_type=case when company<>'' then 'business' else 'individual' end;
    if cardinality(candidates)=1 then customer:=candidates[1];matched:='exact_identity';
    elsif cardinality(candidates)>1 then matched:='ambiguous_new_customer'; end if;
   else matched:='insufficient_identity_new_customer'; end if;
   if customer is null then
    insert into public.crm_customers(customer_type,display_name,legal_name,email,phone,preferred_contact_method)
    values(case when company<>'' then 'business' else 'individual' end,coalesce(nullif(company,''),name),nullif(company,''),nullif(email,''),nullif(phone,''),case when phone<>'' then 'phone' else 'email' end) returning id into customer;
    insert into public.crm_customer_divisions(customer_id,division_id) values(customer,d);
   end if;
   select array_agg(id) into candidates from public.crm_contacts where customer_id=customer and lower(btrim(full_name))=lower(coalesce(nullif(name,''),company)) and coalesce(lower(btrim(crm_contacts.email)),'')=email and regexp_replace(coalesce(crm_contacts.phone,''),'[^0-9]','','g')=regexp_replace(phone,'[^0-9]','','g');
   if cardinality(candidates)=1 then contact:=candidates[1];else
    insert into public.crm_contacts(customer_id,full_name,email,phone,is_primary)
    values(customer,coalesce(nullif(name,''),company),nullif(email,''),nullif(phone,''),not exists(select 1 from public.crm_contacts where customer_id=customer and is_primary)) returning id into contact;
   end if;
   if address<>'' and city<>'' and state<>'' then
    select array_agg(id) into candidates from public.crm_properties where customer_id=customer
     and lower(btrim(address_line1))=lower(address) and lower(btrim(crm_properties.city))=lower(city)
     and upper(btrim(crm_properties.state))=state and postal<>'' and btrim(postal_code)=postal;
    if cardinality(candidates)=1 then property:=candidates[1];
    else
     insert into public.crm_properties(customer_id,address_line1,city,state,postal_code,property_type,property_name)
     values(customer,address,city,state,nullif(postal,''),case when d='CRD' then 'commercial' else 'residential' end,nullif(p->'propertyRecord'->>'propertyName','')) returning id into property;
    end if;
   end if;
   select array_agg(user_id) into candidates from public.crm_memberships where division_id=d and active and role='sales_rep';
   if cardinality(candidates)=1 then operator:=candidates[1];
   else
    select array_agg(user_id) into candidates from public.crm_memberships where division_id=d and active and role='owner';
    if cardinality(candidates)=1 then operator:=candidates[1];end if;
   end if;
   insert into public.crm_leads(division_id,customer_id,contact_id,property_id,source,service_interest,status,priority,assigned_to,next_follow_up_at,description,source_record_id,created_at)
   values(d,customer,contact,property,coalesce(nullif(p->>'source',''),'Website'),service,'new',
    case when p->>'emergencyFlag'='true' or lower(p->>'priority')='emergency' or lower(p->>'leadType')='emergency' then 'urgent' else 'normal' end,
    operator,r.received_at,concat_ws(E'\n',nullif(p->>'message',''),nullif(p->>'notes',''),'Website details: '||(p-'photos')::text||case when jsonb_array_length(coalesce(p->'photos','[]'))>0 then E'\nPrivate attachments are available from this lead.' else '' end),r.source_id,r.received_at) returning id into lead;
   if jsonb_typeof(coalesce(p->'photos','[]'))<>'array' or jsonb_array_length(coalesce(p->'photos','[]'))>10 then raise exception 'Invalid photo manifest' using errcode='22023';end if;
   for photo,photo_position in select value,ordinality::integer-1 from jsonb_array_elements(coalesce(p->'photos','[]')) with ordinality loop
    media:=substring(photo->>'dataUrl' from '^data:([^;]+);base64,');
    if media not in ('image/jpeg','image/png','image/webp','application/pdf') or media is null then raise exception 'Unsupported attachment format' using errcode='22023';end if;
    bytes:=decode(substring(photo->>'dataUrl' from ',(.*)$'),'base64');
    if octet_length(bytes)<4 or octet_length(bytes)>15728640 or (media='image/jpeg' and encode(substring(bytes from 1 for 3),'hex')<>'ffd8ff') or (media='image/png' and encode(substring(bytes from 1 for 8),'hex')<>'89504e470d0a1a0a') or (media='application/pdf' and substring(bytes from 1 for 5)<>convert_to('%PDF-','UTF8')) or (media='image/webp' and (substring(bytes from 1 for 4)<>convert_to('RIFF','UTF8') or substring(bytes from 9 for 4)<>convert_to('WEBP','UTF8'))) then raise exception 'Attachment content/size mismatch' using errcode='22023';end if;
    insert into intake_private.attachments(division_id,submission_key,lead_id,ordinal,filename,mime,size_bytes,sha256) values(d,k,lead,photo_position,left(coalesce(nullif(photo->>'name',''),'attachment'),255),media,octet_length(bytes),encode(sha256(bytes),'hex'));
   end loop;
   select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',filename,'type',mime,'size',size_bytes)),'[]') into manifest from intake_private.attachments where lead_id=lead;
   insert into public.crm_tasks(division_id,title,description,assigned_to,due_at,related_type,related_id)
    values(d,'Follow up: '||left(service,150),'New website inquiry. Review source details and contact the customer.',operator,r.received_at,'lead',lead);
   insert into public.trd_records(id,record_type,payload,created_at,updated_at)
    values(r.source_id,'lead',(p-'photos')||jsonb_build_object('photos',manifest)||jsonb_build_object('id',r.source_id,'leadId',case when d='CRD' then r.source_id else null end,'division',case when d='CRD' then 'commercial' else 'RESIDENTIAL' end,'crmLeadId',lead,'createdAt',r.received_at),r.received_at,r.received_at);
   insert into public.crm_activity_events(division_id,actor_id,entity_type,entity_id,action,summary,details)
    values(d,auth.uid(),'lead',lead,'website_intake','Website inquiry delivered to CRM',jsonb_build_object('submission_key',k,'source_id',r.source_id,'matching',matched));
   insert into intake_private.notifications(division_id,submission_key,recipient_kind) values(d,k,'internal');
   if email<>'' then insert into intake_private.notifications(division_id,submission_key,recipient_kind) values(d,k,'customer');end if;
   update intake_private.submissions set status='delivered',lead_id=lead,matching=matched where division_id=d and submission_key=k;
   insert into intake_private.attempts(division_id,submission_key,actor_id,outcome) values(d,k,auth.uid(),'delivered');
  exception when others then
   get stacked diagnostics code=returned_sqlstate,detail=message_text;
   -- Inner transaction rolls back every CRM/source/outbox write. Receipt survives.
   update intake_private.submissions set status='failed',error_code=code,error_message=left(detail,500) where division_id=d and submission_key=k;
   insert into intake_private.attempts(division_id,submission_key,actor_id,outcome,error_code,error_message) values(d,k,auth.uid(),'failed',code,left(detail,500));
  end;
 else
  update intake_private.submissions set attempts=attempts+1 where division_id=d and submission_key=k;
  insert into intake_private.attempts(division_id,submission_key,actor_id,outcome) values(d,k,auth.uid(),'replayed');
 end if;
 select * into strict r from intake_private.submissions where division_id=d and submission_key=k;
 return jsonb_build_object('ok',r.status='delivered','status',r.status,'lead_id',r.lead_id,'source_id',r.source_id,'submission_key',k,'received_at',r.received_at,'replayed',replay,'error_code',r.error_code);
end $$;
create function public.crm_receive_website_lead(p_division text,p_key uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare fingerprint text; existing text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted website server required' using errcode='42501';end if;
 if p_division is null or p_division not in ('TRD','CRD') or p_key is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>26214400 then raise exception 'Invalid inquiry envelope' using errcode='22023';end if;
 if not exists(select 1 from public.crm_divisions where id=p_division and active) then raise exception 'Division unavailable' using errcode='22023';end if;
 fingerprint:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 insert into intake_private.submissions(division_id,submission_key,payload,fingerprint,source_id)
 values(p_division,p_key,p_payload,fingerprint,'website-'||p_division||'-'||p_key) on conflict(division_id,submission_key) do nothing;
 select s.fingerprint into existing from intake_private.submissions s where division_id=p_division and submission_key=p_key for update;
 if existing<>fingerprint then
  insert into intake_private.attempts(division_id,submission_key,actor_id,outcome,error_code) values(p_division,p_key,auth.uid(),'key_conflict','IDEMPOTENCY_CONFLICT');
  return jsonb_build_object('ok',false,'status','conflict','error_code','IDEMPOTENCY_CONFLICT');end if;
 return intake_private.process(p_division,p_key);
end $$;
create function public.crm_retry_website_lead(p_division text,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.crm_memberships where division_id=p_division and user_id=auth.uid() and role='owner' and active) then raise exception 'Active division owner required' using errcode='42501';end if;
 return intake_private.process(p_division,p_key);
end $$;
create function public.crm_website_intake_status(p_division text,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.crm_memberships where division_id=p_division and user_id=auth.uid() and role='owner' and active) then raise exception 'Active division owner required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(s)) from (select submission_key,received_at,status,attempts,lead_id,matching,error_code,error_message,(select jsonb_object_agg(recipient_kind,status) from intake_private.notifications n where n.division_id=intake_private.submissions.division_id and n.submission_key=intake_private.submissions.submission_key) as notifications from intake_private.submissions where division_id=p_division order by case status when 'failed' then 0 when 'pending' then 1 else 2 end,received_at desc limit 100 offset greatest(0,p_offset)) s),'[]');
end $$;
create function public.crm_website_intake_details(p_division text,p_key uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p jsonb;begin
 if not exists(select 1 from public.crm_memberships where division_id=p_division and user_id=auth.uid() and role='owner' and active) then raise exception 'Active division owner required' using errcode='42501';end if;
 select payload into p from intake_private.submissions where division_id=p_division and submission_key=p_key;
 if not found then raise exception 'Receipt not found' using errcode='22023';end if;
 return (p-'photos')||jsonb_build_object('attachments',case when jsonb_typeof(p->'photos')='array' then (select coalesce(jsonb_agg(jsonb_build_object('name',value->>'name','type',value->>'type','size',value->'size')),'[]') from jsonb_array_elements(p->'photos')) else '[]'::jsonb end);
end $$;
create function public.crm_website_lead_attachments(p_lead uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare d text;begin
 select division_id into d from public.crm_leads where id=p_lead;
 if not exists(select 1 from public.crm_memberships where user_id=auth.uid() and division_id=d and active) or not app_private.has_division_resource_access(d,'leads',false) then raise exception 'Lead access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'filename',filename,'mime',mime,'size_bytes',size_bytes,'sha256',sha256)) from intake_private.attachments where lead_id=p_lead),'[]');
end $$;
create function public.crm_website_attachment(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare f intake_private.attachments%rowtype;data text;begin
 select * into f from intake_private.attachments where id=p_id;
 if not found then raise exception 'Lead attachment access required' using errcode='42501';end if;
 if not exists(select 1 from public.crm_memberships where user_id=auth.uid() and division_id=f.division_id and active) or not app_private.has_division_resource_access(f.division_id,'leads',false) or not exists(select 1 from public.crm_leads where id=f.lead_id and division_id=f.division_id) then raise exception 'Lead attachment access required' using errcode='42501';end if;
 select substring(payload->'photos'->f.ordinal->>'dataUrl' from ',(.*)$') into data from intake_private.submissions where division_id=f.division_id and submission_key=f.submission_key;
 if encode(sha256(decode(data,'base64')),'hex')<>f.sha256 then raise exception 'Attachment integrity mismatch';end if;
 insert into intake_private.attempts(division_id,submission_key,actor_id,outcome) values(f.division_id,f.submission_key,auth.uid(),'attachment_read:'||f.id);
 return jsonb_build_object('filename',f.filename,'mime',f.mime,'data_base64',data,'sha256',f.sha256);
end $$;
revoke all on function public.crm_website_lead_attachments(uuid),public.crm_website_attachment(uuid) from public,anon,service_role;
grant execute on function public.crm_website_lead_attachments(uuid),public.crm_website_attachment(uuid) to authenticated;
revoke all on all functions in schema intake_private from public,anon,authenticated,service_role;
revoke all on function public.crm_receive_website_lead(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crm_receive_website_lead(text,uuid,jsonb) to service_role;
revoke all on function public.crm_retry_website_lead(text,uuid),public.crm_website_intake_status(text,integer),public.crm_website_intake_details(text,uuid) from public,anon,service_role;
grant execute on function public.crm_retry_website_lead(text,uuid),public.crm_website_intake_status(text,integer),public.crm_website_intake_details(text,uuid) to authenticated;
commit;
