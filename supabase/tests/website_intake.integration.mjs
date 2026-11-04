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
 cases.push(['CRD','/api/leads',{name:'HTTP photo',phone:'9035550155',photos:[{name:'synthetic.jpg',dataUrl:'data:image/jpeg;base64,'+Buffer.concat([Buffer.from([255,216,255]),Buffer.alloc(300000)]).toString('base64')}]}]);
 for(let i=0;i<cases.length;i++){
  const [division,route,payload]=cases[i],key=`b0000000-0000-4000-8000-00000000000${i+1}`;
  const send=()=>fetch(`http://127.0.0.1:${ports[division]}${route}`,{method:'POST',headers:{'content-type':'application/json','Idempotency-Key':key},body:JSON.stringify(payload)});
  const a=await send(),result=await a.json();assert.equal(a.ok,true,JSON.stringify(result));
  const b=await send(),replayed=await b.json();assert.equal(b.ok,true,JSON.stringify(replayed));
  const source=result.id||result.leadId;assert.equal(replayed.id||replayed.leadId,source);
  const sql=`select jsonb_build_object('count',count(*),'division',min(division_id),'attachments',(select count(*) from intake_private.attachments where lead_id in(select id from public.crm_leads where source_record_id='${source}')),'followups',(select count(*) from public.crm_tasks where related_id in(select id from public.crm_leads where source_record_id='${source}'))) from public.crm_leads where source_record_id='${source}';`;
  const saved=JSON.parse(execFileSync('docker',['--host=unix:///var/run/docker.sock','exec','-i',process.env.INTAKE_TEST_DB_CONTAINER,'psql','-h','127.0.0.1','-U','postgres','-Atq'],{input:sql,encoding:'utf8'}));
  assert.deepEqual(saved,{count:1,division,followups:1,attachments:payload.photos?.length||0});
  console.log('PASS actual website HTTP -> real CRM SQL:',division,route,'lost response + replay -> one lead/one follow-up');
 }
}finally{
 await Promise.all(children.map(child=>new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');})));
 await rm(directory,{recursive:true,force:true});
}
// Booking also traverses the actual SQL store; the provider remains synthetic.
const {BookingEngine,createApprovedBookingDraft,createRpcBookingStore}=await import(path.join(process.env.WEBSITE_SOURCE_DIR,'booking/engine.ts'));
const {SERVICES,MODES}=await import(path.join(process.env.WEBSITE_SOURCE_DIR,'booking/readiness.ts'));
const query=statement=>execFileSync('docker',['--host=unix:///var/run/docker.sock','exec','-i',process.env.INTAKE_TEST_DB_CONTAINER,'psql','-h','127.0.0.1','-U','postgres','-Atq','-v','ON_ERROR_STOP=1'],{input:statement,encoding:'utf8'}).trim();
const rpc=async(name,args)=>{
 const json=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
 const response=query("set role service_role;set request.jwt.claim.role='service_role';select public.crm_booking_operation('"+args.p_action+"',"+json(args.p_request)+");");
 return{data:JSON.parse(response),error:null};
};
const config=createApprovedBookingDraft();config.enabled=true;config.confirmation={approved:true,after:'durable-reservation',channel:'email'};
for(const [division,d]of Object.entries(config.divisions)){d.calendar={division,id:'synthetic-'+division};d.publicUrl='https://'+division.toLowerCase()+'.example.test/book';d.buffers={beforeMinutes:0,afterMinutes:0};for(const service of SERVICES)for(const mode of MODES)d.durationsMinutes[service][mode]=30;}
const lead=query("select id from public.crm_leads where source_record_id='website-TRD-a0000000-0000-4000-8000-000000000001';");let creates=0;
const provider={busy:async()=>false,create:async()=>{creates++;return'synthetic-booking-provider';},move:async()=>{},cancel:async()=>{}};
const engine=new BookingEngine({enabled:true,providerVerified:true,booking:config,operators:{TRD:'10000000-0000-0000-0000-000000000001',CRD:'10000000-0000-0000-0000-000000000003'},minNoticeMinutes:0,maxAdvanceDays:60},createRpcBookingStore(rpc),provider,()=>Date.parse('2027-01-01T00:00:00Z'));
const request={key:'f0000000-0000-4000-8000-000000000001',division:'TRD',lead,service:SERVICES[0],mode:MODES[0],start:'2027-01-08T15:00:00Z'};
assert.equal((await engine.book(request)).status,'confirmed');assert.equal((await engine.book({...request})).status,'confirmed');assert.equal(creates,1);
assert.equal(query("select count(*) from public.crm_appointments where internal_notes='Website booking: "+request.key+"';"),'1');
await engine.reschedule(request.key,'2027-01-09T15:00:00Z');
assert(query("select starts_at from public.crm_appointments where internal_notes='Website booking: "+request.key+"';").startsWith('2027-01-09 15:00:00'));
await engine.cancel(request.key);
assert.equal(query("select status from public.crm_appointments where internal_notes='Website booking: "+request.key+"';"),'cancelled');
console.log('PASS actual booking engine -> real SQL store: replay, linked CRM appointment, reschedule and cancellation; synthetic provider only');
