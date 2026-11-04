-- Real baseline and migrations, synthetic identities only.
insert into auth.users(id,email) values('10000000-0000-0000-0000-000000000001','owner@example.test'),('10000000-0000-0000-0000-000000000003','other@example.test');
insert into public.crm_memberships(user_id,division_id,role) values('10000000-0000-0000-0000-000000000001','TRD','owner'),('10000000-0000-0000-0000-000000000003','CRD','owner');
set role service_role;
set request.jwt.claim.role='service_role';
do $$ declare a jsonb;b jsonb; p jsonb:='{"name":"Intake synthetic","email":"intake@example.test","phone":"9035550100","address":"1 Synthetic Way","city":"Test","state":"TX","zip":"00000","serviceRequested":"Inspection","source":"Google","utmCampaign":"test-campaign","message":"Synthetic only","submittedAt":"2026-11-04T12:00:00Z"}'; begin
 a:=public.crm_receive_website_lead('TRD','a0000000-0000-4000-8000-000000000001',p);
 if not (a->>'ok')::boolean then raise exception 'TRD delivery failed: %',a;end if;
 b:=public.crm_receive_website_lead('TRD','a0000000-0000-4000-8000-000000000001',p);
 if b->>'lead_id'<>a->>'lead_id' or not (b->>'replayed')::boolean then raise exception 'Replay changed identity';end if;
 b:=public.crm_receive_website_lead('TRD','a0000000-0000-4000-8000-000000000001',p||'{"message":"Changed"}');
 if b->>'status'<>'conflict' then raise exception 'Changed payload accepted';end if;
 b:=public.crm_receive_website_lead('CRD','a0000000-0000-4000-8000-000000000002',p||'{"companyName":"Synthetic business"}');
 if not (b->>'ok')::boolean then raise exception 'CRD delivery failed: %',b;end if;
 -- Strong identity, same division, full address -> reuse only the exact customer/property.
 b:=public.crm_receive_website_lead('TRD','a0000000-0000-4000-8000-000000000003',p||'{"message":"Second distinct inquiry"}');
 if not (b->>'ok')::boolean then raise exception 'Exact match delivery failed: %',b;end if;
end $$;
reset role;
do $$ declare a public.crm_leads%rowtype;b public.crm_leads%rowtype;begin
 select * into a from public.crm_leads where source_record_id='website-TRD-a0000000-0000-4000-8000-000000000001';
 select * into b from public.crm_leads where source_record_id='website-TRD-a0000000-0000-4000-8000-000000000003';
 if a.customer_id<>b.customer_id or a.property_id<>b.property_id then raise exception 'Exact matching failed';end if;
 if a.assigned_to<>'10000000-0000-0000-0000-000000000001' or a.next_follow_up_at is null then raise exception 'Single operator ownership/follow-up missing';end if;
 if not exists(select 1 from public.crm_tasks where related_id=a.id and assigned_to=a.assigned_to) then raise exception 'Follow-up task missing';end if;
 if not exists(select 1 from intake_private.submissions where lead_id=a.id and payload->>'utmCampaign'='test-campaign' and payload->>'submittedAt'='2026-11-04T12:00:00Z') then raise exception 'Attribution lost';end if;
 if (select count(*) from intake_private.notifications where submission_key='a0000000-0000-4000-8000-000000000001' and recipient_kind='internal')<>1 then raise exception 'Notification duplicated';end if;
end $$;
-- Duplicate identities are deliberately not merged.
insert into public.crm_customers(customer_type,display_name,email,phone) values('individual','Intake synthetic','intake@example.test','9035550100');
insert into public.crm_customer_divisions(customer_id,division_id) select id,'TRD' from public.crm_customers where display_name='Intake synthetic' and not exists(select 1 from public.crm_customer_divisions where customer_id=crm_customers.id and division_id='TRD');
set role service_role;
select public.crm_receive_website_lead('TRD','a0000000-0000-4000-8000-000000000004','{"name":"Intake synthetic","email":"intake@example.test","phone":"9035550100"}');
select public.crm_receive_website_lead('TRD','a0000000-0000-4000-8000-000000000005','{"name":"Same name only","phone":"9035550100"}');
reset role;
do $$ begin
 if not exists(select 1 from intake_private.submissions where submission_key='a0000000-0000-4000-8000-000000000004' and matching='ambiguous_new_customer') then raise exception 'Ambiguous identity merged';end if;
 if not exists(select 1 from intake_private.submissions where submission_key='a0000000-0000-4000-8000-000000000005' and matching='insufficient_identity_new_customer') then raise exception 'Insufficient identity merged';end if;
