"""Deterministic R2 tests. All data and scheduling barriers are disposable."""
import json, subprocess, time
from concurrent.futures import ThreadPoolExecutor

def completion_race_checks(docker, env, name, database='postgres', expected_defect=False):
    base=docker+['exec','-i',name,'psql','-h','127.0.0.1','-X','-U','postgres','-d',database,'-Atq','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
    actor='91000000-0000-0000-0000-000000000001'; customer='92000000-0000-0000-0000-000000000001'
    def query(statement,check=True):
        result=subprocess.run(base,input=statement,text=True,env=env,capture_output=True)
        if check and result.returncode: raise AssertionError(result.stderr)
        return result.stdout.strip() if check else result
    def user(statement): return "set role authenticated;set request.jwt.claim.role='authenticated';set request.jwt.claim.sub='"+actor+"';"+statement
    def server(statement): return "set role service_role;set request.jwt.claim.role='service_role';"+statement
    def wait_for(predicate):
        for _ in range(150):
            if query('select '+predicate+';')=='t': return
            time.sleep(.025)
        raise AssertionError('Deterministic database barrier was not reached')
    def session(statement):
        process=subprocess.Popen(base,env=env,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True)
        process.stdin.write(statement+'\n');process.stdin.flush();return process
    def release(process,statement):
        if process.stdin and not process.stdin.closed:
            process.stdin.write(statement+'\n');process.stdin.flush();process.stdin.close()
        process.wait(timeout=12)
    query(f"insert into auth.users(id,email) values('{actor}','r2-owner@example.test') on conflict do nothing;insert into public.crm_divisions(id,name,business_scope) values('TRD','Synthetic','Residential') on conflict do nothing;insert into public.crm_memberships(user_id,division_id,role) values('{actor}','TRD','owner') on conflict do nothing;insert into public.crm_customers(id,customer_type,display_name,email) values('{customer}','individual','R2 synthetic','r2@example.test') on conflict do nothing;insert into public.crm_customer_divisions(customer_id,division_id) values('{customer}','TRD') on conflict do nothing;")
    for path in ['finish','reconcile']:
        for ordering in (['completion_first'] if expected_defect else ['completion_first','source_first']):
            prop=query('select gen_random_uuid();');doc=query('select gen_random_uuid();')
            query(f"insert into public.crm_properties(id,customer_id,address_line1,city,state) values('{prop}','{customer}','R2_A','Test','TX');insert into public.crm_proposals(id,division_id,customer_id,property_id,title) values('{doc}','TRD','{customer}','{prop}','R2 deterministic race');")
            inputs=json.loads(query(user(f"select public.crm_document_render_inputs('proposal','{doc}');")))
            literal=json.dumps(inputs).replace("'","''")
            frame=json.loads(query(server(f"select public.crm_freeze_document_render('{actor}','proposal','{doc}','{literal}'::jsonb);")))
            payload={'to':['r2@example.test'],'subject':'R2','attachments':[{'filename':'r2.pdf','content':'JVBERi1SMg=='}],'_crm_context':frame['context'],'_crm_snapshot':frame['id']}
            # Hash actual synthetic artifact bytes in PostgreSQL; no renderer/RPC mocks.
            payload['_crm_pdf_sha256']=query("select encode(sha256(decode('JVBERi1SMg==','base64')),'hex');")
            body=json.dumps(payload).replace("'","''")
            op=json.loads(query(server(f"select public.crm_claim_document_delivery('{actor}','proposal','{doc}','{frame['current_version']}','{body}',repeat('a',64));")))
            assert op['action']=='send'
            if path=='reconcile': query(server(f"select public.crm_finish_document_delivery('{op['id']}','{op['claim']}','uncertain',null,'Synthetic uncertain provider outcome');"))
            completion=(f"select public.crm_finish_document_delivery('{op['id']}','{op['claim']}','accepted','93000000-0000-0000-0000-000000000001',null);" if path=='finish' else f"select public.crm_delivery_reconciliation('{actor}','{op['id']}','93000000-0000-0000-0000-000000000001','sent','Synthetic provider GET evidence');")
            edit=user(f"update public.crm_properties set address_line1='R2_B' where id='{prop}';")
            if ordering=='completion_first':
                barrier=927026
                query(f"create or replace function public.r2_test_pause() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock({barrier});return new;end $$;create trigger r2_test_pause before update of status on public.crm_proposals for each row when(new.id='{doc}'::uuid and new.status='sent') execute function public.r2_test_pause();")
                holder=session(f'select pg_advisory_lock({barrier});')
                try:
                    wait_for(f"exists(select 1 from pg_locks where locktype='advisory' and objid={barrier} and granted)")
                    with ThreadPoolExecutor(max_workers=1) as pool:
                        future=pool.submit(query,server("set statement_timeout='10s';"+completion))
                        try:
                            wait_for(f"exists(select 1 from pg_locks where locktype='advisory' and objid={barrier} and not granted)")
                            edited=query(edit,check=False)
                            if expected_defect: assert edited.returncode==0,edited.stderr
                            else: assert edited.returncode!=0 and '40001' in edited.stderr,edited.stderr
                        finally: release(holder,f'select pg_advisory_unlock({barrier});')
                        future.result(timeout=12)
                    if not expected_defect:
                        assert query(f"select status from public.crm_proposals where id='{doc}';")=='sent','Valid unchanged completion failed'
                        query(edit) # retry the entire source transaction after completion.
                finally:
                    if holder.poll() is None: release(holder,f'select pg_advisory_unlock({barrier});')
                    query('drop trigger r2_test_pause on public.crm_proposals;')
            else:
                signal=927027
                writer=session('begin;'+edit+f'select pg_advisory_xact_lock({signal});')
                try:
                    wait_for(f"exists(select 1 from pg_locks where locktype='advisory' and objid={signal} and granted)")
                    with ThreadPoolExecutor(max_workers=1) as pool:
                        future=pool.submit(query,server("set statement_timeout='10s';"+completion))
                        try: wait_for("exists(select 1 from pg_locks where locktype='advisory' and classid=271026 and objid=2 and not granted)")
                        finally: release(writer,'commit;')
                        future.result(timeout=12)
                finally:
                    if writer.poll() is None: release(writer,'rollback;')
            state=json.loads(query(f"select jsonb_build_object('current',r.address_line1,'saved',s.inputs->'property'->>'address_line1','proposal',p.status,'receipt',d.status,'operations',(select count(*) from delivery_private.operations where document_id=p.id),'artifact_ok',o.artifact_sha256=encode(sha256(decode(o.request_body::jsonb->'attachments'->0->>'content','base64')),'hex'),'request_ok',o.request_sha256=encode(sha256(convert_to(o.request_body,'UTF8')),'hex')) from public.crm_proposals p join public.crm_properties r on r.id=p.property_id join public.crm_document_deliveries d on d.document_id=p.id join delivery_private.operations o on o.id=d.id join delivery_private.render_snapshots s on s.id=o.render_snapshot_id where p.id='{doc}';"))
            assert state['current']=='R2_B' and state['saved']=='R2_A' and state['receipt']=='accepted' and state['operations']==1 and state['artifact_ok'] and state['request_ok'],state
            assert state['proposal']==('sent' if expected_defect else 'draft'),state
            print(('REPRODUCED R2_STALE_CURRENT_SENT' if expected_defect else 'PASS R2 atomic epoch')+' '+path+'/'+ordering+': '+json.dumps(state),flush=True)
