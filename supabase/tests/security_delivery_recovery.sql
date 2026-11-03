-- Actual database decisions; no provider call or production data.
-- The snapshot has the shared trigger function but no proposal trigger. Exercise
-- hosted-style status timestamp behavior explicitly, without claiming catalog evidence.
create trigger security_test_proposal_timestamp before update on public.crm_proposals
for each row execute function app_private.set_updated_at();
update public.crm_proposals set status=status where id='40000000-0000-0000-0000-000000000001';
-- R2 invalidates derived sent state to draft on actual source edits. Revised-context
-- requests may create a NEW operation, but must never reuse old acceptance.
-- Exact review reproductions: accepted -> NULL-claim failed; changed sent content -> old accepted.
do $$ declare accepted uuid; before_row jsonb; after_row jsonb; result jsonb; v timestamptz; begin
 select id,to_jsonb(d) into accepted,before_row from public.crm_document_deliveries d
   where document_id='40000000-0000-0000-0000-000000000001';
 set local role service_role;
 begin perform public.crm_finish_document_delivery(accepted,null,'failed',null,'Review NULL-claim reproduction');
   raise exception 'NULL claim rewrote accepted outcome'; exception when serialization_failure then null; end;
 begin perform public.crm_finish_document_delivery(accepted,gen_random_uuid(),'failed',null,'Stale claim');
   raise exception 'Stale claim rewrote accepted outcome'; exception when serialization_failure then null; end;
 reset role;
 select to_jsonb(d) into after_row from public.crm_document_deliveries d where id=accepted;
 if before_row is distinct from after_row then raise exception 'Terminal outcome changed'; end if;
 -- The explicit proposal fixture invokes the real baseline trigger function.
 select updated_at into v from public.crm_proposals where id='40000000-0000-0000-0000-000000000001';
 set local role service_role;
 if v='2026-11-03T00:00:00Z'::timestamptz then raise exception 'Real status timestamp trigger did not run'; end if;
 result:=security_test.bound_claim('10000000-0000-0000-0000-000000000001','proposal','40000000-0000-0000-0000-000000000001',v,'{"to":["customer@example.test"],"subject":"Regenerated PDF bytes"}',repeat('a',64));
 if result->>'action'<>'complete' or result->>'id'<>accepted::text or result->>'status'<>'accepted' then raise exception 'Status-trigger update invalidated acceptance'; end if;
 reset role;
 update public.crm_proposals set title='Changed after provider acceptance' where id='40000000-0000-0000-0000-000000000001';
 select updated_at into v from public.crm_proposals where id='40000000-0000-0000-0000-000000000001';
 set local role service_role;
 result:= security_test.bound_claim('10000000-0000-0000-0000-000000000001','proposal','40000000-0000-0000-0000-000000000001',v,'{"to":["customer@example.test"],"subject":"Changed content"}',repeat('a',64));
 if result->>'action'<>'send' or result->>'id'=accepted::text then raise exception 'Changed content reused stale acceptance'; end if;
 perform public.crm_finish_document_delivery((result->>'id')::uuid,(result->>'claim')::uuid,'failed',null,'Synthetic explicit revised-context send rejected by provider');
 reset role;
 -- Restore content, then isolate a recipient-only change.
 update public.crm_proposals set title='Synthetic proposal' where id='40000000-0000-0000-0000-000000000001';
 update public.crm_customers set email='changed-recipient@example.test' where id='20000000-0000-0000-0000-000000000001';
 select updated_at into v from public.crm_proposals where id='40000000-0000-0000-0000-000000000001';
 set local role service_role;
 result:= security_test.bound_claim('10000000-0000-0000-0000-000000000001','proposal','40000000-0000-0000-0000-000000000001',v,'{"to":["changed-recipient@example.test"],"subject":"Recipient changed"}',repeat('a',64));
 if result->>'action'<>'send' or result->>'id'=accepted::text then raise exception 'Changed recipient reused stale acceptance'; end if;
 perform public.crm_finish_document_delivery((result->>'id')::uuid,(result->>'claim')::uuid,'failed',null,'Synthetic explicit revised-context send rejected by provider');
 reset role;
 update public.crm_customers set email='customer@example.test' where id='20000000-0000-0000-0000-000000000001';
end $$;