end $$;
-- Inject a failure after customer/property/lead creation, before task commit.
create schema security_test;
create function security_test.intake_fail() returns trigger language plpgsql as $$ begin if new.title like '%rollback-fixture%' then raise exception 'Synthetic task failure' using errcode='P0001';end if;return new;end $$;
create trigger intake_fixture_failure before insert on public.crm_tasks for each row execute function security_test.intake_fail();
set role service_role;
select public.crm_receive_website_lead('TRD','a0000000-0000-4000-8000-000000000006','{"name":"Rollback fixture","phone":"9035550100","serviceRequested":"rollback-fixture"}');
reset role;
do $$ begin
 if exists(select 1 from public.crm_customers where display_name='Rollback fixture') or exists(select 1 from public.crm_leads where source_record_id='website-TRD-a0000000-0000-4000-8000-000000000006') then raise exception 'Partial graph committed';end if;
 if not exists(select 1 from intake_private.submissions where submission_key='a0000000-0000-4000-8000-000000000006' and status='failed' and attempts=1 and error_code='P0001') then raise exception 'Failed receipt lost';end if;
end $$;
drop trigger intake_fixture_failure on public.crm_tasks;
set role authenticated;
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='10000000-0000-0000-0000-000000000003';
do $$ begin
 begin perform public.crm_retry_website_lead('TRD','a0000000-0000-4000-8000-000000000006');raise exception 'Cross-division owner retried';exception when insufficient_privilege then null;end;
 begin perform public.crm_receive_website_lead('CRD',gen_random_uuid(),'{"name":"Forged","phone":"123"}');raise exception 'Browser intake grant';exception when insufficient_privilege then null;end;
end $$;
set request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
do $$ declare r jsonb;begin
 r:=public.crm_retry_website_lead('TRD','a0000000-0000-4000-8000-000000000006');
 if not (r->>'ok')::boolean then raise exception 'Owner recovery failed: %',r;end if;
 if jsonb_array_length(public.crm_website_intake_status('TRD'))<1 then raise exception 'Owner inbox empty';end if;
end $$;
reset role;
do $$ begin
 if (select count(*) from public.crm_leads where source_record_id='website-TRD-a0000000-0000-4000-8000-000000000006')<>1 then raise exception 'Recovery duplicate';end if;
 if (select count(*) from intake_private.attempts where submission_key='a0000000-0000-4000-8000-000000000006')<>2 then raise exception 'Attempt history lost';end if;
 if has_table_privilege('service_role','intake_private.submissions','SELECT,INSERT,UPDATE,DELETE') or has_function_privilege('authenticated','intake_private.process(text,uuid)','EXECUTE') then raise exception 'Internal intake exposed';end if;
end $$;
-- Notification lease and finalizer evidence use real RPCs; no provider HTTP.
set role service_role;
set request.jwt.claim.role='service_role';
do $$ declare jobs jsonb; id uuid; a jsonb; b jsonb;begin
 jobs:=public.crm_intake_notification_work();id:=(jobs->0->>'id')::uuid;
 a:=public.crm_claim_intake_notification(id,'{"to":["owner@example.test"],"text":"Synthetic"}');
 b:=public.crm_claim_intake_notification(id,'{"to":["owner@example.test"],"text":"Synthetic"}');
 if a->>'action'<>'send' or b->>'action'<>'busy' then raise exception 'Notification claim concurrency failed';end if;
 begin perform public.crm_finish_intake_notification(id,null,'sent','forged',null);raise exception 'NULL finalizer accepted';exception when insufficient_privilege then null;end;
 perform public.crm_finish_intake_notification(id,(a->>'claim')::uuid,'uncertain',null,'Synthetic timeout');
 b:=public.crm_claim_intake_notification(id,'{"to":["owner@example.test"],"text":"Synthetic"}');
 if b->>'action'<>'manual_review' then raise exception 'Uncertain notification resent';end if;
end $$;
reset role;
-- Booking ships disabled, including for service callers.
set role service_role;
do $$ begin
 begin perform public.crm_booking_operation('reserve','{"key":"c0000000-0000-4000-8000-000000000001"}');raise exception 'Booking activated';exception when object_not_in_prerequisite_state then null;end;
