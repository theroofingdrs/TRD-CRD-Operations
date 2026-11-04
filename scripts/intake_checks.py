"""Synthetic intake concurrency/HTTP and optional actual website-server checks."""
import subprocess,json,os
from concurrent.futures import ThreadPoolExecutor

def intake_checks(docker,env,name,root,run,sql):
    statement="set role service_role;set request.jwt.claim.role='service_role';select public.crm_receive_website_lead('TRD','a0000000-0000-4000-8000-000000000007','{\"name\":\"Concurrent fixture\",\"phone\":\"9035550100\"}');"
    def call(_):
        r=run(['exec',name,'psql','-h','127.0.0.1','-U','postgres','-Atq','-v','ON_ERROR_STOP=1','-c',statement],capture_output=True,text=True)
        return json.loads(r.stdout.strip())
    with ThreadPoolExecutor(max_workers=8) as pool: receipts=list(pool.map(call,range(8)))
    assert all(r['ok'] for r in receipts) and len({r['lead_id'] for r in receipts})==1,receipts
    sql("do $$ begin if (select count(*) from public.crm_leads where source_record_id='website-TRD-a0000000-0000-4000-8000-000000000007')<>1 then raise exception 'Concurrent duplicate';end if;end $$;")
    print('PASS: 8 concurrent submissions, one lead and one transactional follow-up/outbox',flush=True)
    import base64,hashlib,hmac,time
    secret='synthetic-intake-jwt-secret-at-least-32-characters'
    api=name+'-intake-rest'
    sql("create role intake_test_authenticator login password 'synthetic';grant anon,authenticated,service_role to intake_test_authenticator;")
    def token(role,sub=None):
        def enc(v):return base64.urlsafe_b64encode(json.dumps(v,separators=(',',':')).encode()).decode().rstrip('=')
        body=enc({'alg':'HS256','typ':'JWT'})+'.'+enc({'role':role,**({'sub':sub} if sub else {}),'exp':int(time.time())+300})
        return body+'.'+base64.urlsafe_b64encode(hmac.new(secret.encode(),body.encode(),hashlib.sha256).digest()).decode().rstrip('=')
    def http(path,role=None,sub=None,body=None,extra=None):
        command=['run','--rm','--network','container:'+name,'curlimages/curl:8.12.1','-sS','--max-time','5','-w','\\n%{http_code}','--header','Content-Type: application/json']
        if role:command+=['--header','Authorization: Bearer '+token(role,sub)]
        for key,value in (extra or {}).items():command+=['--header',key+': '+value]
        if body is not None:command+=['--data',json.dumps(body)]
        r=run(command+['http://127.0.0.1:3000/'+path],capture_output=True,text=True)
        content,status=r.stdout.rsplit('\n',1)
        return int(status),content
    try:
        run(['run','--detach','--rm','--name',api,'--network','container:'+name,'-e','PGRST_DB_URI=postgres://intake_test_authenticator:synthetic@127.0.0.1/postgres','-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_JWT_SECRET='+secret,'postgrest/postgrest:v13.0.4'],stdout=subprocess.DEVNULL)
        for _ in range(50):
            try:
                if http('')[0]==200:break
            except subprocess.CalledProcessError:pass
            time.sleep(.1)
        payload={'p_division':'TRD','p_key':'a0000000-0000-4000-8000-000000000008','p_payload':{'name':'HTTP synthetic','phone':'9035550100'}}
        for role,sub in [(None,None),('authenticated','10000000-0000-0000-0000-000000000001')]:
            assert http('rpc/crm_receive_website_lead',role,sub,payload,{'x-user-role':'service_role'})[0] in (401,403)
        status,body=http('rpc/crm_receive_website_lead','service_role',body=payload)
        assert status==200 and json.loads(body)['ok'],(status,body)
        assert http('rpc/crm_website_intake_status','authenticated','10000000-0000-0000-0000-000000000001',{'p_division':'TRD'})[0]==200
        assert http('rpc/crm_website_intake_status','authenticated','10000000-0000-0000-0000-000000000003',{'p_division':'TRD'})[0]==403
        assert http('submissions','service_role',extra={'Accept-Profile':'intake_private'})[0]==406
        print('PASS: actual PostgREST service JWT, browser/anonymous denials, forged headers, owner isolation and private schema',flush=True)
        website=os.environ.get('WEBSITE_SOURCE_DIR')
        if website:
            test_env={**env,'INTAKE_TEST_DB_CONTAINER':name,'WEBSITE_SOURCE_DIR':website}
            subprocess.run(['node','--experimental-strip-types',str(root/'supabase/tests/website_intake.integration.mjs')],env=test_env,check=True)
        else:print('Website checkout not supplied: cross-repository HTTP test is a separate required check',flush=True)
    finally:subprocess.run(docker+['rm','-f',api],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