-- Isolated draft fixture for each recovery boundary.
do $$ declare doc uuid; op jsonb; retry jsonb; oldclaim uuid; v timestamptz; fingerprint text; n int; scenario text; begin
 foreach scenario in array array['expiry','expiry_margin','within_window','credential','context','stale','failure','reconcile','render_race','terminal'] loop
  doc:=gen_random_uuid();
  insert into public.crm_proposals(id,division_id,customer_id,property_id,title,updated_at)
    values(doc,'TRD','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',scenario,'2026-11-03T00:00:00Z');
  set local role service_role;
  if scenario='render_race' then
    fingerprint:=public.crm_document_delivery_context('10000000-0000-0000-0000-000000000001','proposal',doc);
    reset role;
    update public.crm_properties set city='Changed during render' where id='30000000-0000-0000-0000-000000000001';
    set local role service_role;
    begin perform public.crm_claim_document_delivery('10000000-0000-0000-0000-000000000001','proposal',doc,'2026-11-03T00:00:00Z',jsonb_build_object('to',jsonb_build_array('customer@example.test'),'subject','Render race','_crm_context',fingerprint)::text,repeat('a',64));
      raise exception 'Stale pre-render snapshot accepted'; exception when serialization_failure then null; end;
    reset role;
    update public.crm_properties set city='Test' where id='30000000-0000-0000-0000-000000000001';
    continue;
  end if;
  op:=security_test.bound_claim('10000000-0000-0000-0000-000000000001','proposal',doc,'2026-11-03T00:00:00Z','{"to":["customer@example.test"],"subject":"Recovery"}',repeat('a',64));
  if op->>'action'<>'send' then raise exception 'Initial send missing'; end if;
  oldclaim:=(op->>'claim')::uuid;
  if scenario='stale' then
    reset role;
    update delivery_private.operations set lease_until=clock_timestamp()-interval '1 second' where id=(op->>'id')::uuid;
    set local role service_role;
    begin perform public.crm_finish_document_delivery((op->>'id')::uuid,oldclaim,'accepted','expired-claim',null);
      raise exception 'Expired claim completed'; exception when serialization_failure then null; end;
  else
    perform public.crm_finish_document_delivery((op->>'id')::uuid,oldclaim,case when scenario in ('failure','terminal') then 'failed' else 'uncertain' end,null,'Synthetic timeout/rejection');
  end if;
  reset role;
  if scenario='within_window' then update delivery_private.operations set first_attempt_at=clock_timestamp()-interval '22 hours 59 minutes' where id=(op->>'id')::uuid;
  elsif scenario='expiry_margin' then update delivery_private.operations set first_attempt_at=clock_timestamp()-interval '23 hours 1 second' where id=(op->>'id')::uuid;
  elsif scenario='expiry' then update delivery_private.operations set first_attempt_at=clock_timestamp()-interval '24 hours' where id=(op->>'id')::uuid;
  elsif scenario='context' then update public.crm_proposals set title='Edited while uncertain' where id=doc;
  elsif scenario='terminal' then
    -- Even a corrupted/reintroduced matching claim cannot rewrite a terminal outcome.
    update delivery_private.operations set claim_id=oldclaim,lease_until=clock_timestamp()+interval '90 seconds' where id=(op->>'id')::uuid;
  end if;
  select updated_at into v from public.crm_proposals where id=doc;
  set local role service_role;
  if scenario='context' then
    begin perform security_test.bound_claim('10000000-0000-0000-0000-000000000001','proposal',doc,v,'{"to":["customer@example.test"],"subject":"Edited"}',repeat('a',64));
      raise exception 'Changed uncertain context resent'; exception when serialization_failure then null; end;
  elsif scenario='terminal' then
    begin perform public.crm_finish_document_delivery((op->>'id')::uuid,oldclaim,'accepted','forged-after-terminal',null);
      raise exception 'Terminal outcome overwritten with matching claim'; exception when serialization_failure then null; end;
  elsif scenario='reconcile' then
    begin perform public.crm_delivery_reconciliation('10000000-0000-0000-0000-000000000003',(op->>'id')::uuid);
      raise exception 'Other division owner reconciled'; exception when insufficient_privilege then null; end;
    begin perform public.crm_delivery_reconciliation('10000000-0000-0000-0000-000000000002',(op->>'id')::uuid);
      raise exception 'Unlinked actor reconciled'; exception when insufficient_privilege then null; end;
    retry:=public.crm_delivery_reconciliation('10000000-0000-0000-0000-000000000001',(op->>'id')::uuid);
    if retry->>'body'<>op->>'body' or retry->>'status'<>'uncertain' then raise exception 'Owner read changed recovery state'; end if;
    reset role;
    update public.crm_memberships set active=false where user_id='10000000-0000-0000-0000-000000000001' and division_id='TRD';
    set local role service_role;
    begin perform public.crm_delivery_reconciliation('10000000-0000-0000-0000-000000000001',(op->>'id')::uuid,'provider-recovered','sent','Synthetic evidence');
      raise exception 'Removed owner reconciled'; exception when insufficient_privilege then null; end;
    reset role;
    update public.crm_memberships set active=true where user_id='10000000-0000-0000-0000-000000000001' and division_id='TRD';
    set local role service_role;
    retry:=public.crm_delivery_reconciliation('10000000-0000-0000-0000-000000000001',(op->>'id')::uuid,'provider-recovered','sent','Synthetic provider GET evidence');
    if retry->>'status'<>'accepted' or retry->>'provider_last_event'<>'sent' then raise exception 'Acceptance/delivery distinction lost'; end if;
    retry:=public.crm_delivery_reconciliation('10000000-0000-0000-0000-000000000001',(op->>'id')::uuid,'provider-recovered','delivered','Synthetic delivery-event evidence');
    if retry->>'status'<>'accepted' or retry->>'provider_last_event'<>'delivered' then raise exception 'Recipient delivery replaced acceptance status'; end if;
    begin perform public.crm_delivery_reconciliation('10000000-0000-0000-0000-000000000001',(op->>'id')::uuid,'conflicting-provider','delivered','Synthetic evidence');
      raise exception 'Conflicting provider identity accepted'; exception when raise_exception then if sqlerrm<>'Conflicting provider identity' then raise; end if; end;
  else
    retry:=security_test.bound_claim('10000000-0000-0000-0000-000000000001','proposal',doc,v,'{"to":["customer@example.test"],"subject":"Retry bytes ignored"}',case when scenario='credential' then repeat('b',64) else repeat('a',64) end);
    if scenario in ('expiry','expiry_margin','credential') then
      if retry->>'action'<>'review' or retry->>'status'<>'uncertain' or retry ? 'body' or retry ? 'key' then raise exception 'Unsafe blind resend: %',scenario; end if;
    elsif scenario='failure' then
      if retry->>'action'<>'complete' or retry->>'status'<>'failed' then raise exception 'Definitive rejection retried'; end if;
    elsif scenario in ('stale','within_window') then
      if retry->>'action'<>'send' or retry->>'key'<>op->>'key' or retry->>'body'<>op->>'body' then raise exception 'Bound retry changed'; end if;
      begin perform public.crm_finish_document_delivery((op->>'id')::uuid,oldclaim,'failed',null,'Superseded claim');
        raise exception 'Superseded claim completed'; exception when serialization_failure then null; end;
      perform public.crm_finish_document_delivery((retry->>'id')::uuid,(retry->>'claim')::uuid,'accepted','provider-current-claim',null);
      reset role;
      select updated_at into v from public.crm_proposals where id=doc;
      if v='2026-11-03T00:00:00Z'::timestamptz then raise exception 'Delivery transition did not fire synthetic timestamp trigger'; end if;
      set local role service_role;
      retry:=security_test.bound_claim('10000000-0000-0000-0000-000000000001','proposal',doc,v,'{"to":["customer@example.test"],"subject":"Unchanged after sent trigger"}',repeat('a',64));
      if retry->>'action'<>'complete' or retry->>'status'<>'accepted' or retry->>'id'<>op->>'id' then raise exception 'Own status-trigger invalidated acceptance'; end if;
    end if;
  end if;
  reset role;
 end loop;
 if has_function_privilege('authenticated','public.crm_document_delivery_context(uuid,text,uuid)','EXECUTE')
   or has_function_privilege('anon','public.crm_document_delivery_context(uuid,text,uuid)','EXECUTE') then raise exception 'Preflight exposed to clients'; end if;
