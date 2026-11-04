begin;
-- Default-off is tested before deliberately enabling this disposable fixture.
set local role service_role;set local request.jwt.claim.role='service_role';
do $$begin if public.crm_operational_notification_work()<>'[]' then raise exception 'Default-off work leaked';end if;end $$;
reset role;
update intake_private.notification_settings set capture_enabled=true,delivery_enabled=true,reminder_minutes=60;
-- Future fixture date is explicit; no real recipients or providers.
insert into public.crm_appointments(id,division_id,customer_id,starts_at,ends_at) select 'd1000000-0000-4000-8000-000000000001','TRD',customer_id,'2099-01-05T15:00Z','2099-01-05T16:00Z' from public.crm_leads where source_record_id='website-TRD-a0000000-0000-4000-8000-000000000001';
do $$begin if (select count(*) from intake_private.operational_notifications where source_id='d1000000-0000-4000-8000-000000000001')<>2 then raise exception 'Appointment/reminder not captured';end if;end $$;
update public.crm_appointments set starts_at='2099-01-06T15:00Z',ends_at='2099-01-06T16:00Z' where id='d1000000-0000-4000-8000-000000000001';
do $$begin if (select count(*) from intake_private.operational_notifications where source_id='d1000000-0000-4000-8000-000000000001' and status='cancelled')<>2 then raise exception 'Stale appointment notifications survived';end if;end $$;
set local role service_role;set local request.jwt.claim.role='service_role';
do $$declare j jsonb;n uuid;r jsonb;begin
 j:=public.crm_operational_notification_work();if jsonb_array_length(j)<>1 then raise exception 'Due jobs wrong (future reminders must wait): %',j;end if;n:=(j->0->>'id')::uuid;
 r:=public.crm_claim_operational_notification(n,jsonb_build_object('to',jsonb_build_array(j->0->>'recipient'),'text','Synthetic only'));
 if r->>'action'<>'send' then raise exception 'Claim failed';end if;
 if public.crm_claim_operational_notification(n,jsonb_build_object('to',jsonb_build_array(j->0->>'recipient'),'text','Synthetic only'))->>'action'<>'busy' then raise exception 'Concurrent duplicate claim';end if;
 begin perform public.crm_finish_operational_notification(n,null,'accepted','provider-synthetic',null);raise exception 'Null claim accepted';exception when insufficient_privilege then null;end;
 -- Receipt arrives before HTTP acceptance; acceptance must retain stronger evidence.
 perform public.crm_operational_notification_receipt('provider-event-1','provider-synthetic','delivered');
 perform public.crm_operational_notification_receipt('provider-event-1','provider-synthetic','delivered');
 perform public.crm_finish_operational_notification(n,(r->>'claim')::uuid,'accepted','provider-synthetic',null);
end $$;
reset role;
do $$begin
 if not exists(select 1 from intake_private.operational_notifications where provider_id='provider-synthetic' and status='delivered') then raise exception 'Early delivery evidence lost';end if;
 if (select count(*) from intake_private.notification_events where provider_event='provider-event-1')<>1 then raise exception 'Duplicate receipt audit';end if;
 if has_table_privilege('authenticated','intake_private.operational_notifications','SELECT') or has_function_privilege('authenticated','public.crm_operational_notification_receipt(text,text,text)','EXECUTE') then raise exception 'Private queue or receipt injection exposed';end if;
end $$;
set local role service_role;set local request.jwt.claim.role='service_role';
select public.crm_operational_notification_receipt('provider-event-2','provider-synthetic','bounced');
select public.crm_operational_notification_receipt('provider-event-3','provider-synthetic','delivered');
do $$declare n uuid;r jsonb;begin
 n:=(public.crm_intake_notification_work()->0->>'id')::uuid;
 r:=public.crm_claim_intake_notification(n,'{"to":["test@example.test"],"text":"Synthetic receipt evidence"}');
 if r->>'action'='send' then
  perform public.crm_operational_notification_receipt('early-intake-receipt','intake-provider-synthetic','delivered');
  perform public.crm_finish_intake_notification(n,(r->>'claim')::uuid,'sent','intake-provider-synthetic',null);
 end if;
end $$;
reset role;
do $$begin if not exists(select 1 from intake_private.notifications where provider_id='intake-provider-synthetic' and delivery_state='delivered') then raise exception 'Intake early receipt lost';end if;end $$;
set local role service_role;set local request.jwt.claim.role='service_role';
select public.crm_assign_employee_access('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','TRD','read_only');
-- Invitations cannot demote an owner, grant ownership or use another division.
do $$begin
 begin perform public.crm_assign_employee_access('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','TRD','sales_rep');raise exception 'Owner demotion';exception when insufficient_privilege then null;end;
 begin perform public.crm_assign_employee_access('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','CRD','sales_rep');raise exception 'Cross division assignment';exception when insufficient_privilege then null;end;
 begin perform public.crm_assign_employee_access('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','TRD','owner');raise exception 'Owner creation';exception when invalid_parameter_value then null;end;
end $$;
set local role authenticated;set local request.jwt.claim.role='authenticated';set local request.jwt.claim.sub='10000000-0000-0000-0000-000000000003';
do $$begin
 begin perform public.crm_operational_notification_status('TRD');raise exception 'Cross division owner saw notifications';exception when insufficient_privilege then null;end;
end $$;
set local request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
do $$declare j jsonb;begin j:=public.crm_operational_notification_status('TRD');if not exists(select 1 from jsonb_array_elements(j)n where n->>'status'='bounced') then raise exception 'Delivery regressed after bounce';end if;end $$;
rollback;
