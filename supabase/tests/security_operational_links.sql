-- Runs in a rollback-only subfixture after intake fixtures. Tests real RLS writes.
begin;
insert into public.crm_customers(id,customer_type,display_name) values('b1000000-0000-4000-8000-000000000001','individual','Different synthetic customer');
insert into public.crm_customer_divisions(customer_id,division_id) values('b1000000-0000-4000-8000-000000000001','TRD');
insert into public.crm_properties(id,customer_id,address_line1,city,state) values('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Synthetic','Test','TX');
insert into public.crm_contacts(id,customer_id,full_name) values('b3000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Synthetic contact');
insert into auth.users(id,email,raw_user_meta_data) values('b9000000-0000-4000-8000-000000000001','unassigned@example.test','{"role":"owner","division_id":"TRD"}');
do $$begin
 begin insert into public.crm_leads(division_id,customer_id) values('CRD','b1000000-0000-4000-8000-000000000001');raise exception 'Trusted writer crossed divisions';exception when check_violation then null;end;
end $$;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='b9000000-0000-4000-8000-000000000001';
do $$declare t text;n integer;begin
 if app_private.is_crm_owner() or app_private.has_any_active_membership() then raise exception 'Auth metadata granted CRM access';end if;
 foreach t in array array['crm_leads','crm_customers','crm_properties','crm_appointments','crm_projects','crm_files','crm_project_transactions'] loop
  execute format('select count(*) from public.%I',t) into n;
  if n<>0 then raise exception 'Unassigned account read protected records: %',t;end if;
 end loop;
 begin insert into public.crm_memberships(user_id,division_id,role) values(auth.uid(),'TRD','owner');raise exception 'Self assigned membership';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role authenticated;
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='10000000-0000-0000-0000-000000000001';
do $$ declare l public.crm_leads%rowtype; begin
 select * into strict l from public.crm_leads where source_record_id='website-TRD-a0000000-0000-4000-8000-000000000001';
 begin insert into public.crm_leads(division_id,customer_id,property_id) values('TRD',l.customer_id,'b2000000-0000-4000-8000-000000000001');raise exception 'Mismatched lead property accepted';exception when check_violation then null;end;
 begin insert into public.crm_leads(division_id,customer_id,contact_id) values('TRD',l.customer_id,'b3000000-0000-4000-8000-000000000001');raise exception 'Mismatched lead contact accepted';exception when check_violation then null;end;
 begin insert into public.crm_appointments(division_id,lead_id,customer_id,starts_at,ends_at) values('TRD',l.id,'b1000000-0000-4000-8000-000000000001','2027-02-01T15:00Z','2027-02-01T16:00Z');raise exception 'Mismatched appointment customer accepted';exception when check_violation then null;end;
 begin insert into public.crm_projects(division_id,lead_id,customer_id,property_id,project_name) values('TRD',l.id,'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','Wrong project');raise exception 'Mismatched project lead accepted';exception when check_violation then null;end;
 insert into public.crm_appointments(division_id,lead_id,customer_id,property_id,starts_at,ends_at) values('TRD',l.id,l.customer_id,l.property_id,'2027-02-01T15:00Z','2027-02-01T16:00Z');
end $$;
rollback;
