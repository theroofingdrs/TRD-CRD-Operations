// Actual renderer + actual PostgreSQL RPCs; only Auth/provider/Storage HTTP are
// synthetic. No network permission. Docker is pinned to the local Unix socket.
let handler: (request: Request) => Promise<Response>;
const originalServe = Deno.serve;
Object.defineProperty(Deno, 'serve', { value: (callback: typeof handler) => { handler = callback; } });
for (const [key,value] of Object.entries({SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'synthetic-public',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',RESEND_API_KEY:'synthetic-provider',RESEND_FROM_EMAIL:'office@example.test'})) Deno.env.set(key,value);
await import(Deno.env.get('R1_RENDERER_PATH') || new URL('../functions/crm-send-document/index.ts',import.meta.url).href);
Object.defineProperty(Deno, 'serve', { value: originalServe });
const container=Deno.env.get('SECURITY_TEST_DB_CONTAINER')!;
const database=Deno.env.get('SECURITY_TEST_DATABASE') || 'postgres';
const actor='81000000-0000-0000-0000-000000000001';
const customer='82000000-0000-0000-0000-000000000001';
const property='83000000-0000-0000-0000-000000000001';
const baseline=!!Deno.env.get('R1_RENDERER_PATH');
const literal=(x:unknown)=>x===null?'null':"'"+String(typeof x==='object'?JSON.stringify(x):x).replaceAll("'","''")+"'";
function assert(value:unknown,message:string): asserts value { if(!value)throw Error(message); }
async function sql(source:string,role='postgres') {
 const proc=new Deno.Command('docker',{args:['--host=unix:///var/run/docker.sock','exec','-i',container,'psql','-h','127.0.0.1','-X','-U','postgres','-d',database,'-Atq','-v','ON_ERROR_STOP=1'],stdin:'piped',stdout:'piped',stderr:'piped'}).spawn();
 const writer=proc.stdin.getWriter();await writer.write(new TextEncoder().encode(`set request.jwt.claim.role=${literal(role)};set request.jwt.claim.sub=${literal(actor)};set role ${role};`+source));await writer.close();
 const result=await proc.output();if(result.code)throw Error(new TextDecoder().decode(result.stderr));return new TextDecoder().decode(result.stdout).trim();
}
async function setup() {
 await sql(`insert into auth.users(id,email) values('${actor}','r1-owner@example.test') on conflict do nothing;
 insert into public.crm_divisions(id,name,business_scope) values('TRD','Synthetic','Residential') on conflict do nothing;
 insert into public.crm_memberships(user_id,division_id,role) values('${actor}','TRD','owner') on conflict do nothing;
 insert into public.crm_customers(id,customer_type,display_name,email) values('${customer}','individual','R1 Synthetic','r1@example.test') on conflict do nothing;
 insert into public.crm_customer_divisions(customer_id,division_id) values('${customer}','TRD') on conflict do nothing;
 insert into public.crm_properties(id,customer_id,address_line1,city,state) values('${property}','${customer}','SNAPSHOT ADDRESS A','Test','TX') on conflict do nothing;
 update public.crm_properties set address_line1='SNAPSHOT ADDRESS A' where id='${property}';`);
}
async function pdfText(body:any) {
 const bytes=Uint8Array.from(atob(body.attachments[0].content),c=>c.charCodeAt(0));
 const proc=new Deno.Command('pdftotext',{args:['-','-'],stdin:'piped',stdout:'piped',stderr:'piped'}).spawn();
 const writer=proc.stdin.getWriter();await writer.write(bytes);await writer.close();const out=await proc.output();
 assert(out.code===0,'Actual PDF extraction failed');return new TextDecoder().decode(out.stdout);
}
async function scenario(kind:'aba'|'uncertain'|'changed'|'after_reservation') {
 await setup();const doc=await sql('select gen_random_uuid();');
 await sql(`insert into public.crm_proposals(id,division_id,customer_id,property_id,title) values('${doc}','TRD','${customer}','${property}','R1 actual-renderer test');`);
 let phase=0,posts=0,logos=0,text='',sourceMutated=false;const bodies:string[]=[],keys:string[]=[];const previous=globalThis.fetch;
 globalThis.fetch=async(input:string|URL|Request,options?:RequestInit)=>{
  const url=String(input);
  if(url.includes('/auth/v1/user'))return Response.json({id:actor});
  if(url.includes('/rest/v1/rpc/')) {
   const fn=url.split('/rpc/')[1];const args=JSON.parse(String(options?.body));
   if(fn==='crm_claim_document_delivery'&&phase===0&&kind==='aba')await sql(`update public.crm_properties set address_line1='SNAPSHOT ADDRESS A' where id='${property}';`,'authenticated');
   const expression=`public.${fn}(${Object.entries(args).map(([k,v])=>k+'=>'+literal(v)).join(',')})`;
   try {
    if(fn==='crm_finish_document_delivery'){await sql('select '+expression+';','service_role');return new Response(null,{status:204});}
    const value=JSON.parse(await sql('select to_jsonb('+expression+')::text;',fn==='crm_document_render_inputs'?'authenticated':'service_role'));
    // Mutate AFTER A is frozen, before rendering. The old renderer separately
    // reads B; the corrected renderer must use the saved A inputs exclusively.
    if(['crm_freeze_document_render','crm_document_delivery_context'].includes(fn)&&phase===0&&(kind==='aba'||kind==='changed')){
     await sql(`update public.crm_properties set address_line1='INTERMEDIATE ADDRESS B' where id='${property}';`,'authenticated');sourceMutated=true;
    }
    return Response.json(value);
   } catch(error) {return Response.json({message:String(error),code:'40001'},{status:409});}
  }
  // Only the historical renderer may reach these independent database reads.
  if(baseline&&url.includes('/rest/v1/crm_proposals?'))return Response.json(JSON.parse(await sql(`select (to_jsonb(p)||jsonb_build_object('crm_customers',to_jsonb(c),'crm_properties',to_jsonb(r)))::text from public.crm_proposals p join public.crm_customers c on c.id=p.customer_id join public.crm_properties r on r.id=p.property_id where p.id='${doc}';`,'authenticated')));
  if(baseline&&url.includes('/rest/v1/crm_proposal_templates'))return Response.json(JSON.parse(await sql("select to_jsonb(t)::text from public.crm_proposal_templates t where division_id='TRD';",'authenticated')));
  if(url.includes('/brand-assets/')){logos++;return new Response(null,{status:404});}
  if(url==='https://api.resend.com/emails'){
   if(kind==='after_reservation')await sql(`update public.crm_properties set address_line1='INTERMEDIATE ADDRESS B' where id='${property}';`,'authenticated');
   posts++;bodies.push(String(options?.body));keys.push((options?.headers as Record<string,string>)['Idempotency-Key']);text=await pdfText(JSON.parse(String(options?.body)));
   if(kind==='uncertain'&&posts===1)throw Error('Synthetic timeout after possible provider acceptance');
   return Response.json({id:'85000000-0000-0000-0000-000000000001'});
  }
  throw Error('Unexpected independent read/outbound route: '+url);
 };
 try {
  const invoke=()=>handler(new Request('http://localhost/r1',{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify({document_type:'proposal',document_id:doc})}));
  const first=await invoke();const one=await first.json();
  if(kind==='changed'){assert(sourceMutated&&first.status===409&&posts===0,'Changed source must fail before provider submission');return;}
  assert(first.status===(kind==='uncertain'?202:200),JSON.stringify(one));
  if(kind==='after_reservation'){
   assert(text.includes('SNAPSHOT ADDRESS A')&&!text.includes('INTERMEDIATE ADDRESS B'),'Submitted PDF lost snapshot A');
   assert(await sql(`select status from public.crm_proposals where id='${doc}';`)==='draft','Changed current proposal falsely marked sent');
   assert(await sql(`select status from public.crm_document_deliveries where id='${one.delivery_id}';`)==='accepted','Historical snapshot acceptance not durably recorded');return;
  }
  phase=1;const logosAfterFirst=logos;
  const second=await invoke();const two=await second.json();
  assert(second.status===200&&two.status==='accepted'&&two.delivery_id===one.delivery_id,'Existing accepted operation must be reused');
  if(baseline&&text.includes('INTERMEDIATE ADDRESS B'))throw Error('R1_ABA_RENDERED_B: actual PDF B accepted under A and reused for A');
  assert(text.includes('SNAPSHOT ADDRESS A')&&!text.includes('INTERMEDIATE ADDRESS B'),'Actual PDF must contain saved A exclusively');
  assert(logos===logosAfterFirst,'Retry/reuse must not regenerate or refetch assets');
  assert(posts===(kind==='uncertain'?2:1),'Unexpected provider attempt count');
  if(kind==='uncertain')assert(bodies[0]===bodies[1]&&keys[0]===keys[1],'Uncertain retry changed frozen provider body/key');
  const evidence=JSON.parse(await sql(`select jsonb_build_object('snapshot',d.render_snapshot_id,'artifact',d.artifact_sha256,'computed',encode(sha256(decode(o.request_body::jsonb->'attachments'->0->>'content','base64')),'hex'),'request_ok',o.request_sha256=encode(sha256(convert_to(o.request_body,'UTF8')),'hex'),'status',d.status)::text from public.crm_document_deliveries d join delivery_private.operations o on o.id=d.id where d.id='${two.delivery_id}';`));
  assert(evidence.snapshot&&evidence.artifact===evidence.computed&&evidence.request_ok&&evidence.status==='accepted','Persisted context/artifact/request acceptance evidence mismatch');
  console.log(kind+': actual PDF A; immutable snapshot/PDF/request hashes match; provider attempts='+posts);
 } finally {globalThis.fetch=previous;await sql(`update public.crm_properties set address_line1='SNAPSHOT ADDRESS A' where id='${property}';`);}
}
Deno.test('actual A-B-A renderer/RPC/PDF regression',()=>scenario('aba'));
if(!baseline){
 Deno.test('uncertain acceptance retries the original PDF and provider bytes/key',()=>scenario('uncertain'));
 Deno.test('source changed after capture fails reservation before provider submission',()=>scenario('changed'));
 Deno.test('source edit after reservation preserves historical artifact acceptance without marking changed proposal sent',()=>scenario('after_reservation'));
}
