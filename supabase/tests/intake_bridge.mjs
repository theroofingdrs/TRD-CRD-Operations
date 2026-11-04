// Synthetic transport only; real server code and real PostgreSQL RPC are exercised.
import { execFileSync } from 'node:child_process';
const seen=new Set();
globalThis.fetch=async(url,options)=>{
 if(url!=='https://intake.example.test/rest/v1/rpc/crm_receive_website_lead')throw new Error('External traffic disabled in this integration test');
 if(options.headers.apikey!=='synthetic-service-only'||options.headers.Authorization!=='Bearer synthetic-service-only')return new Response('{}',{status:401});
 const {p_division,p_key,p_payload}=JSON.parse(options.body);
 const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
 // Use text literals for typed RPC arguments; the payload stays JSONB.
 const statement="set role service_role;set request.jwt.claim.role='service_role';select public.crm_receive_website_lead('"+p_division+"','"+p_key+"',"+literal(p_payload)+");";
 const result=execFileSync('docker',['--host=unix:///var/run/docker.sock','exec','-i',process.env.INTAKE_TEST_DB_CONTAINER,'psql','-h','127.0.0.1','-U','postgres','-Atq','-v','ON_ERROR_STOP=1'],{input:statement,encoding:'utf8'}).trim();
 if(!seen.has(p_key)){seen.add(p_key);throw new TypeError('Synthetic lost acknowledgement AFTER database commit');}
 return new Response(result,{status:200,headers:{'content-type':'application/json'}});
};
