begin;
-- The invitation endpoint must not silently demote an existing owner. Owner
-- membership lifecycle remains a separately reviewed administrative operation.
create function public.crm_assign_employee_access(p_actor uuid,p_employee uuid,p_division text,p_role text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' or not exists(select 1 from public.crm_memberships m join public.crm_divisions d on d.id=m.division_id where m.user_id=p_actor and m.division_id=p_division and m.role='owner' and m.active and d.active) then raise exception 'Exact division owner required' using errcode='42501';end if;
 if p_role is null or p_role not in ('division_admin','office_manager','sales_rep','project_manager','field_inspector','production_manager','accounting','read_only') then raise exception 'Invalid employee role' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('employee-membership:'||p_employee||':'||p_division,0));
 perform 1 from public.crm_memberships where user_id=p_employee and division_id=p_division for update;
 if exists(select 1 from public.crm_memberships where user_id=p_employee and division_id=p_division and role='owner') then raise exception 'Existing owner access cannot be changed through invitations' using errcode='42501';end if;
 insert into public.crm_memberships(user_id,division_id,role,active) values(p_employee,p_division,p_role,true)
 on conflict(user_id,division_id) do update set role=excluded.role,active=true,updated_at=now() where crm_memberships.role<>'owner';
 if not found then raise exception 'Concurrent owner assignment requires administrative review' using errcode='42501';end if;
end $$;
revoke all on function public.crm_assign_employee_access(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.crm_assign_employee_access(uuid,uuid,text,text) to service_role;
commit;
