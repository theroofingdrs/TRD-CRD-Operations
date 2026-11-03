#!/usr/bin/env python3
"""Disposable baseline + actual ordered migrations. No production connection options."""
import os, re, subprocess, time, uuid, json, sys, shutil, tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from postgrest_checks import postgrest_checks
from completion_race_checks import completion_race_checks
root = Path(__file__).resolve().parents[1]
available=[mode for mode in ('delivery','files') if (root/f'supabase/tests/security_{mode}.sql').exists()]
if len(sys.argv)==1 and len(available)>1:
    for candidate in available: subprocess.run([sys.executable,__file__,candidate],check=True)
    sys.exit(0)
mode=sys.argv[1] if len(sys.argv)>1 else available[0]
if mode not in available: raise SystemExit('No synthetic suite for requested workstream')
name = 'crm-security-' + uuid.uuid4().hex[:12]
env = {k:v for k,v in os.environ.items() if k not in ('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH')}
docker = ['docker','--host=unix:///var/run/docker.sock']
def run(args, **kw): return subprocess.run(docker+args, env=env, check=True, **kw)
def sql(source):
    r=run(['exec','-i',name,'psql','-h','127.0.0.1','-X','-U','postgres','-v','ON_ERROR_STOP=1'], input=source, text=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
def render_test(database='postgres', historical=False):
    deno=os.environ.get('SECURITY_TEST_DENO') or shutil.which('deno')
    if not deno or not shutil.which('pdftotext'): raise RuntimeError('Deno and pdftotext are required for actual-PDF security regression')
    with tempfile.TemporaryDirectory(prefix='crm-r1-render-') as directory:
        test_env={**env,'SECURITY_TEST_DB_CONTAINER':name,'SECURITY_TEST_DATABASE':database}
        if historical:
            for file in ['index.ts','delivery.ts']:
                source=subprocess.run(['git','show','1b7f8060e0afe66df35f1b281c135a392c6673fb:supabase/functions/crm-send-document/'+file],cwd=root,check=True,capture_output=True,text=True).stdout
                (Path(directory)/file).write_text(source)
            test_env['R1_RENDERER_PATH']=(Path(directory)/'index.ts').as_uri()
        command=[deno,'test','--allow-env','--allow-run=docker,pdftotext','--allow-read='+str(root)+','+directory,'--node-modules-dir=none',str(root/'supabase/tests/render_snapshot.integration.test.ts')]
        result=subprocess.run(command,env=test_env,capture_output=True,text=True)
        if historical:
            if result.returncode==0 or 'R1_ABA_RENDERED_B' not in result.stdout+result.stderr: raise AssertionError('Historical R1 regression did not fail for the reproduced PDF defect: '+result.stdout+result.stderr)
            print('PASS: actual historical renderer + RPC regression fails with R1_ABA_RENDERED_B (expected)')
        else:
            print(result.stdout)
            if result.returncode: raise RuntimeError(result.stderr)
try:
    run(['run','--detach','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data:rw,size=512m','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine'],stdout=subprocess.DEVNULL)
    for _ in range(100):
        if subprocess.run(docker+['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0: break
        time.sleep(.1)
    sql('''create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb default '{}',unique(bucket_id,name));
create table storage.buckets(id text primary key,name text,public boolean default false,file_size_limit bigint,allowed_mime_types text[]);
insert into storage.buckets(id,name,public) values('roof-doctors-private','roof-doctors-private',false);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
grant usage on schema auth,storage to authenticated,service_role;
grant select,insert,update,delete on storage.objects to authenticated;
''')
    # Reference snapshot omits function terminators and orders some FKs before
    # referenced PKs. Preserve definitions, reorder only PK/UNIQUE declarations.
    baseline=(root/'supabase/baselines/20261030_live_crm_schema_snapshot.sql').read_text()
    baseline=re.sub(r'^\$function\$$', '$function$;', baseline, flags=re.M)
    keys=re.findall(r'^ALTER TABLE .* ADD CONSTRAINT .* (?:PRIMARY KEY|UNIQUE) .*;\s*$',baseline,re.M)
    for key in keys: baseline=baseline.replace(key,'')
    first=baseline.index('ALTER TABLE public.crm_activity_events ADD CONSTRAINT')
    baseline=baseline[:first]+'\n'.join(keys)+'\n'+baseline[first:]
    sql(baseline)
    for migration in sorted((root/'supabase/migrations').glob('*.sql')):
        if migration.name.startswith('20261031004739'): continue # absent platform event-trigger implementation; not emulated
        if migration.name.startswith('20261103020000'):
            prefix=(root/'supabase/tests/security_files.sql').read_text().split('set role authenticated;')[0]
            sql("begin;"+prefix+"""
set local role authenticated;
do $$ declare fid uuid; begin
 begin
  insert into public.crm_files(division_id,related_type,related_id,bucket_id,object_path,original_filename,uploaded_by,metadata)
  values('TRD','project','50000000-0000-0000-0000-000000000001','roof-doctors-private','TRD/50000000-0000-0000-0000-000000000001/reproduce.pdf','reproduce.pdf',auth.uid(),'{"document_category":"payment_receipt"}') returning id into fid;
  raise exception 'Legacy circular registration did not fail';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
""")
            print('PASS: original payment-receipt INSERT RETURNING failure reproduced before correction')
        if migration.name.startswith(('20261103010000','20261103020000')):
            target, column = ('public.crm_proposals','updated_at') if 'server_authoritative' in migration.name else ('storage.objects','owner_id')
            sql(f'alter table {target} rename column {column} to security_test_drift;')
            try:
                sql(migration.read_text())
            except subprocess.CalledProcessError:
                pass
            else:
                raise AssertionError('Schema drift was accepted')
            namespace='delivery_private' if 'server_authoritative' in migration.name else 'file_private'
            sql(f"do $$ begin if to_regnamespace('{namespace}') is not null then raise exception 'Partial migration survived'; end if; end $$; alter table {target} rename column security_test_drift to {column};")
            print('PASS: schema drift aborts migration atomically')
        if migration.name.startswith('20261103030000'):
            sql((root/'supabase/tests/security_delivery_defect_reproductions.sql').read_text())
            print('PASS: both original defects reproduced before corrective migration (rolled back)')
        if migration.name.startswith('20261103040000'):
            run(['exec',name,'createdb','-h','127.0.0.1','-U','postgres','-T','postgres','r1_before'],stdout=subprocess.DEVNULL)
            render_test('r1_before',historical=True)
        if migration.name.startswith('20261103050000'):
            run(['exec',name,'createdb','-h','127.0.0.1','-U','postgres','-T','postgres','r2_before'],stdout=subprocess.DEVNULL)
            completion_race_checks(docker,env,name,'r2_before',expected_defect=True)
        sql(migration.read_text())
    sql((root/f'supabase/tests/security_{mode}.sql').read_text() + ((root/'supabase/tests/security_delivery_recovery.sql').read_text() if mode=='delivery' else ''))
    if mode=='delivery':
        sql((root/'supabase/tests/security_delivery_artifacts.sql').read_text())
        sql((root/'supabase/tests/security_delivery_context_epochs.sql').read_text())
        print('PASS: all six proposal context source writers, epoch authority, irrelevant edits and terminal business states')
        print('PASS: immutable snapshots, forged inputs, cross-document IDs, PDF hash/request tampering and artifact reuse SQL')
        print('PASS: NULL/stale/terminal claims, context binding, expiry, credentials and owner recovery SQL')
        sql("insert into public.crm_proposals(id,division_id,customer_id,property_id,title,updated_at) values('40000000-0000-0000-0000-000000000002','TRD','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Concurrent synthetic','2026-11-03T00:00:00Z');")
        query = "set role service_role; set request.jwt.claim.role='service_role'; select security_test.bound_claim('10000000-0000-0000-0000-000000000001','proposal','40000000-0000-0000-0000-000000000002','2026-11-03T00:00:00Z','{\"to\":[\"customer@example.test\"],\"subject\":\"Concurrent\"}',repeat('a',64));"
        def claim(_):
            result=run(['exec',name,'psql','-h','127.0.0.1','-X','-U','postgres','-v','ON_ERROR_STOP=1','-Atq','-c',query],capture_output=True,text=True)
            return json.loads(result.stdout.strip())
        with ThreadPoolExecutor(max_workers=8) as pool: results=list(pool.map(claim,range(8)))
        assert sum(r['action']=='send' for r in results)==1, results
        assert len({r['id'] for r in results})==1, results
        print('PASS: 8 competing SQL sessions, exactly one send claim')
    else:
        sql("insert into storage.objects(bucket_id,name,owner_id) values('roof-doctors-private','TRD/concurrent.pdf','10000000-0000-0000-0000-000000000001');")
        query = "set role authenticated; set request.jwt.claim.sub='10000000-0000-0000-0000-000000000001'; select public.crm_register_private_file('{\"division_id\":\"TRD\",\"related_type\":\"property\",\"related_id\":\"30000000-0000-0000-0000-000000000001\",\"bucket_id\":\"roof-doctors-private\",\"object_path\":\"TRD/concurrent.pdf\",\"original_filename\":\"concurrent.pdf\",\"uploaded_by\":\"10000000-0000-0000-0000-000000000001\"}');"
        def register(_):
            result=run(['exec',name,'psql','-h','127.0.0.1','-X','-U','postgres','-v','ON_ERROR_STOP=1','-Atq','-c',query],capture_output=True,text=True)
            return json.loads(result.stdout.strip())
        with ThreadPoolExecutor(max_workers=8) as pool: results=list(pool.map(register,range(8)))
        assert len({r['id'] for r in results})==1, results
        print('PASS: 8 competing registration sessions, one immutable file')
        file_id=results[0]['id']
        writer="set role authenticated; set request.jwt.claim.sub='10000000-0000-0000-0000-000000000001'; begin; insert into public.crm_warranties(division_id,customer_id,property_id,title,document_file_id) values('TRD','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Delete race','"+file_id+"'); select pg_sleep(0.3); commit;"
        deleter="set role authenticated; set request.jwt.claim.sub='10000000-0000-0000-0000-000000000001'; delete from storage.objects where name='TRD/concurrent.pdf';"
        def race(query): return subprocess.run(docker+['exec',name,'psql','-h','127.0.0.1','-X','-U','postgres','-v','ON_ERROR_STOP=1','-Atq','-c',query],env=env,capture_output=True,text=True)
        with ThreadPoolExecutor(max_workers=2) as pool: outcomes=list(pool.map(race,[writer,deleter]))
        assert outcomes[1].returncode==0, outcomes[1].stderr
        if outcomes[0].returncode: assert 'Referenced object is deleted or unavailable' in outcomes[0].stderr, outcomes[0].stderr
        sql("do $$ begin if exists(select 1 from public.crm_warranties where document_file_id='"+file_id+"') and not exists(select 1 from storage.objects where name='TRD/concurrent.pdf') then raise exception 'Concurrent deletion left a dangling document'; end if; end $$;")
        print('PASS: concurrent reference/deletion never commits a dangling document')

    if mode=='delivery':
        render_test()
        completion_race_checks(docker,env,name)
    postgrest_checks(docker,env,name,root,run,sql,mode)
    # Keep the pre-existing financial/price-book suites independent of the full
    # baseline fixture; each receives its own empty database.
    run(['exec',name,'mkdir','-p','/repo/supabase'],stdout=subprocess.DEVNULL)
    run(['cp',str(root/'supabase/migrations'),name+':/repo/supabase/migrations'],stdout=subprocess.DEVNULL)
    run(['cp',str(root/'supabase/tests'),name+':/repo/supabase/tests'],stdout=subprocess.DEVNULL)
    for suite in ['project_pipeline_migration_test.sql','price_book_migration_test.sql']:
        db='legacy_'+suite.split('_')[0]
        run(['exec',name,'createdb','-h','127.0.0.1','-U','postgres',db],stdout=subprocess.DEVNULL)
        run(['exec',name,'psql','-h','127.0.0.1','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-f','/repo/supabase/tests/'+suite],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        print('PASS: '+suite)
    print('PASS: baseline, ordered source migrations and authenticated security assertions')
except subprocess.CalledProcessError as error:
    print(error.stderr or str(error)); raise
finally:
    subprocess.run(docker+['rm','-f','-v',name],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
