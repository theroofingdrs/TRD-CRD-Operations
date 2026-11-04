-- Durable, default-off operational notifications. No historical backfill or sends.
begin;
create table intake_private.notification_settings(id boolean primary key default true check(id),capture_enabled boolean not null default false,delivery_enabled boolean not null default false,reminder_minutes integer check(reminder_minutes between 1 and 10080));
insert into intake_private.notification_settings(id) values(true);
create table intake_private.operational_notifications(
 id uuid primary key default gen_random_uuid(),division_id text not null references public.crm_divisions(id),
 source_id uuid not null,source_type text not null check(source_type in ('lead','appointment','project')),
 kind text not null check(kind in ('assignment','appointment_update','appointment_reminder','project_completed')),
 event_key text not null unique,recipient text not null,payload jsonb not null,due_at timestamptz not null default now(),
 status text not null default 'pending' check(status in ('pending','sending','accepted','delivered','bounced','failed','uncertain','cancelled')),
 body text,claim uuid,started_at timestamptz,provider_id text unique,last_error text,created_at timestamptz not null default now()
);
create table intake_private.notification_events(id bigint generated always as identity primary key,notification_id uuid references intake_private.operational_notifications(id),provider_event text unique,provider_id text,event text not null,details text,created_at timestamptz not null default now());
alter table intake_private.notification_settings enable row level security;
alter table intake_private.operational_notifications enable row level security;
alter table intake_private.notification_events enable row level security;
revoke all on intake_private.notification_settings,intake_private.operational_notifications,intake_private.notification_events from public,anon,authenticated,service_role;
revoke all on all sequences in schema intake_private from public,anon,authenticated,service_role;
-- Intake acknowledgements share signed delivery evidence without changing the
-- existing 'sent = provider accepted' retry contract.
alter table intake_private.notifications add column delivery_state text check(delivery_state in ('delivered','bounced'));
create function intake_private.sync_intake_delivery_receipt() returns trigger language plpgsql security definer set search_path='' as $$
declare receipt text;begin
 if new.provider_id is not null then
  perform pg_advisory_xact_lock(hashtextextended('notification-provider:'||new.provider_id,0));
  select event into receipt from intake_private.notification_events where provider_id=new.provider_id and event in ('delivered','bounced') order by case event when 'bounced' then 0 else 1 end limit 1;
  new.delivery_state:=coalesce(receipt,new.delivery_state);
 end if;
 return new;
end $$;
revoke all on function intake_private.sync_intake_delivery_receipt() from public,anon,authenticated,service_role;
create trigger intake_delivery_receipt before insert or update of provider_id on intake_private.notifications for each row execute function intake_private.sync_intake_delivery_receipt();
create function intake_private.capture_operational_notification() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient text; kind text; payload jsonb; reminder integer; event text:=gen_random_uuid()::text;
begin
 if (select capture_enabled from intake_private.notification_settings where id) is distinct from true then return new;end if;
 if tg_table_name='crm_leads' then
  if new.assigned_to is null then return new;end if;
  if tg_op='UPDATE' then if new.assigned_to is not distinct from old.assigned_to then return new;end if;end if;
  select u.email into recipient from auth.users u join public.crm_memberships m on m.user_id=u.id where u.id=new.assigned_to and m.division_id=new.division_id and m.active;
  kind:='assignment';payload:=jsonb_build_object('reference',new.id,'assigned_to',new.assigned_to);
 elsif tg_table_name='crm_appointments' then
  if tg_op='UPDATE' then
   if row(new.starts_at,new.ends_at,new.status,new.customer_id,new.assigned_to) is not distinct from row(old.starts_at,old.ends_at,old.status,old.customer_id,old.assigned_to) then return new;end if;
   update intake_private.operational_notifications set status='cancelled' where source_type='appointment' and source_id=new.id and status in ('pending','failed');
  end if;
  select email into recipient from public.crm_customers where id=new.customer_id;
  kind:='appointment_update';payload:=jsonb_build_object('reference',new.id,'start',new.starts_at,'end',new.ends_at,'status',new.status);
 else
  if new.status<>'completed' then return new;end if;
  if tg_op='UPDATE' then if old.status='completed' then return new;end if;end if;
  select email into recipient from public.crm_customers where id=new.customer_id;
  kind:='project_completed';payload:=jsonb_build_object('reference',new.id);
 end if;
 if recipient is null or recipient !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+\.[^[:space:]<>@]+$' then return new;end if;
 insert into intake_private.operational_notifications(division_id,source_id,source_type,kind,event_key,recipient,payload) values(new.division_id,new.id,case tg_table_name when 'crm_leads' then 'lead' when 'crm_appointments' then 'appointment' else 'project' end,kind,event,recipient,payload);
 if tg_table_name='crm_appointments' and new.status in ('scheduled','confirmed') then
  select reminder_minutes into reminder from intake_private.notification_settings where id;
  if reminder is not null and new.starts_at-make_interval(mins=>reminder)>now() then
   insert into intake_private.operational_notifications(division_id,source_id,source_type,kind,event_key,recipient,payload,due_at) values(new.division_id,new.id,'appointment','appointment_reminder',event||':reminder',recipient,payload,new.starts_at-make_interval(mins=>reminder));
  end if;
 end if;
 return new;
