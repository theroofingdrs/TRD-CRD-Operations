alter table public.crm_properties
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

create or replace function public.crm_owner_completed_projects_map()
returns table (
  project_id uuid, property_id uuid, division_id text, project_name text,
  project_type text, status text, completion_date date, customer_name text,
  property_name text, address_line1 text, city text, state text,
  postal_code text, latitude double precision, longitude double precision
)
language plpgsql security definer
set search_path = ''
as $$
begin
  if not app_private.is_crm_owner() then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
  return query
  select p.id, pr.id, p.division_id, p.project_name, p.project_type, p.status,
         p.actual_completion_date, c.display_name, pr.property_name,
         pr.address_line1, pr.city, pr.state, pr.postal_code, pr.latitude, pr.longitude
  from public.crm_projects p
  left join public.crm_customers c on c.id = p.customer_id
  left join public.crm_properties pr on pr.id = p.property_id
  where lower(p.status) = 'completed' and pr.address_line1 is not null
  order by p.actual_completion_date desc nulls last, p.created_at desc;
end;
$$;

create or replace function public.crm_owner_save_property_coordinates(
  p_property_id uuid, p_latitude double precision, p_longitude double precision
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not app_private.is_crm_owner() then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'Invalid coordinates';
  end if;
  update public.crm_properties
  set latitude = p_latitude, longitude = p_longitude, updated_at = now()
  where id = p_property_id;
end;
$$;

revoke all on function public.crm_owner_completed_projects_map() from public, anon;
revoke all on function public.crm_owner_save_property_coordinates(uuid,double precision,double precision) from public, anon;
grant execute on function public.crm_owner_completed_projects_map() to authenticated;
grant execute on function public.crm_owner_save_property_coordinates(uuid,double precision,double precision) to authenticated;
