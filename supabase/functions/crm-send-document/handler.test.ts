// No network permission: every outbound call is an in-memory synthetic fixture.
let handler: (request: Request) => Promise<Response>;
const serve = Deno.serve;
Object.defineProperty(Deno, 'serve', { value: (callback: typeof handler) => { handler = callback; } });
Deno.env.set('SUPABASE_URL','https://synthetic.invalid');
Deno.env.set('SUPABASE_ANON_KEY','synthetic-public-key');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','synthetic-server-key');
Deno.env.set('RESEND_API_KEY','synthetic-provider-key');
Deno.env.set('RESEND_FROM_EMAIL','office@example.test');
await import('./index.ts');
Object.defineProperty(Deno, 'serve', { value: serve });
const fetchOriginal = globalThis.fetch;
const id='40000000-0000-0000-0000-000000000001';
const customer='20000000-0000-0000-0000-000000000001';
const property='30000000-0000-0000-0000-000000000001';
function equal(a: unknown,b: unknown) { if(a!==b) throw new Error(`${a} !== ${b}`); }
async function request(headers: Record<string,string>, mode: string, docType = "proposal") {
  let providerCalls=0;
  globalThis.fetch = async (input: string | URL | Request, options?: RequestInit) => {
    const url=String(input);
    if(url.includes('/auth/v1/user')) return mode==='invalid' ? Response.json({message:'invalid'}, {status:401}) : Response.json({id:'10000000-0000-0000-0000-000000000002',email:'synthetic@example.test'});
    if(url.includes('/rpc/crm_document_render_inputs')) {
      if(mode==='unauthorized') return Response.json({message:'denied'},{status:403});
      return Response.json({renderer:'crm-pdf-v3',type:docType,version:'2026-11-03T00:00:00Z',
        document:{template_data:mode==='roofrMismatch'?{roofr_report_id:'90000000-0000-0000-0000-000000000001'}:{},id,division_id:'TRD',customer_id:customer,property_id:property,title:'Synthetic',line_items:[]},
        customer:mode==='missing'?null:{id:customer,email:'customer@example.test',display_name:'Synthetic'},
        property:{id:property,customer_id:mode==='mismatch'?'different':customer},template:null,items:[],report:null,
        photos:mode==='photoMismatch'?[{file_id:'90000000-0000-0000-0000-000000000001',crm_files:{id:'90000000-0000-0000-0000-000000000001',division_id:'TRD',related_type:'inspection',related_id:'another-inspection',bucket_id:'roof-doctors-private',content_type:'image/jpeg'}}]:[]});
    }
    if(url.includes('/rpc/crm_freeze_document_render')) {
      const args=JSON.parse(String(options?.body));equal(args.p_actor,'10000000-0000-0000-0000-000000000002');
      return Response.json({id:'70000000-0000-0000-0000-000000000001',inputs:args.p_inputs,context:'a'.repeat(64),captured_at:'2026-11-03T00:00:00Z',current_version:args.p_inputs.version,cached_body:null});
    }
    if(url.includes('/rpc/crm_claim_document_delivery')) {
      const body=JSON.parse(String(options?.body));
      equal(body.p_actor,'10000000-0000-0000-0000-000000000002');
      equal(JSON.parse(body.p_body)._crm_context,'a'.repeat(64));
      equal(JSON.parse(body.p_body)._crm_snapshot,'70000000-0000-0000-0000-000000000001');
      equal(JSON.parse(body.p_body)._crm_pdf_sha256.length,64);
      return Response.json({action:'send',id:'synthetic-operation',claim:'synthetic-claim',key:'crm-document/synthetic',body:'{"to":["customer@example.test"]}'});
    }
    if(url.includes('/rpc/crm_finish_document_delivery')) return new Response(null,{status:204});
    if(url.includes('api.resend.com')) { providerCalls++; return Response.json({id:'synthetic-provider-id'}); }
    throw new Error('Unexpected outbound fixture path');
  };
  try {
    const result=await handler(new Request('http://localhost/send',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({document_type:docType,document_id:id})}));
    equal(providerCalls,mode==='accepted'?1:0); return result.status;
  } finally { globalThis.fetch=fetchOriginal; }
}
Deno.test('anonymous and forged identity headers cannot authenticate',async()=>equal(await request({'x-user-id':'owner','x-user-role':'owner'},'unauthorized'),401));
Deno.test('invalid bearer token is denied',async()=>equal(await request({Authorization:'Bearer synthetic'},'invalid'),401));
Deno.test('verified unauthorized bearer cannot read another document',async()=>equal(await request({Authorization:'Bearer synthetic','x-user-role':'owner'},'unauthorized'),404));
Deno.test('missing customer relation fails closed',async()=>equal(await request({Authorization:'Bearer synthetic'},'missing'),403));
Deno.test('mismatched customer/property fails closed',async()=>equal(await request({Authorization:'Bearer synthetic'},'mismatch'),403));