end $$;
revoke all on function intake_private.capture_operational_notification() from public,anon,authenticated,service_role;
create trigger crm_notify_lead_assignment after insert or update on public.crm_leads for each row execute function intake_private.capture_operational_notification();
create trigger crm_notify_appointment after insert or update on public.crm_appointments for each row execute function intake_private.capture_operational_notification();
create trigger crm_notify_completion after insert or update on public.crm_projects for each row execute function intake_private.capture_operational_notification();
create function public.crm_operational_notification_work() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted worker required' using errcode='42501';end if;
 if (select delivery_enabled from intake_private.notification_settings where id) is distinct from true then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(to_jsonb(n)) from (select id,division_id,kind,recipient,payload from intake_private.operational_notifications where status in ('pending','sending') and due_at<=now() order by due_at limit 20)n),'[]');
end $$;
create function public.crm_claim_operational_notification(p_id uuid,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r intake_private.operational_notifications%rowtype;token uuid:=gen_random_uuid();a public.crm_appointments%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted worker required' using errcode='42501';end if;
 if (select delivery_enabled from intake_private.notification_settings where id) is distinct from true then return jsonb_build_object('action','disabled');end if;
 select * into strict r from intake_private.operational_notifications where id=p_id for update;
 if r.status not in ('pending','sending') or r.due_at>now() then return jsonb_build_object('action','skip');end if;
 if r.status='sending' then
  if r.started_at>now()-interval '1 minute' then return jsonb_build_object('action','busy');end if;
  update intake_private.operational_notifications set status='uncertain',last_error='Stale provider claim; review delivery evidence.' where id=p_id;
  return jsonb_build_object('action','manual_review');
 end if;
 if r.started_at<now()-interval '23 hours' then update intake_private.operational_notifications set status='uncertain' where id=p_id;return jsonb_build_object('action','manual_review');end if;
 if r.source_type='appointment' then
  select * into a from public.crm_appointments where id=r.source_id and division_id=r.division_id;
  if a.id is null or a.starts_at is distinct from (r.payload->>'start')::timestamptz or a.ends_at is distinct from (r.payload->>'end')::timestamptz or a.status is distinct from r.payload->>'status' or (r.kind='appointment_reminder' and (a.starts_at<=now() or a.status not in ('scheduled','confirmed'))) then update intake_private.operational_notifications set status='cancelled' where id=p_id;return jsonb_build_object('action','obsolete');end if;
 elsif r.source_type='lead' and not exists(select 1 from public.crm_leads l join public.crm_memberships m on m.user_id=l.assigned_to and m.division_id=l.division_id where l.id=r.source_id and l.division_id=r.division_id and l.assigned_to=(r.payload->>'assigned_to')::uuid and m.active) then
  update intake_private.operational_notifications set status='cancelled' where id=p_id;return jsonb_build_object('action','obsolete');
 end if;
 if jsonb_typeof(p_body) is distinct from 'object' or p_body->'to' is distinct from jsonb_build_array(r.recipient) or octet_length(p_body::text)>262144 or (r.body is not null and r.body<>p_body::text) then raise exception 'Invalid or changed frozen notification' using errcode='22023';end if;
 update intake_private.operational_notifications set body=coalesce(body,p_body::text),claim=token,started_at=coalesce(started_at,now()),status='sending' where id=p_id;
 insert into intake_private.notification_events(notification_id,event) values(p_id,'claimed');
 return jsonb_build_object('action','send','claim',token,'key','operations-'||p_id,'body',p_body::text);
end $$;
create function public.crm_finish_operational_notification(p_id uuid,p_claim uuid,p_status text,p_provider text,p_error text) returns void language plpgsql security definer set search_path='' as $$
declare r intake_private.operational_notifications%rowtype;receipt text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted worker required' using errcode='42501';end if;
 select * into strict r from intake_private.operational_notifications where id=p_id for update;
 if p_claim is null or r.claim is distinct from p_claim or r.status<>'sending' or p_status not in ('accepted','failed','uncertain') or (p_status='accepted' and nullif(p_provider,'') is null) then raise exception 'Stale notification completion' using errcode='42501';end if;
 -- Provider callbacks can arrive before the HTTP acceptance acknowledgement.
 if p_provider is not null then
  perform pg_advisory_xact_lock(hashtextextended('notification-provider:'||p_provider,0));
  select event into receipt from intake_private.notification_events where provider_id=p_provider and event in ('delivered','bounced') order by case event when 'bounced' then 0 else 1 end limit 1;
 end if;
 update intake_private.operational_notifications set status=case when p_status='accepted' then coalesce(receipt,p_status) else p_status end,provider_id=p_provider,last_error=left(p_error,500) where id=p_id;
 insert into intake_private.notification_events(notification_id,provider_id,event,details) values(p_id,p_provider,p_status,left(p_error,500));
end $$;
create function public.crm_operational_notification_receipt(p_event text,p_provider text,p_status text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Verified provider service required' using errcode='42501';end if;
 if nullif(p_event,'') is null or length(p_event)>200 or nullif(p_provider,'') is null or length(p_provider)>200 or p_status not in ('delivered','bounced') then raise exception 'Invalid receipt' using errcode='22023';end if;
 -- Same lock order as the finalizer: notification row, then provider mutex.
 perform 1 from intake_private.operational_notifications where provider_id=p_provider for update;
 perform 1 from intake_private.notifications where provider_id=p_provider for update;
 perform pg_advisory_xact_lock(hashtextextended('notification-provider:'||p_provider,0));
 insert into intake_private.notification_events(provider_event,provider_id,event) values(p_event,p_provider,p_status) on conflict(provider_event) do nothing;
 if not found then return;end if;
 update intake_private.operational_notifications set status=p_status where provider_id=p_provider and status in ('accepted','uncertain','delivered') and (status<>'delivered' or p_status='bounced');
 update intake_private.notifications set delivery_state=p_status where provider_id=p_provider and (delivery_state is null or (delivery_state='delivered' and p_status='bounced'));
end $$;
create function public.crm_operational_notification_status(p_division text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.crm_memberships where user_id=auth.uid() and division_id=p_division and role='owner' and active) then raise exception 'Exact division owner required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(n)) from (select id,source_id,kind,status,due_at,provider_id,last_error from intake_private.operational_notifications where division_id=p_division order by created_at desc limit 100)n),'[]');
end $$;
create function public.crm_retry_operational_notification(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare r intake_private.operational_notifications%rowtype;begin
 select * into strict r from intake_private.operational_notifications where id=p_id for update;
 if not exists(select 1 from public.crm_memberships where user_id=auth.uid() and division_id=r.division_id and role='owner' and active) then raise exception 'Exact division owner required' using errcode='42501';end if;
 if r.status<>'failed' or r.started_at<now()-interval '23 hours' then raise exception 'Provider evidence review required; automatic resend is unsafe' using errcode='55000';end if;
 update intake_private.operational_notifications set status='pending' where id=p_id;
 insert into intake_private.notification_events(notification_id,event,details) values(p_id,'owner_retry',auth.uid()::text);
end $$;
revoke all on function public.crm_operational_notification_work(),public.crm_claim_operational_notification(uuid,jsonb),public.crm_finish_operational_notification(uuid,uuid,text,text,text),public.crm_operational_notification_receipt(text,text,text),public.crm_operational_notification_status(text),public.crm_retry_operational_notification(uuid) from public,anon,authenticated,service_role;
grant execute on function public.crm_operational_notification_work(),public.crm_claim_operational_notification(uuid,jsonb),public.crm_finish_operational_notification(uuid,uuid,text,text,text),public.crm_operational_notification_receipt(text,text,text) to service_role;
grant execute on function public.crm_operational_notification_status(text),public.crm_retry_operational_notification(uuid) to authenticated;
create or replace function public.crm_website_intake_status(p_division text,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.crm_memberships where division_id=p_division and user_id=auth.uid() and role='owner' and active) then raise exception 'Active division owner required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(s)) from (select submission_key,received_at,status,attempts,lead_id,matching,error_code,error_message,(select jsonb_object_agg(recipient_kind,coalesce(delivery_state,status)) from intake_private.notifications n where n.division_id=intake_private.submissions.division_id and n.submission_key=intake_private.submissions.submission_key) as notifications from intake_private.submissions where division_id=p_division order by case status when 'failed' then 0 when 'pending' then 1 else 2 end,received_at desc limit 100 offset greatest(0,p_offset)) s),'[]');
end $$;
commit;
