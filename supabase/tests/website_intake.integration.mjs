import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
const directory=await mkdtemp(path.join(os.tmpdir(),'website-intake-'));
const children=[];
const env={...process.env,NODE_ENV:'production',WEBSITE_DATA_DIR:directory,SUPABASE_URL:'https://intake.example.test',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-only',NODE_OPTIONS:'--import='+fileURLToPath(new URL('./intake_bridge.mjs',import.meta.url))};
for(const key of Object.keys(env))if(/RESEND|SENDGRID|SMTP|GOOGLE|BOOKING/.test(key))delete env[key];
const ports={TRD:18201,CRD:18202};
try{
 for(const [division,app] of [['TRD','trd'],['CRD','crd']]){
  children.push(spawn(process.execPath,['dist/server.cjs'],{cwd:path.join(process.env.WEBSITE_SOURCE_DIR,'source-apps',app),env:{...env,PORT:String(ports[division])},stdio:['ignore','ignore','inherit']}));
  for(let i=0;i<80;i++){try{if((await fetch(`http://127.0.0.1:${ports[division]}/api/health`)).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 }
 const cases=[['TRD','/api/v1/leads',{name:'HTTP Residential',email:'http-trd@example.test',phone:'9035550111',address:'HTTP Fixture',city:'Test',state:'TX',zip:'00000',serviceRequested:'Inspection',utmCampaign:'test-campaign'}],['CRD','/api/leads',{firstName:'HTTP',lastName:'Commercial',companyName:'HTTP Facility',phone:'9035550122',email:'http-crd@example.test',propertyAddress:'HTTP Facility',city:'Test',state:'AR',zip:'00000'}],['CRD','/api/emergency',{name:'HTTP Emergency',phone:'9035550133'}],['CRD','/api/calculator',{contactName:'HTTP Calculator',phone:'9035550144',email:'http-calc@example.test',address:'HTTP Site',squareFootage:12000,desiredWork:'Replacement',submitLead:true}]];
 for(let i=0;i<cases.length;i++){
  const [division,route,payload]=cases[i],key=`b0000000-0000-4000-8000-00000000000${i+1}`;
  const send=()=>fetch(`http://127.0.0.1:${ports[division]}${route}`,{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':key},body:JSON.stringify(payload)});
  const a=await send(),result=await a.json();assert.equal(a.ok,true,JSON.stringify(result));
  const b=await send(),replayed=await b.json();assert.equal(b.ok,true,JSON.stringify(replayed));
  const source=result.id||result.leadId;assert.equal(replayed.id||replayed.leadId,source);
  const sql=`select jsonb_build_object('count',count(*),'division',min(division_id),'followups',(select count(*) from public.crm_tasks where related_id in(select id from public.crm_leads where source_record_id='${source}'))) from public.crm_leads where source_record_id='${source}';`;
  const saved=JSON.parse(execFileSync('docker',['--host=unix:///var/run/docker.sock','exec','-i',process.env.INTAKE_TEST_DB_CONTAINER,'psql','-h','127.0.0.1','-U','postgres','-Atq'],{input:sql,encoding:'utf8'}));
  assert.deepEqual(saved,{count:1,division,followups:1});
  console.log('PASS actual website HTTP -> real CRM SQL:',division,route,'lost response + replay -> one lead/one follow-up');
 }
}finally{
 await Promise.all(children.map(child=>new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');})));
 await rm(directory,{recursive:true,force:true});
}
