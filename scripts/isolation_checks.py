"""R3: real SQL/RPC isolation cases; barriers and fixtures are disposable only."""
import json
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor


def isolation_checks(docker, env, name, database='postgres', expected_defect=False):
    base = docker + ['exec', '-i', name, 'psql', '-h', '127.0.0.1', '-X', '-U',
                     'postgres', '-d', database, '-Atq', '-v', 'ON_ERROR_STOP=1',
                     '-v', 'VERBOSITY=verbose']
    actor = 'a1000000-0000-0000-0000-000000000001'
    customer_email = 'isolation@example.test'

    def query(statement, check=True):
        result = subprocess.run(base, input=statement, text=True, env=env,
                                capture_output=True, timeout=20)
        if check and result.returncode:
            raise AssertionError(result.stderr)
        return result.stdout.strip() if check else result

    def user(statement):
        return ("set role authenticated;set request.jwt.claim.role='authenticated';"
                f"set request.jwt.claim.sub='{actor}';" + statement)

    def server(statement):
        return "set role service_role;set request.jwt.claim.role='service_role';" + statement

    def literal(value):
        return json.dumps(value).replace("'", "''")

    def session(statement):
        process = subprocess.Popen(base, env=env, stdin=subprocess.PIPE,
                                   stdout=subprocess.DEVNULL,
                                   stderr=subprocess.PIPE, text=True)
        print(statement, file=process.stdin, flush=True)
        return process

    def release(process, statement):
        print(statement, file=process.stdin, flush=True)
        process.stdin.close()
        process.wait(timeout=15)
        return process.returncode, process.stderr.read()

    def wait_for(predicate, process=None):
        for _ in range(200):
            if process is not None and process.poll() is not None:
                raise AssertionError(process.stderr.read())
            if query('select ' + predicate + ';') == 't':
                return
            time.sleep(.025)  # poll a deterministic lock barrier, not race timing
        raise AssertionError('Deterministic isolation barrier not reached')

    def ready(process, number):
        wait_for(f"exists(select 1 from pg_locks where locktype='advisory' "
                 f"and objid={number} and granted)", process)

    query(f"insert into auth.users(id,email) values('{actor}','isolation-owner@example.test') on conflict do nothing;"
          "insert into public.crm_divisions(id,name,business_scope) values('TRD','Synthetic','Residential') on conflict do nothing;"
          f"insert into public.crm_memberships(user_id,division_id,role) values('{actor}','TRD','owner') on conflict do nothing;")
    print('R3 measured default isolation: ' + query('show default_transaction_isolation;'), flush=True)

    def fixture():
        ids = {key: query('select gen_random_uuid();') for key in ['customer', 'property', 'file', 'doc']}
        c, p, f = (ids[key] for key in ['customer', 'property', 'file'])
        ids['path'] = f'TRD/{p}/roofr-isolation.pdf'
        query(f"insert into public.crm_customers(id,customer_type,display_name,email) values('{c}','individual','Isolation A','{customer_email}');"
              f"insert into public.crm_customer_divisions(customer_id,division_id) values('{c}','TRD');"
              f"insert into public.crm_properties(id,customer_id,address_line1,city,state) values('{p}','{c}','Isolation A','Test','TX');"
              f"insert into storage.objects(bucket_id,name,owner_id) values('roof-doctors-private','{ids['path']}','{actor}');"
              f"insert into public.crm_files(id,division_id,related_type,related_id,bucket_id,object_path,original_filename,uploaded_by,metadata) "
              f"values('{f}','TRD','property','{p}','roof-doctors-private','{ids['path']}','isolation.pdf','{actor}',"
              "'{\"document_type\":\"roofr_measurement_report\"}');")
        return ids

    def reserve(ids, path):
        d = ids['doc']
        query(user(f"insert into public.crm_proposals(id,division_id,customer_id,property_id,title,template_data) "
              f"values('{d}','TRD','{ids['customer']}','{ids['property']}','Isolation A',"
              f"jsonb_build_object('roofr_report_id','{ids['file']}'));"))
        inputs = json.loads(query(user(f"select public.crm_document_render_inputs('proposal','{d}');")))
        frame = json.loads(query(server(f"select public.crm_freeze_document_render('{actor}','proposal','{d}','{literal(inputs)}'::jsonb);")))
        payload = {'to': [customer_email], 'subject': 'Synthetic isolation',
                   'attachments': [{'filename': 'isolation.pdf', 'content': 'JVBERi1SMg=='}],
                   '_crm_context': frame['context'], '_crm_snapshot': frame['id'],
                   '_crm_pdf_sha256': query("select encode(sha256(decode('JVBERi1SMg==','base64')),'hex');")}
        operation = json.loads(query(server(f"select public.crm_claim_document_delivery('{actor}','proposal','{d}',"
                                            f"'{frame['current_version']}','{literal(payload)}',repeat('a',64));")))
        assert operation['action'] == 'send', operation
        if path == 'reconcile':
            query(server(f"select public.crm_finish_document_delivery('{operation['id']}','{operation['claim']}','uncertain',null,'Synthetic timeout');"))
        operation['_evidence'] = state(ids)['evidence']
        assert operation['key'] == operation['_evidence']['key'], operation
        return operation

    def completion(operation, path):
        if path == 'finish':
            return f"select public.crm_finish_document_delivery('{operation['id']}','{operation['claim']}','accepted','b1000000-0000-0000-0000-000000000001',null);"
        return f"select public.crm_delivery_reconciliation('{actor}','{operation['id']}','b1000000-0000-0000-0000-000000000001','sent','Synthetic provider GET evidence');"

    def edit(ids, source):
        statement = {
            'proposal': f"update public.crm_proposals set title='Isolation B' where id='{ids['doc']}';",
            'customer': f"update public.crm_customers set display_name='Isolation B' where id='{ids['customer']}';",
            'property': f"update public.crm_properties set address_line1='Isolation B' where id='{ids['property']}';",
            'template': f"update public.crm_proposal_templates set introduction='Isolation B {ids['doc']}' where division_id='TRD';",
            'file': f"update public.crm_files set metadata=metadata||'{{\"isolation\":\"B\"}}' where id='{ids['file']}';",
            'storage': f"update storage.objects set metadata=metadata||'{{\"version\":\"B\"}}' where name='{ids['path']}';",
        }[source]
        # Registered files/objects no longer permit browser metadata writes.
        # Trusted maintenance must still obey the delivery isolation guards.
        return ("reset role;" if source in ("file", "storage") else "") + statement

    def state(ids):
        return json.loads(query(f"select jsonb_build_object('proposal',p.status,'receipt',d.status,'epoch',e.source_epoch,'sent_epoch',e.sent_epoch,"
                                "'context_matches',delivery_private.context_fingerprint('proposal',p.id)=o.context_fingerprint,"
                                "'artifact_ok',o.artifact_sha256=encode(sha256(decode(o.request_body::jsonb->'attachments'->0->>'content','base64')),'hex'),"
                                "'request_ok',o.request_sha256=encode(sha256(convert_to(o.request_body,'UTF8')),'hex'),"
                                "'snapshot_ok',s.context_fingerprint=o.context_fingerprint,'key_ok',o.id=d.id,'evidence',jsonb_build_object('id',o.id,'request',o.request_sha256,'artifact',o.artifact_sha256,'snapshot',o.render_snapshot_id,'key','crm-document/'||o.id)) "
                                "from public.crm_proposals p join public.crm_document_deliveries d on d.document_id=p.id "
                                "join delivery_private.operations o on o.id=d.id join delivery_private.render_snapshots s on s.id=o.render_snapshot_id "
                                f"join delivery_private.proposal_context_epochs e on e.proposal_id=p.id where p.id='{ids['doc']}';"))

    if expected_defect:
        # Exact review reproduction: old source snapshot predates proposal creation.
        ids = fixture()
        writer = session('begin isolation level repeatable read;' + user('select txid_current_snapshot();select pg_advisory_xact_lock(937001);'))
        try:
            ready(writer, 937001)
            op = reserve(ids, 'finish')
            query(server(completion(op, 'finish')))
            code, error = release(writer, edit(ids, 'property') + 'commit;')
            assert code == 0, error
            result = state(ids)
            assert result['evidence'] == op['_evidence'], result
            assert result['proposal'] == 'sent' and not result['context_matches'] and result['epoch'] == result['sent_epoch'], result
            assert all(result[key] for key in ['artifact_ok', 'request_ok', 'snapshot_ok', 'key_ok']), result
            print('REPRODUCED R3_STALE_SOURCE_SNAPSHOT: current context differs; sent/unchanged epoch; accepted artifact intact', flush=True)
        finally:
            if writer.poll() is None:
                release(writer, 'rollback;')
        return

    # An RC UPDATE statement has ALREADY started before proposal creation.
    # Pause its first BEFORE STATEMENT trigger, ahead of R3/R2 guards. The
    # volatile AFTER trigger must use fresh SPI visibility after serialization.
    for path in ['finish', 'reconcile']:
        ids = fixture()
        query("create or replace function security_test.r3_statement_pause() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(937005);return null;end $$;"
              "create trigger \"000_r3_statement_pause\" before update on public.crm_properties for each statement execute function security_test.r3_statement_pause();")
        holder = session('select pg_advisory_lock(937005);')
        try:
            ready(holder, 937005)
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(query, user('begin isolation level read committed;' + edit(ids, 'property') + 'commit;'))
                try:
                    wait_for("exists(select 1 from pg_locks where locktype='advisory' and objid=937005 and not granted)")
                    op = reserve(ids, path)
                    query(server(completion(op, path)))
                    assert state(ids)['proposal'] == 'sent'
                finally:
                    release(holder, 'select pg_advisory_unlock(937005);')
                future.result(timeout=15)
            result = state(ids)
            assert result['proposal'] == 'draft' and not result['context_matches'], result
            assert result['receipt'] == 'accepted' and result['evidence'] == op['_evidence'], result
            assert all(result[key] for key in ['artifact_ok', 'request_ok', 'snapshot_ok', 'key_ok']), result
            print(f'PASS R3 RC statement snapshot before new proposal / {path}: committed edit invalidates sent; immutable history retained', flush=True)
        finally:
            if holder.poll() is None:
                release(holder, 'select pg_advisory_unlock(937005);')
            query('drop trigger "000_r3_statement_pause" on public.crm_properties;')

    levels = ['read committed', 'repeatable read', 'serializable']
    for path in ['finish', 'reconcile']:
        for ordering in ['completion_first', 'source_first']:
            for level in levels:
                for source in ['proposal', 'customer', 'property', 'template', 'file', 'storage']:
                    ids = fixture()
                    if ordering == 'source_first':
                        op = reserve(ids, path)
                    writer = session('begin isolation level ' + level + ';' + user('select txid_current_snapshot();select pg_advisory_xact_lock(937001);'))
                    try:
                        ready(writer, 937001)
                        if ordering == 'completion_first':
                            op = reserve(ids, path)
                            query(server(completion(op, path)))
                            code, error = release(writer, edit(ids, source) + 'commit;')
                            if level != 'read committed':
                                assert code != 0 and '25001' in error, error
                                unchanged = state(ids)
                                assert unchanged['proposal'] == 'sent' and unchanged['context_matches'], unchanged
                                # New backend/transaction at RC: retry DB edit, not provider/import.
                                query(user('begin isolation level read committed;' + edit(ids, source) + 'commit;'))
                            else:
                                assert code == 0, error
                        else:
                            if level != 'read committed':
                                code, error = release(writer, edit(ids, source) + 'commit;')
                                assert code != 0 and '25001' in error, error
                                writer = session('begin isolation level read committed;' + user(edit(ids, source) + 'select pg_advisory_xact_lock(937002);'))
                            else:
                                print(edit(ids, source) + 'select pg_advisory_xact_lock(937002);', file=writer.stdin, flush=True)
                            ready(writer, 937002)
                            with ThreadPoolExecutor(max_workers=1) as pool:
                                future = pool.submit(query, server("set statement_timeout='12s';" + completion(op, path)))
                                try:
                                    wait_for("exists(select 1 from pg_locks where locktype='advisory' and classid=271026 and objid=2 and not granted)")
                                finally:
                                    code, error = release(writer, 'commit;')
                                    assert code == 0, error
                                future.result(timeout=15)
                        result = state(ids)
                        assert result['evidence'] == op['_evidence'], result
                        assert result['proposal'] == 'draft' and result['receipt'] == 'accepted' and not result['context_matches'] and result['sent_epoch'] is None, result
                        assert all(result[key] for key in ['artifact_ok', 'request_ok', 'snapshot_ok', 'key_ok']), result
                    finally:
                        if writer.poll() is None:
                            release(writer, 'rollback;')
                print(f'PASS R3 six sources / {path}/{ordering}/{level}: fresh transaction, draft current, accepted history intact', flush=True)

    # Each completion enters with an already-established older snapshot.
    for path in ['finish', 'reconcile']:
        for level in levels:
            ids = fixture()
            op = reserve(ids, path)
            finisher = session('begin isolation level ' + level + ';' + server('select txid_current_snapshot();select pg_advisory_xact_lock(937003);'))
            try:
                ready(finisher, 937003)
                query(user(edit(ids, 'property')))
                code, error = release(finisher, completion(op, path) + 'commit;')
                if level != 'read committed':
                    assert code != 0 and '25001' in error, error
                    query(server('begin isolation level read committed;' + completion(op, path) + 'commit;'))
                else:
                    assert code == 0, error
                result = state(ids)
                assert result['evidence'] == op['_evidence'], result
                assert result['proposal'] == 'draft' and result['receipt'] == 'accepted' and not result['context_matches'], result
                assert all(result[key] for key in ['artifact_ok', 'request_ok', 'snapshot_ok', 'key_ok']), result
            finally:
                if finisher.poll() is None:
                    release(finisher, 'rollback;')
    print('PASS R3 both completion RPCs with old snapshots at RC/RR/SERIALIZABLE; rejected transactions retried fresh without new send claims', flush=True)

    # Guard every operation, even zero-row statements: no INSERT/status-only gap.
    tables = ['public.crm_proposals', 'public.crm_customers', 'public.crm_properties',
              'public.crm_proposal_templates', 'public.crm_files', 'storage.objects']
    for level in levels[1:]:
        for table in tables:
            column = 'division_id' if table.endswith('crm_proposal_templates') else 'id'
            for statement in [f'insert into {table} select * from {table} where false;',
                              f'update {table} set {column}={column} where false;',
                              f'delete from {table} where false;']:
                result = query('begin isolation level ' + level + ';' + statement, check=False)
                assert result.returncode != 0 and '25001' in result.stderr, result.stderr
    print('PASS R3 36 privileged unsupported-isolation INSERT/UPDATE/DELETE guards across all six tables', flush=True)

    # A failed source transaction must roll back prior statements too.
    query("create table security_test.r3_rollback_marker(id uuid primary key);grant usage on schema security_test to authenticated;grant insert on security_test.r3_rollback_marker to authenticated;")
    ids = fixture()
    for level in levels[1:]:
        marker = query('select gen_random_uuid();')
        result = query('begin isolation level ' + level + ';' + user(f"insert into security_test.r3_rollback_marker values('{marker}');" + edit(ids, 'property')), check=False)
        assert result.returncode != 0 and '25001' in result.stderr, result.stderr
        assert query(f"select count(*) from security_test.r3_rollback_marker where id='{marker}';") == '0'
    holder = session('begin;select pg_advisory_xact_lock(271026,2);select pg_advisory_xact_lock(937004);')
    marker = query('select gen_random_uuid();')
    try:
        ready(holder, 937004)
        result = query('begin isolation level read committed;' + user(f"insert into security_test.r3_rollback_marker values('{marker}');" + edit(ids, 'property')), check=False)
        assert result.returncode != 0 and '40001' in result.stderr, result.stderr
        assert query(f"select count(*) from security_test.r3_rollback_marker where id='{marker}';") == '0'
    finally:
        if holder.poll() is None:
            release(holder, 'rollback;')
    query(user('begin isolation level read committed;' + f"insert into security_test.r3_rollback_marker values('{marker}');" + edit(ids, 'property') + 'commit;'))
    assert query(f"select count(*) from security_test.r3_rollback_marker where id='{marker}';") == '1'
    print('PASS R3 25001/40001 roll back earlier statements; fresh complete-transaction retry commits once', flush=True)

    for level in levels[1:]:
        for rpc in [f"select public.crm_freeze_document_render('{actor}','proposal','{ids['doc']}','{{}}');",
                    f"select public.crm_claim_document_delivery('{actor}','proposal','{ids['doc']}',now(),'{{}}',repeat('a',64));",
                    "select public.crm_finish_document_delivery(gen_random_uuid(),null,'accepted','synthetic',null);",
                    f"select public.crm_delivery_reconciliation('{actor}',gen_random_uuid());"]:
            result = query('begin isolation level ' + level + ';' + server(rpc), check=False)
            assert result.returncode != 0 and '25001' in result.stderr, result.stderr
    print('PASS R3 all four trusted RPCs reject unsupported isolation before context inspection', flush=True)
