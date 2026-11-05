-- Preserve intake classification fields for the notification worker.
-- The worker needs source/landing-page/service metadata to distinguish
-- ordinary leads from estimate requests. Photos remain excluded.
create or replace function public.crm_intake_notification_work() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then
  raise exception 'Trusted worker required' using errcode='42501';
 end if;
 return coalesce((
  select jsonb_agg(to_jsonb(j))
  from (
   select n.id,n.recipient_kind,n.status,s.division_id,s.submission_key,s.received_at,
          (s.payload-'photos') as payload
   from intake_private.notifications n
   join intake_private.submissions s using(division_id,submission_key)
   where s.status='delivered' and n.status in ('pending','failed','sending')
   order by n.created_at
   limit 20
  ) j
 ),'[]');
end $$;
revoke all on function public.crm_intake_notification_work() from public,anon,authenticated;
grant execute on function public.crm_intake_notification_work() to service_role;
