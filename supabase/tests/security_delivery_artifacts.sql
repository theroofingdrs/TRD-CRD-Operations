set request.jwt.claim.role='service_role';
-- Synthetic-only negative tests for immutable snapshot and actual artifact evidence.
do $$ declare doc uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); frame jsonb; wrong_frame jsonb; payload jsonb; op jsonb; v timestamptz; saved text; candidate jsonb; begin
 insert into public.crm_proposals(id,division_id,customer_id,property_id,title) values
 (doc,'TRD','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Artifact fixture'),
 (other,'TRD','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Other artifact fixture');
 select updated_at into v from public.crm_proposals where id=doc;
 candidate:=public.crm_document_render_inputs('proposal',doc);
 set local role service_role;
 begin perform public.crm_freeze_document_render('10000000-0000-0000-0000-000000000001','proposal',doc,jsonb_set(candidate,'{property,address_line1}','"Forged input"'));
  raise exception 'Forged snapshot persisted'; exception when serialization_failure then null; end;
 frame:=public.crm_freeze_document_render('10000000-0000-0000-0000-000000000001','proposal',doc,candidate);
 reset role;
 wrong_frame:=public.crm_freeze_document_render('10000000-0000-0000-0000-000000000001','proposal',other,public.crm_document_render_inputs('proposal',other));
 payload:=jsonb_build_object('to',jsonb_build_array('customer@example.test'),'subject','Artifact','attachments',jsonb_build_array(jsonb_build_object('filename','test.pdf','content',encode(convert_to('%PDF-artifact-A','UTF8'),'base64'))),
 '_crm_context',frame->>'context','_crm_snapshot',frame->>'id','_crm_pdf_sha256',encode(sha256(convert_to('%PDF-artifact-A','UTF8')),'hex'));
 set local role service_role;
 begin perform public.crm_claim_document_delivery('10000000-0000-0000-0000-000000000001','proposal',doc,v,jsonb_set(payload,'{_crm_pdf_sha256}',to_jsonb(repeat('0',64)))::text,repeat('a',64));
  raise exception 'False PDF hash accepted'; exception when serialization_failure then null; end;
 begin perform public.crm_claim_document_delivery('10000000-0000-0000-0000-000000000001','proposal',doc,v,jsonb_set(payload,'{_crm_snapshot}',wrong_frame->'id')::text,repeat('a',64));
  raise exception 'Cross-document snapshot accepted'; exception when serialization_failure then null; end;
 op:=public.crm_claim_document_delivery('10000000-0000-0000-0000-000000000001','proposal',doc,v,payload::text,repeat('a',64));
 reset role;
 saved:=(select request_body from delivery_private.operations where id=(op->>'id')::uuid);
 update delivery_private.operations set request_body=jsonb_set(request_body::jsonb,'{subject}','"Tampered after reservation"')::text where id=(op->>'id')::uuid;
 set local role service_role;
 begin perform public.crm_finish_document_delivery((op->>'id')::uuid,(op->>'claim')::uuid,'accepted','synthetic-artifact-provider',null);
  raise exception 'Tampered frozen request accepted'; exception when serialization_failure then null; end;
 reset role;
 update delivery_private.operations set request_body=saved where id=(op->>'id')::uuid;
 set local role service_role;
 perform public.crm_finish_document_delivery((op->>'id')::uuid,(op->>'claim')::uuid,'accepted','synthetic-artifact-provider',null);
 reset role;
 select updated_at into v from public.crm_proposals where id=doc;
 candidate:=jsonb_set(jsonb_set(payload,'{attachments,0,content}',to_jsonb(encode(convert_to('%PDF-artifact-B','UTF8'),'base64'))),'{_crm_pdf_sha256}',to_jsonb(encode(sha256(convert_to('%PDF-artifact-B','UTF8')),'hex')));
 set local role service_role;
 begin perform public.crm_claim_document_delivery('10000000-0000-0000-0000-000000000001','proposal',doc,v,candidate::text,repeat('a',64));
  raise exception 'Different actual PDF reused acceptance'; exception when serialization_failure then null; end;
 reset role;
 begin update delivery_private.render_snapshots set inputs='{}' where id=(frame->>'id')::uuid;
  raise exception 'Stored snapshot mutated'; exception when raise_exception then if sqlerrm<>'Rendering snapshots are immutable' then raise; end if; end;
 if (select d.artifact_sha256 from public.crm_document_deliveries d where id=(op->>'id')::uuid)<>payload->>'_crm_pdf_sha256' then raise exception 'Accepted artifact evidence changed'; end if;
 if has_table_privilege('authenticated','delivery_private.render_snapshots','SELECT,INSERT,UPDATE,DELETE')
  or has_table_privilege('service_role','delivery_private.render_snapshots','SELECT,INSERT,UPDATE,DELETE')
  or has_column_privilege('authenticated','public.crm_document_deliveries','artifact_sha256','UPDATE') then raise exception 'Snapshot/artifact privilege leak'; end if;
end $$;

do $$ begin
 if (select prosecdef from pg_proc where oid='public.crm_document_render_inputs(text,uuid)'::regprocedure)
  or (select proconfig from pg_proc where oid='public.crm_document_render_inputs(text,uuid)'::regprocedure) is distinct from array['search_path=""']
  or has_function_privilege('anon','public.crm_document_render_inputs(text,uuid)','EXECUTE')
  or has_function_privilege('authenticated','public.crm_freeze_document_render(uuid,text,uuid,jsonb)','EXECUTE') then raise exception 'Unsafe snapshot RPC boundary'; end if;
end $$;