Deno.test('verified caller identity reaches trusted operation and acceptance persists',async()=>equal(await request({Authorization:'Bearer synthetic','x-user-id':'forged-owner'},'accepted'),200));

Deno.test('missing or unauthorized linked Roofr report prevents sending',async()=>equal(await request({Authorization:'Bearer synthetic'},'roofrMismatch'),403));
Deno.test('cross-inspection photo relationship prevents sending',async()=>equal(await request({Authorization:'Bearer synthetic'},'photoMismatch','inspection'),403));

for (const mode of ['accepted','boundAccepted','legacyAccepted','denied','changedCredential','retrievalFailure','mismatch','persistenceFailure']) {
 Deno.test('owner recovery boundary: '+mode,async()=>{
  let reads=0,writes=0,gets=0;
  const operationId='50000000-0000-0000-0000-000000000001';
  const providerId='60000000-0000-0000-0000-000000000001';
  const body={to:['customer@example.test'],from:'office@example.test',subject:'Synthetic',html:'Synthetic body'};
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(mode==='legacyAccepted'?'synthetic-provider-key':JSON.stringify(['synthetic-provider-key','office@example.test',mode==='boundAccepted'?'crm-pdf-v3':'crm-pdf-v2'])));
  const context=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
  globalThis.fetch=async(input: string | URL | Request, options?: RequestInit)=>{
   const url=String(input);
   if(url.includes('/auth/v1/user'))return Response.json({id:'10000000-0000-0000-0000-000000000002'});
   if(url.includes('/rpc/crm_delivery_reconciliation')){
    const args=JSON.parse(String(options?.body));equal(args.p_actor,'10000000-0000-0000-0000-000000000002');
    if(!args.p_provider){reads++;return mode==='denied'?Response.json({message:'denied'},{status:403}):Response.json({id:operationId,body:JSON.stringify(body),provider_context:mode==='changedCredential'?'old-credential':context,context_fingerprint:mode==='legacyAccepted'?null:'a'.repeat(64),render_snapshot_id:mode==='boundAccepted'?'70000000-0000-0000-0000-000000000001':null,status:'uncertain'});}
    writes++;equal(args.p_event,'sent');
    return mode==='persistenceFailure'?Response.json({message:'unavailable'},{status:503}):Response.json({id:operationId,status:'accepted',provider_last_event:'sent'});
   }
   if(url.startsWith('https://api.resend.com/emails/')){
    gets++;equal(options?.method,undefined);equal(url,'https://api.resend.com/emails/'+providerId);
    if(mode==='retrievalFailure')return Response.json({message:'unavailable'},{status:503});
    return Response.json({id:providerId,...body,last_event:'sent',tags:mode==='mismatch'?[]:[{name:'crm_operation',value:operationId}]});
   }
   throw Error('Unexpected request or unsafe provider POST');
  };
  try{
   const response=await handler(new Request('http://localhost/send',{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json','x-user-id':'forged-owner'},body:JSON.stringify({action:'reconcile',delivery_id:operationId,provider_id:providerId,evidence:'Synthetic log reference'})}));
   equal(response.status,['accepted','boundAccepted','legacyAccepted'].includes(mode)?200:mode==='denied'?403:409);equal(reads,1);
   equal(gets,['denied','changedCredential'].includes(mode)?0:1);
   equal(writes,['accepted','boundAccepted','legacyAccepted','persistenceFailure'].includes(mode)?1:0);
   if(['accepted','boundAccepted','legacyAccepted'].includes(mode)){const value=await response.json();equal(value.status,'accepted');equal(value.provider_last_event,'sent');equal(value.delivered,undefined);}
  }finally{globalThis.fetch=fetchOriginal;}
 });
}
