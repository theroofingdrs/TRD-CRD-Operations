begin;
alter table intake_private.bookings add column operation text not null default 'create' check(operation in ('create','move','cancel'));
create function intake_private.track_booking_operation() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status='changing' and old.status='confirmed' then new.operation:=case when new.proposed_start is null then 'cancel' else 'move' end;end if;
 return new;
end $$;
revoke all on function intake_private.track_booking_operation() from public,anon,authenticated,service_role;
create trigger booking_change_kind before update on intake_private.bookings for each row execute function intake_private.track_booking_operation();
-- Positive provider evidence only. Absence can settle a requested cancellation,
-- never an uncertain create or move. Claims bind evidence to the inspected epoch.
create function public.crm_reconcile_booking(p_key uuid,p_claim uuid,p_outcome text,p_provider text,p_start timestamptz,p_end timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r intake_private.bookings%rowtype;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted booking server required' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Fresh READ COMMITTED required' using errcode='25001';end if;
 if (select enabled from intake_private.booking_settings where id) is distinct from true then raise exception 'Booking disabled' using errcode='55000';end if;
 perform pg_advisory_xact_lock(271026,4);
 perform pg_advisory_xact_lock(hashtextextended('booking-key:'||p_key,0));
 select * into strict r from intake_private.bookings where request_key=p_key for update;
 if p_claim is null or r.claim<>p_claim or r.status not in ('uncertain','reserved','changing') then raise exception 'Stale recovery evidence' using errcode='42501';end if;
 if p_outcome='confirmed' then
  if r.operation='cancel' or p_provider is distinct from coalesce(r.provider_id,'roof'||replace(p_key::text,'-',''))
   or p_start is distinct from coalesce(r.proposed_start,r.start_at)+coalesce((r.context->>'before')::integer,0)*interval '1 minute'
   or p_end is distinct from coalesce(r.proposed_end,r.end_at)-coalesce((r.context->>'after')::integer,0)*interval '1 minute' then raise exception 'Provider evidence does not match the pending operation' using errcode='42501';end if;
 elsif p_outcome='cancelled' then
  if r.operation<>'cancel' or p_provider is distinct from r.provider_id or p_provider is null then raise exception 'Only the pending cancellation can be reconciled as absent' using errcode='42501';end if;
 else raise exception 'Unsupported recovery outcome' using errcode='22023';end if;
 -- Keep the original claim and reserved capacity; reuse the atomic finalizer.
 update intake_private.bookings set status=case when operation='create' then 'reserved' else 'changing' end where request_key=p_key;
 insert into intake_private.booking_audit(request_key,action) values(p_key,'positive_provider_evidence:'||p_outcome);
 return public.crm_booking_operation('finish',jsonb_build_object('key',p_key,'claim',p_claim,'status',p_outcome,'provider',p_provider));
end $$;
-- The server derives actor from a verified Auth token, never request JSON.
create function public.crm_booking_staff_context(p_actor uuid,p_division text,p_key uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' or not exists(select 1 from public.crm_memberships m join public.crm_divisions d on d.id=m.division_id where m.user_id=p_actor and m.division_id=p_division and m.active and d.active and m.role in ('owner','division_admin','office_manager','sales_rep','project_manager','field_inspector')) then raise exception 'Active scheduling authority required' using errcode='42501';end if;
 if p_key is not null and not exists(select 1 from intake_private.bookings where request_key=p_key and division_id=p_division) then raise exception 'Booking not accessible in this division' using errcode='42501';end if;
 return jsonb_build_object('authorized',true,'enabled',(select enabled from intake_private.booking_settings where id));
end $$;
revoke all on function public.crm_reconcile_booking(uuid,uuid,text,text,timestamptz,timestamptz),public.crm_booking_staff_context(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.crm_reconcile_booking(uuid,uuid,text,text,timestamptz,timestamptz),public.crm_booking_staff_context(uuid,text,uuid) to service_role;
create function public.crm_staff_booking_status(p_division text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.crm_memberships m join public.crm_divisions d on d.id=m.division_id where m.user_id=auth.uid() and m.division_id=p_division and m.active and d.active and m.role in ('owner','division_admin','office_manager','sales_rep','project_manager','field_inspector')) then raise exception 'Scheduling authority required' using errcode='42501';end if;
 return jsonb_build_object('enabled',(select enabled from intake_private.booking_settings where id),'bookings',coalesce((select jsonb_agg(to_jsonb(b)) from (select request_key,lead_id,appointment_id,status,start_at,end_at,proposed_start,proposed_end from intake_private.bookings where division_id=p_division order by updated_at desc limit 100)b),'[]'::jsonb));
end $$;
revoke all on function public.crm_staff_booking_status(text) from public,anon,service_role;
grant execute on function public.crm_staff_booking_status(text) to authenticated;
create function intake_private.guard_booking_links() returns trigger language plpgsql security definer set search_path='' as $$
declare b intake_private.bookings%rowtype;l public.crm_leads%rowtype;begin
 select * into b from intake_private.bookings where appointment_id=new.id;
 if found then
  select * into strict l from public.crm_leads where id=b.lead_id;
  if new.division_id is distinct from b.division_id or new.lead_id is distinct from b.lead_id or new.customer_id is distinct from l.customer_id or new.property_id is distinct from l.property_id then raise exception 'Provider-linked appointment associations must match the saved booking' using errcode='42501';end if;
 end if;
 return new;
end $$;
revoke all on function intake_private.guard_booking_links() from public,anon,authenticated,service_role;
create trigger crm_booking_links before update of division_id,lead_id,customer_id,property_id on public.crm_appointments for each row execute function intake_private.guard_booking_links();
commit;
