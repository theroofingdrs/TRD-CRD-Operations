-- Preserve registered attachment identity while allowing authorized measurement review.
begin;
create function public.crm_review_roofr_measurements(p_file_id uuid, p_measurements jsonb, p_structures jsonb, p_waste_factor numeric)
returns void language plpgsql security definer set search_path='' as $$
declare f public.crm_files%rowtype;
begin
  select * into f from public.crm_files where id=p_file_id for update;
  if not found or f.related_type<>'property' or f.metadata->>'document_type' is distinct from 'roofr_measurement_report'
    or not file_private.target_allowed(f.division_id,'property',f.related_id,true)
    or not file_private.can_read(f) then
    raise exception 'Roofr review requires access to this property report' using errcode='42501';
  end if;
  if p_waste_factor is null or p_waste_factor<0 or p_waste_factor>100
    or p_waste_factor::text in ('NaN','Infinity','-Infinity')
    or jsonb_typeof(p_measurements) is distinct from 'array' or jsonb_typeof(p_structures) is distinct from 'array'
    or jsonb_array_length(p_measurements)>500 or jsonb_array_length(p_structures)>100
    or pg_column_size(p_measurements)+pg_column_size(p_structures)>262144 then
    raise exception 'Invalid measurement review' using errcode='22023';
  end if;
  update public.crm_files set metadata=metadata||jsonb_build_object(
    'extracted_measurements',p_measurements,'extracted_structures',p_structures,
    'waste_factor_percent',p_waste_factor,'extraction_status','reviewed',
    'reviewed_at',clock_timestamp(),'reviewed_by',auth.uid()) where id=f.id;
  insert into file_private.registration_audit(actor,file_id,action) values(auth.uid(),f.id,'REVIEW_ROOFR');
end $$;
revoke all on function public.crm_review_roofr_measurements(uuid,jsonb,jsonb,numeric) from public,anon,service_role;
grant execute on function public.crm_review_roofr_measurements(uuid,jsonb,jsonb,numeric) to authenticated;
commit;
