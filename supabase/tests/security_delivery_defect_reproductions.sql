-- Run transactionally AFTER the historical migration and BEFORE its corrective follow-up.
-- These assertions expect the two independently reviewed defects to reproduce.
begin;
insert into auth.users(id,email) values('11000000-0000-0000-0000-000000000001','review-owner@example.test');
insert into public.crm_divisions(id,name,business_scope) values('TRD','Synthetic','Residential') on conflict(id) do nothing;
insert into public.crm_memberships(user_id,division_id,role) values('11000000-0000-0000-0000-000000000001','TRD','owner');
insert into public.crm_customers(id,customer_type,display_name,email) values('21000000-0000-0000-0000-000000000001','individual','Review fixture','review@example.test');
insert into public.crm_customer_divisions(customer_id,division_id) values('21000000-0000-0000-0000-000000000001','TRD');
insert into public.crm_properties(id,customer_id,address_line1,city,state) values('31000000-0000-0000-0000-000000000001','21000000-0000-0000-0000-000000000001','Synthetic','Test','TX');
insert into public.crm_proposals(id,division_id,customer_id,property_id,title,updated_at) values
('41000000-0000-0000-0000-000000000001','TRD','21000000-0000-0000-0000-000000000001','31000000-0000-0000-0000-000000000001','Review original','2026-11-03T00:00:00Z');
set local request.jwt.claim.role='service_role';
do $$ declare op jsonb; duplicate jsonb; v timestamptz; begin
 set local role service_role;
 op:=public.crm_claim_document_delivery('11000000-0000-0000-0000-000000000001','proposal','41000000-0000-0000-0000-000000000001','2026-11-03T00:00:00Z','{"to":["review@example.test"],"subject":"Review"}',repeat('a',64));
 perform public.crm_finish_document_delivery((op->>'id')::uuid,(op->>'claim')::uuid,'accepted','review-provider',null);
 reset role;
 update public.crm_proposals set title='Review changed content' where id='41000000-0000-0000-0000-000000000001';
 update public.crm_customers set email='changed-review@example.test' where id='21000000-0000-0000-0000-000000000001';
 select updated_at into v from public.crm_proposals where id='41000000-0000-0000-0000-000000000001';
 set local role service_role;
 duplicate:=public.crm_claim_document_delivery('11000000-0000-0000-0000-000000000001','proposal','41000000-0000-0000-0000-000000000001',v,'{"to":["changed-review@example.test"],"subject":"Changed review"}',repeat('a',64));
 if duplicate->>'action'<>'complete' or duplicate->>'status'<>'accepted' or duplicate->>'id'<>op->>'id' then raise exception 'Stale acceptance did not reproduce'; end if;
 perform public.crm_finish_document_delivery((op->>'id')::uuid,null,'failed',null,'Exact NULL-claim review reproduction');
 reset role;
 if (select status from public.crm_document_deliveries where id=(op->>'id')::uuid)<>'failed' then raise exception 'NULL claim accepted-to-failed did not reproduce'; end if;
end $$;
rollback;
