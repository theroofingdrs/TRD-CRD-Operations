-- Reservation engine is deliberately disabled until an approved hosted cutover.
begin;
create table intake_private.booking_settings(id boolean primary key default true check(id), enabled boolean not null default false);
insert into intake_private.booking_settings values(true,false);
create table intake_private.bookings (
 request_key uuid primary key, division_id text not null references public.crm_divisions(id), operator_id uuid not null references auth.users(id),lead_id uuid not null references public.crm_leads(id),
 appointment_id uuid unique references public.crm_appointments(id) deferrable initially deferred,calendar_id text not null,start_at timestamptz not null,end_at timestamptz not null, context jsonb not null,fingerprint text not null,
 status text not null default 'reserved' check(status in ('reserved','confirmed','changing','uncertain','cancelled')),
 proposed_start timestamptz,proposed_end timestamptz,claim uuid not null default gen_random_uuid(),provider_id text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(end_at>start_at)
);
create table intake_private.booking_audit(id bigint generated always as identity primary key,request_key uuid not null,action text not null,created_at timestamptz not null default now());
alter table intake_private.booking_settings enable row level security;
alter table intake_private.bookings enable row level security;
alter table intake_private.booking_audit enable row level security;
revoke all on intake_private.booking_settings,intake_private.bookings,intake_private.booking_audit from public,anon,authenticated,service_role;
revoke all on all sequences in schema intake_private from public,anon,authenticated,service_role;
create function public.crm_booking_operation(p_action text,p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k uuid:=(p_request->>'key')::uuid; r intake_private.bookings%rowtype; operator uuid; starts timestamptz;ends timestamptz; hash text;lead public.crm_leads%rowtype;appointment uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted booking server required' using errcode='42501';end if;
 if not (select enabled from intake_private.booking_settings where id) then raise exception 'Booking disabled' using errcode='55000';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Booking requires a fresh READ COMMITTED transaction' using errcode='25001';end if;
 perform pg_advisory_xact_lock(271026,4);
 if k is null then raise exception 'Booking reference required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('booking-key:'||k,0));
 select * into r from intake_private.bookings where request_key=k for update;
 if p_action='reserve' then
  hash:=encode(sha256(convert_to((p_request-'key')::text,'UTF8')),'hex');
  if r.request_key is not null then
   if r.fingerprint<>hash then raise exception 'Booking key conflict' using errcode='22023';end if;
   return to_jsonb(r)||jsonb_build_object('action','replay');
  end if;
  operator:=(p_request->>'operator')::uuid;starts:=(p_request->>'starts')::timestamptz;ends:=(p_request->>'ends')::timestamptz;
  if operator is null or starts is null or ends is null or ends<=starts or nullif(p_request->>'calendar','') is null or not exists(select 1 from public.crm_memberships where user_id=operator and division_id=p_request->>'division' and active and role in ('owner','sales_rep','division_admin','office_manager','field_inspector')) or not exists(select 1 from public.crm_leads where id=(p_request->>'lead')::uuid and division_id=p_request->>'division') then raise exception 'Invalid booking graph or interval' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended('booking-operator:'||operator,0));
  if exists(select 1 from intake_private.bookings b where operator_id=operator and status<>'cancelled' and (tstzrange(start_at,end_at,'[)')&&tstzrange(starts,ends,'[)') or (proposed_start is not null and tstzrange(proposed_start,proposed_end,'[)')&&tstzrange(starts,ends,'[)')))) then raise exception 'Operator is already reserved' using errcode='23P01';end if;
  if exists(select 1 from public.crm_appointments a where assigned_to=operator and status not in ('cancelled','completed','no_show') and tstzrange(starts_at,ends_at,'[)')&&tstzrange(starts,ends,'[)')) then raise exception 'Operator has an existing CRM appointment' using errcode='23P01';end if;
  insert into intake_private.bookings(request_key,division_id,operator_id,lead_id,calendar_id,start_at,end_at,context,fingerprint) values(k,p_request->>'division',operator,(p_request->>'lead')::uuid,p_request->>'calendar',starts,ends,p_request->'context',hash) returning * into r;
  insert into intake_private.booking_audit(request_key,action) values(k,'reserved');
  return to_jsonb(r)||jsonb_build_object('action','create');
 end if;
 if r.request_key is null then
  if p_action='get' then return jsonb_build_object('action','missing');end if;
  raise exception 'Booking not found' using errcode='22023';end if;
 if p_action='get' then return to_jsonb(r);end if;
 perform pg_advisory_xact_lock(hashtextextended('booking-operator:'||r.operator_id,0));
 if p_action='begin_change' then
  if r.status<>'confirmed' then raise exception 'Booking needs reconciliation before changes' using errcode='55000';end if;
  starts:=(p_request->>'starts')::timestamptz;ends:=(p_request->>'ends')::timestamptz;
  if starts is not null then
   if ends is null or ends<=starts then raise exception 'Invalid interval' using errcode='22023';end if;
   if exists(select 1 from intake_private.bookings b where operator_id=r.operator_id and request_key<>k and status<>'cancelled' and (tstzrange(start_at,end_at,'[)')&&tstzrange(starts,ends,'[)') or (proposed_start is not null and tstzrange(proposed_start,proposed_end,'[)')&&tstzrange(starts,ends,'[)')))) then raise exception 'New slot unavailable' using errcode='23P01';end if;
  end if;
  if starts is not null and exists(select 1 from public.crm_appointments a where assigned_to=r.operator_id and id is distinct from r.appointment_id and status not in ('cancelled','completed','no_show') and tstzrange(starts_at,ends_at,'[)')&&tstzrange(starts,ends,'[)')) then raise exception 'New slot conflicts with CRM appointment' using errcode='23P01';end if;
  update intake_private.bookings set status='changing',proposed_start=starts,proposed_end=ends,claim=gen_random_uuid(),updated_at=now() where request_key=k returning * into r;
 elsif p_action='finish' then
  if p_request->>'claim' is distinct from r.claim::text or r.status not in ('reserved','changing') or p_request->>'status' not in ('confirmed','uncertain','cancelled') then raise exception 'Stale booking completion' using errcode='42501';end if;
  if p_request->>'status'='confirmed' and nullif(p_request->>'provider','') is null then raise exception 'Provider event required' using errcode='22023';end if;
  update intake_private.bookings set status=p_request->>'status',provider_id=coalesce(p_request->>'provider',provider_id),start_at=case when p_request->>'status'='confirmed' then coalesce(proposed_start,start_at) else start_at end,end_at=case when p_request->>'status'='confirmed' then coalesce(proposed_end,end_at) else end_at end,proposed_start=case when p_request->>'status'='uncertain' then proposed_start end,proposed_end=case when p_request->>'status'='uncertain' then proposed_end end,updated_at=now() where request_key=k returning * into r;
  if r.status='confirmed' then
   if not exists(select 1 from public.crm_memberships where user_id=r.operator_id and division_id=r.division_id and active) then raise exception 'Operator authority changed' using errcode='42501';end if;
   select * into strict lead from public.crm_leads where id=r.lead_id and division_id=r.division_id;
   if r.appointment_id is null then
    appointment:=gen_random_uuid();
    update intake_private.bookings set appointment_id=appointment where request_key=k returning * into r;
    insert into public.crm_appointments(id,division_id,lead_id,customer_id,property_id,assigned_to,starts_at,ends_at,internal_notes) values(appointment,r.division_id,r.lead_id,lead.customer_id,lead.property_id,r.operator_id,r.start_at+coalesce((r.context->>'before')::integer,0)*interval '1 minute',r.end_at-coalesce((r.context->>'after')::integer,0)*interval '1 minute','Website booking: '||r.request_key) returning id into appointment;
    update intake_private.bookings set appointment_id=appointment where request_key=k returning * into r;
   else
    update public.crm_appointments set starts_at=r.start_at+coalesce((r.context->>'before')::integer,0)*interval '1 minute',ends_at=r.end_at-coalesce((r.context->>'after')::integer,0)*interval '1 minute' where id=r.appointment_id and division_id=r.division_id and lead_id=r.lead_id;
   end if;
   update public.crm_leads set status='appointment_set' where id=r.lead_id and status in ('new','contacted','qualified');
   insert into intake_private.booking_audit(request_key,action) values(k,'confirmation_pending');
  elsif r.status='cancelled' and r.appointment_id is not null then update public.crm_appointments set status='cancelled' where id=r.appointment_id and division_id=r.division_id;end if;
 else raise exception 'Unsupported booking operation' using errcode='22023';end if;
 insert into intake_private.booking_audit(request_key,action) values(k,p_action||':'||r.status);
 return to_jsonb(r);
