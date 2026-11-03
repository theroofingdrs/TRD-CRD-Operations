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
async function request(headers: Record<string,string>, mode: string) {
  let providerCalls=0;
  globalThis.fetch = async (input: string | URL | Request, options?: RequestInit) => {
    const url=String(input);
    if(url.includes('/auth/v1/user')) return mode==='invalid' ? Response.json({message:'invalid'}, {status:401}) : Response.json({id:'10000000-0000-0000-0000-000000000002',email:'synthetic@example.test'});
    if(url.includes('/rest/v1/crm_proposals')) {
      if(mode==='unauthorized') return Response.json({message:'not found'}, {status:404});
      return Response.json({id,division_id:'TRD',updated_at:'2026-11-03T00:00:00Z',customer_id:customer,property_id:property,title:'Synthetic',line_items:[],
        crm_customers:mode==='missing'?null:{id:customer,email:'customer@example.test',display_name:'Synthetic'},
        crm_properties:{id:property,customer_id:mode==='mismatch'?'different':customer}});
    }
    if(url.includes('/crm_proposal_templates')) return Response.json([]);
    if(url.includes('/rpc/crm_claim_document_delivery')) {
      const body=JSON.parse(String(options?.body));
      equal(body.p_actor,'10000000-0000-0000-0000-000000000002');
      return Response.json({action:'send',id:'synthetic-operation',claim:'synthetic-claim',key:'crm-document/synthetic',body:'{"to":["customer@example.test"]}'});
    }
    if(url.includes('/rpc/crm_finish_document_delivery')) return new Response(null,{status:204});
    if(url.includes('api.resend.com')) { providerCalls++; return Response.json({id:'synthetic-provider-id'}); }
    throw new Error('Unexpected outbound fixture path');
  };
  try {
    const result=await handler(new Request('http://localhost/send',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({document_type:'proposal',document_id:id})}));
    equal(providerCalls,mode==='accepted'?1:0); return result.status;
  } finally { globalThis.fetch=fetchOriginal; }
}
Deno.test('anonymous and forged identity headers cannot authenticate',async()=>equal(await request({'x-user-id':'owner','x-user-role':'owner'},'unauthorized'),401));
Deno.test('invalid bearer token is denied',async()=>equal(await request({Authorization:'Bearer synthetic'},'invalid'),401));
Deno.test('verified unauthorized bearer cannot read another document',async()=>equal(await request({Authorization:'Bearer synthetic','x-user-role':'owner'},'unauthorized'),404));
Deno.test('missing customer relation fails closed',async()=>equal(await request({Authorization:'Bearer synthetic'},'missing'),403));
Deno.test('mismatched customer/property fails closed',async()=>equal(await request({Authorization:'Bearer synthetic'},'mismatch'),403));

Deno.test('verified caller identity reaches trusted operation and acceptance persists',async()=>equal(await request({Authorization:'Bearer synthetic','x-user-id':'forged-owner'},'accepted'),200));