end $$;

-- Reservation independently rechecks identity after the service-only preflight.
do $$ declare fingerprint text; doc uuid:=gen_random_uuid(); actor uuid; begin
 insert into public.crm_proposals(id,division_id,customer_id,property_id,title,updated_at)
 values(doc,'TRD','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Identity snapshot','2026-11-03T00:00:00Z');
 set local role service_role;
 fingerprint:=public.crm_document_delivery_context('10000000-0000-0000-0000-000000000001','proposal',doc);
 foreach actor in array array['10000000-0000-0000-0000-000000000002'::uuid,'10000000-0000-0000-0000-000000000003'::uuid] loop
  begin perform public.crm_claim_document_delivery(actor,'proposal',doc,'2026-11-03T00:00:00Z',jsonb_build_object('to',jsonb_build_array('customer@example.test'),'subject','Forgery','_crm_context',fingerprint)::text,repeat('a',64));
   raise exception 'Claim trusted another actor preflight'; exception when insufficient_privilege then null; end;
 end loop;
 reset role;
 update public.crm_memberships set active=false where user_id='10000000-0000-0000-0000-000000000001' and division_id='TRD';
 set local role service_role;
 begin perform public.crm_claim_document_delivery('10000000-0000-0000-0000-000000000001','proposal',doc,'2026-11-03T00:00:00Z',jsonb_build_object('to',jsonb_build_array('customer@example.test'),'subject','Revoked','_crm_context',fingerprint)::text,repeat('a',64));
  raise exception 'Claim accepted removed membership'; exception when insufficient_privilege then null; end;
 reset role;
 update public.crm_memberships set active=true where user_id='10000000-0000-0000-0000-000000000001' and division_id='TRD';
