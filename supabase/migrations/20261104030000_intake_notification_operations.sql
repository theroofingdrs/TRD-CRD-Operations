begin;
create function public.crm_intake_notification_work() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted worker required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(to_jsonb(j)) from (select n.id,n.recipient_kind,n.status,s.division_id,s.submission_key,s.received_at,s.payload from intake_private.notifications n join intake_private.submissions s using(division_id,submission_key) where s.status='delivered' and n.status in ('pending','failed','sending') order by n.created_at limit 20) j),'[]');
end $$;
create function public.crm_claim_intake_notification(p_id uuid,p_body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r intake_private.notifications%rowtype; claim uuid:=gen_random_uuid(); frozen text:=p_body::text;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted worker required' using errcode='42501';end if;
 select * into strict r from intake_private.notifications where id=p_id for update;
 if r.status='sent' then return jsonb_build_object('action','complete');end if;
 if r.status='sending' and r.started_at>now()-interval '1 minute' then return jsonb_build_object('action','busy');end if;
 if r.status in ('sending','uncertain') or r.started_at<now()-interval '23 hours' then
  update intake_private.notifications set status='uncertain' where id=p_id;
  return jsonb_build_object('action','manual_review');
 end if;
 if jsonb_typeof(p_body) is distinct from 'object' or octet_length(frozen)>262144 then raise exception 'Invalid notification' using errcode='22023';end if;
 if r.body is not null and r.body<>frozen then raise exception 'Frozen notification changed' using errcode='22023';end if;
 update intake_private.notifications set body=coalesce(body,frozen),body_hash=encode(sha256(convert_to(frozen,'UTF8')),'hex'),claim_token=claim,started_at=coalesce(started_at,clock_timestamp()),status='sending' where id=p_id;
 return jsonb_build_object('action','send','id',p_id,'key','intake-'||p_id,'body',frozen,'claim',claim);
end $$;
create function public.crm_finish_intake_notification(p_id uuid,p_claim uuid,p_status text,p_provider text,p_error text) returns void language plpgsql security definer set search_path='' as $$
declare r intake_private.notifications%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Trusted worker required' using errcode='42501';end if;
 select * into strict r from intake_private.notifications where id=p_id for update;
 if p_claim is null or r.claim_token is distinct from p_claim or r.status<>'sending' or p_status not in ('sent','failed','uncertain') or (p_status='sent' and nullif(p_provider,'') is null) then raise exception 'Invalid notification finalizer' using errcode='42501';end if;
 update intake_private.notifications set status=p_status,provider_id=p_provider,last_error=left(p_error,500) where id=p_id;
 insert into intake_private.attempts(division_id,submission_key,outcome,error_message) values(r.division_id,r.submission_key,'notification:'||r.recipient_kind||':'||p_status,left(p_error,500));
end $$;
revoke all on function public.crm_intake_notification_work(),public.crm_claim_intake_notification(uuid,jsonb),public.crm_finish_intake_notification(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.crm_intake_notification_work(),public.crm_claim_intake_notification(uuid,jsonb),public.crm_finish_intake_notification(uuid,uuid,text,text,text) to service_role;
commit;