end $$;
-- Statement lock precedes row locks, preventing manual edits and booking
-- finalization from acquiring the same locks in opposite orders.
create function intake_private.lock_appointment_capacity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (select enabled from intake_private.booking_settings where id) or exists(select 1 from intake_private.bookings) then
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'Appointment capacity requires READ COMMITTED' using errcode='25001';end if;
  perform pg_advisory_xact_lock(271026,4);
 end if;
 return null;
end $$;
revoke all on function intake_private.lock_appointment_capacity() from public,anon,authenticated,service_role;
create trigger crm_booking_capacity_lock before insert or update or delete on public.crm_appointments for each statement execute function intake_private.lock_appointment_capacity();
create function intake_private.guard_appointment_capacity() returns trigger language plpgsql security definer set search_path='' as $$
declare op uuid;previous uuid;binding intake_private.bookings%rowtype;
begin
 if not (select enabled from intake_private.booking_settings where id) and not exists(select 1 from intake_private.bookings) then return new;end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Appointment capacity requires READ COMMITTED' using errcode='25001';end if;
 if tg_op='UPDATE' then previous:=old.assigned_to;end if;
 for op in select distinct x from unnest(array[new.assigned_to,previous]) x where x is not null order by x loop perform pg_advisory_xact_lock(hashtextextended('booking-operator:'||op,0));end loop;
 select * into binding from intake_private.bookings where appointment_id=new.id;
 if found and (new.assigned_to is distinct from binding.operator_id or new.starts_at is distinct from binding.start_at+coalesce((binding.context->>'before')::integer,0)*interval '1 minute' or new.ends_at is distinct from binding.end_at-coalesce((binding.context->>'after')::integer,0)*interval '1 minute' or (new.status='cancelled' and binding.status<>'cancelled')) then raise exception 'Use the verified booking change workflow for this appointment' using errcode='42501';end if;
 if new.assigned_to is not null and new.status not in ('cancelled','completed','no_show') then
  if exists(select 1 from public.crm_appointments a where assigned_to=new.assigned_to and id<>new.id and status not in ('cancelled','completed','no_show') and tstzrange(starts_at,ends_at,'[)')&&tstzrange(new.starts_at,new.ends_at,'[)'))
   or exists(select 1 from intake_private.bookings b where operator_id=new.assigned_to and appointment_id is distinct from new.id and status<>'cancelled' and (tstzrange(start_at,end_at,'[)')&&tstzrange(new.starts_at,new.ends_at,'[)') or (proposed_start is not null and tstzrange(proposed_start,proposed_end,'[)')&&tstzrange(new.starts_at,new.ends_at,'[)')))) then raise exception 'Operator capacity is unavailable' using errcode='23P01';end if;
 end if;
 return new;
end $$;
revoke all on function intake_private.guard_appointment_capacity() from public,anon,authenticated,service_role;
create trigger crm_booking_capacity before insert or update on public.crm_appointments for each row execute function intake_private.guard_appointment_capacity();
revoke all on function public.crm_booking_operation(text,jsonb) from public,anon,authenticated;
grant execute on function public.crm_booking_operation(text,jsonb) to service_role;
commit;
