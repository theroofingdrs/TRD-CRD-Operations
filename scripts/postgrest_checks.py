# Shared test harness source is copied into each independent workstream.
import base64, hashlib, hmac, json, re, subprocess, time

def postgrest_checks(docker, env, db_name, root, run, sql, mode):
    secret='synthetic-postgrest-secret-at-least-32-characters'
    api_name=db_name+'-rest'
    sql("create role security_test_authenticator login password 'synthetic'; grant anon,authenticated,service_role to security_test_authenticator;")
    def token(sub):
        def b64(value): return base64.urlsafe_b64encode(json.dumps(value,separators=(',',':')).encode()).decode().rstrip('=')
        content=b64({'alg':'HS256','typ':'JWT'})+'.'+b64({'role':'authenticated','sub':sub,'exp':int(time.time())+300})
        return content+'.'+base64.urlsafe_b64encode(hmac.new(secret.encode(),content.encode(),hashlib.sha256).digest()).decode().rstrip('=')
    def http(path,sub=None,method='GET',body=None,extra=None):
        headers={'Content-Type':'application/json',**(extra or {})}
        if sub: headers['Authorization']='Bearer '+token(sub)
        command=['run','--rm','--network','container:'+db_name,'curlimages/curl:8.12.1','-sS','--max-time','3','-w','\\n%{http_code}','-X',method]
        for key,value in headers.items(): command+=['--header',key+': '+value]
        if body is not None: command+=['--data',json.dumps(body)]
        result=subprocess.run(docker+command+['http://127.0.0.1:3000/'+path],env=env,capture_output=True,text=True)
        if result.returncode: raise RuntimeError(result.stderr)
        body,status=result.stdout.rsplit('\n',1)
        return int(status),body
    try:
        run(['run','--detach','--name',api_name,'--network','container:'+db_name,
            '-e','PGRST_DB_URI=postgres://security_test_authenticator:synthetic@127.0.0.1:5432/postgres',
            '-e','PGRST_DB_ANON_ROLE=anon','-e','PGRST_DB_SCHEMAS=public','-e','PGRST_JWT_SECRET='+secret,'postgrest/postgrest:v13.0.7'],stdout=subprocess.DEVNULL)
        for attempt in range(100):
            try: http(''); break
            except RuntimeError:
                if attempt==99: raise
                time.sleep(.1)
        owner='10000000-0000-0000-0000-000000000001'; customer='10000000-0000-0000-0000-000000000002'; other='10000000-0000-0000-0000-000000000003'
        table='crm_files' if mode=='files' else 'crm_document_deliveries'
        assert http(table,owner)[0]==200
        for sub in [customer,other]:
            status,body=http(table,sub); assert status==200 and json.loads(body)==[], (sub,status,body)
        assert http(table)[0] in [401,403]
        assert http(table,owner,'POST',{})[0] in [401,403]
        if table=='crm_files':
            assert http(table+'?object_path=eq.TRD/concurrent.pdf',owner,'PATCH',{'object_path':'CRD/forged'})[0] in [401,403]
            assert http('rpc/crm_register_private_file',customer,'POST',{'p_file':{'division_id':'TRD','related_type':'unsupported','related_id':'30000000-0000-0000-0000-000000000001'}})[0] in [400,401,403]
        else:
            assert http(table,owner,'PATCH',{'status':'sent','provider_message_id':'forged'})[0] in [401,403]
            assert http('crm_proposals?id=eq.40000000-0000-0000-0000-000000000002',owner,'PATCH',{'status':'sent'})[0] in [401,403]
            doc='40000000-0000-0000-0000-000000000001'
            operations={
                'crm_document_delivery_context':{'p_actor':owner,'p_type':'proposal','p_document':doc},
                'crm_claim_document_delivery':{'p_actor':owner,'p_type':'proposal','p_document':doc,'p_version':'2026-11-03T00:00:00Z','p_body':'{}','p_context':'a'*64},
                'crm_finish_document_delivery':{'p_id':doc,'p_claim':None,'p_status':'failed','p_provider':None,'p_error':'forged'},
                'crm_delivery_reconciliation':{'p_actor':owner,'p_id':doc},
            }
            for rpc,args in operations.items():
                for caller in [owner,customer,other,None]:
                    status,body=http('rpc/'+rpc,caller,'POST',args,{'x-user-id':owner,'x-user-role':'owner'})
                    assert status in [401,403], (rpc,caller,status,body)
            print('PASS: all four trusted delivery RPCs reject browser/anonymous calls and forged headers')
        # The fixture explicitly exposes public only, not the private schemas.
        assert http(table,owner,extra={'Accept-Profile':'file_private' if table=='crm_files' else 'delivery_private'})[0]==406
        print('PASS: direct PostgREST JWT, anonymous/unlinked/cross-division, mutation and schema boundaries')
    finally:
        subprocess.run(docker+['rm','-f',api_name],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