end $$;
reset role;
-- Enable only the disposable fixture; source migration default remains false.
update intake_private.booking_settings set enabled=true;
do $$ declare r jsonb; request jsonb; lead uuid;begin
 select id into lead from public.crm_leads where source_record_id='website-TRD-a0000000-0000-4000-8000-000000000001';
 request:=jsonb_build_object('key','c0000000-0000-4000-8000-000000000001','division','TRD','operator','10000000-0000-0000-0000-000000000001','lead',lead,'calendar','synthetic','starts','2027-01-04T15:00:00Z','ends','2027-01-04T16:00:00Z','context','{}'::jsonb);
 set local role service_role;
 r:=public.crm_booking_operation('reserve',request);
 if r->>'action'<>'create' then raise exception 'Reservation failed';end if;
 if public.crm_booking_operation('reserve',request)->>'action'<>'replay' then raise exception 'Booking replay changed identity';end if;
 begin perform public.crm_booking_operation('reserve',request||'{"key":"c0000000-0000-4000-8000-000000000002"}');raise exception 'Operator double booked';exception when exclusion_violation then null;end;
 perform public.crm_booking_operation('finish',jsonb_build_object('key',request->>'key','claim',r->>'claim','status','confirmed','provider','synthetic-event'));
 r:=public.crm_booking_operation('begin_change',jsonb_build_object('key',request->>'key','starts','2027-01-05T15:00:00Z','ends','2027-01-05T16:00:00Z'));
 perform public.crm_booking_operation('finish',jsonb_build_object('key',request->>'key','claim',r->>'claim','status','uncertain'));
 begin perform public.crm_booking_operation('reserve',request||'{"key":"c0000000-0000-4000-8000-000000000003","starts":"2027-01-05T15:00:00Z","ends":"2027-01-05T16:00:00Z"}');raise exception 'Uncertain new slot released';exception when exclusion_violation then null;end;
 begin perform public.crm_booking_operation('reserve',request||'{"key":"c0000000-0000-4000-8000-000000000004"}');raise exception 'Uncertain old slot released';exception when exclusion_violation then null;end;
 r:=public.crm_booking_operation('reserve',request||'{"key":"c0000000-0000-4000-8000-000000000005","starts":"2027-01-06T15:00:00Z","ends":"2027-01-06T16:00:00Z"}');
 perform public.crm_booking_operation('finish',jsonb_build_object('key',r->>'request_key','claim',r->>'claim','status','confirmed','provider','synthetic-event-2'));
 r:=public.crm_booking_operation('begin_change',jsonb_build_object('key',r->>'request_key'));
 perform public.crm_booking_operation('finish',jsonb_build_object('key',r->>'request_key','claim',r->>'claim','status','cancelled'));
 reset role;
 if has_function_privilege('authenticated','public.crm_booking_operation(text,jsonb)','EXECUTE') then raise exception 'Booking store exposed to browser';end if;
end $$;
-- A new lead can enter actual scheduled inspection/proposal workflows under RLS.
set role authenticated;
set request.jwt.claim.role='authenticated';
set request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
do $$ declare lead public.crm_leads%rowtype; appointment uuid; inspection uuid; proposal uuid;begin
 select * into lead from public.crm_leads where source_record_id='website-TRD-a0000000-0000-4000-8000-000000000001';
 insert into public.crm_appointments(division_id,lead_id,customer_id,property_id,starts_at,ends_at,assigned_to) values('TRD',lead.id,lead.customer_id,lead.property_id,'2027-01-07T15:00:00Z','2027-01-07T16:00:00Z',auth.uid()) returning id into appointment;
 insert into public.crm_inspections(division_id,appointment_id,lead_id,customer_id,property_id,inspector_id) values('TRD',appointment,lead.id,lead.customer_id,lead.property_id,auth.uid()) returning id into inspection;
 insert into public.crm_proposals(division_id,customer_id,property_id,title,pricing_mode,lump_sum_amount,subtotal,total_amount) values('TRD',lead.customer_id,lead.property_id,'Synthetic intake proposal','lump_sum',1000,1000,1000) returning id into proposal;
 update public.crm_leads set status='appointment_set' where id=lead.id;
 if not exists(select 1 from public.crm_inspections where id=inspection) or not exists(select 1 from public.crm_proposals where id=proposal) then raise exception 'Operational workflow links unavailable';end if;
end $$;
reset role;
