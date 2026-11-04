-- Additive guards only: no historical rows are rewritten and no policies change.
begin;
create function app_private.guard_operational_links() returns trigger
language plpgsql security definer set search_path='' as $$
declare c uuid; p uuid; l public.crm_leads%rowtype;
begin
 c:=new.customer_id; p:=new.property_id;
 if (c is not null and not exists(select 1 from public.crm_customer_divisions where customer_id=c and division_id=new.division_id)) or (p is not null and not exists(select 1 from public.crm_properties pr join public.crm_customer_divisions cd on cd.customer_id=pr.customer_id where pr.id=p and cd.division_id=new.division_id)) then
  raise exception 'Customer and property must belong to the record division' using errcode='23514';
 end if;
 if c is not null and p is not null and not exists(select 1 from public.crm_properties where id=p and customer_id=c) then
  raise exception 'Property must belong to the selected customer' using errcode='23514';
 end if;
 if tg_table_name='crm_leads' then
  if new.contact_id is not null and not exists(select 1 from public.crm_contacts co join public.crm_customer_divisions cd on cd.customer_id=co.customer_id where co.id=new.contact_id and (c is null or co.customer_id=c) and cd.division_id=new.division_id) then
   raise exception 'Contact must belong to the selected customer' using errcode='23514';
  end if;
 elsif new.lead_id is not null then
  select * into l from public.crm_leads where id=new.lead_id;
  if l.id is null or l.division_id<>new.division_id or (c is not null and l.customer_id is not null and c<>l.customer_id) or (p is not null and l.property_id is not null and p<>l.property_id) then
   raise exception 'Lead, customer, property and division must describe the same work' using errcode='23514';
  end if;
 end if;
 return new;
end $$;
revoke all on function app_private.guard_operational_links() from public,anon,authenticated,service_role;
create trigger crm_consistent_lead_links before insert or update of customer_id,property_id,contact_id,division_id on public.crm_leads for each row execute function app_private.guard_operational_links();
create trigger crm_consistent_appointment_links before insert or update of customer_id,property_id,lead_id,division_id on public.crm_appointments for each row execute function app_private.guard_operational_links();
create trigger crm_consistent_project_links before insert or update of customer_id,property_id,lead_id,division_id on public.crm_projects for each row execute function app_private.guard_operational_links();
commit;