end $$;

-- Relevant template/property context changes cannot reuse an accepted proposal.
do $$ declare kind text; v timestamptz; result jsonb; begin
 foreach kind in array array['property','template'] loop
  if kind='property' then update public.crm_properties set address_line1='Changed after acceptance' where id='30000000-0000-0000-0000-000000000001';
  else update public.crm_proposal_templates set introduction='Changed after acceptance' where division_id='TRD'; end if;
  select updated_at into v from public.crm_proposals where id='40000000-0000-0000-0000-000000000001';
  set local role service_role;
  result:= security_test.bound_claim('10000000-0000-0000-0000-000000000001','proposal','40000000-0000-0000-0000-000000000001',v,'{"to":["customer@example.test"],"subject":"Context edit"}',repeat('a',64));
  if result->>'action'<>'send' then raise exception 'Changed % reused acceptance',kind; end if;
  perform public.crm_finish_document_delivery((result->>'id')::uuid,(result->>'claim')::uuid,'failed',null,'Synthetic explicit revised-context send rejected by provider');
  reset role;
  if kind='property' then update public.crm_properties set address_line1='Synthetic' where id='30000000-0000-0000-0000-000000000001'; end if;
 end loop;
end $$;

-- Historical operations must never acquire a fabricated binding to today's mutable content.
do $$ declare doc uuid:=gen_random_uuid(); op jsonb; result jsonb; begin
 insert into public.crm_proposals(id,division_id,customer_id,property_id,title,updated_at)
 values(doc,'TRD','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Historical binding fixture','2026-11-03T00:00:00Z');
 set local role service_role;
 op:=security_test.bound_claim('10000000-0000-0000-0000-000000000001','proposal',doc,'2026-11-03T00:00:00Z','{"to":["customer@example.test"],"subject":"Historical"}',repeat('a',64));
 perform public.crm_finish_document_delivery((op->>'id')::uuid,(op->>'claim')::uuid,'uncertain',null,'Synthetic unknown acceptance');
 reset role;
 update delivery_private.operations set context_fingerprint=null where id=(op->>'id')::uuid;
 set local role service_role;
 begin perform security_test.bound_claim('10000000-0000-0000-0000-000000000001','proposal',doc,'2026-11-03T00:00:00Z','{"to":["customer@example.test"],"subject":"No invented binding"}',repeat('a',64));
  raise exception 'Historical operation silently rebound'; exception when serialization_failure then null; end;
 result:=public.crm_delivery_reconciliation('10000000-0000-0000-0000-000000000001',(op->>'id')::uuid);
 if result->>'body'<>op->>'body' or result->>'context_fingerprint' is not null then raise exception 'Historical recovery snapshot lost'; end if;
 reset role;
end $$;
