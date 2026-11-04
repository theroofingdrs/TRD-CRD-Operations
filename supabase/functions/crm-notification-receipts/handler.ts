/** Verify raw Svix/Resend body before interpreting provider evidence. */
export async function handleReceipt(req:Request,config:{enabled:boolean;secret?:string},record:(event:string,provider:string,status:string)=>Promise<void>,now=Date.now()):Promise<Response>{
 if(!config.enabled)return new Response('Disabled',{status:503});
 if(req.method!=='POST')return new Response('POST required',{status:405});
 const id=req.headers.get('svix-id')||'',timestamp=req.headers.get('svix-timestamp')||'',signatures=req.headers.get('svix-signature')||'';
 if(!config.secret?.startsWith('whsec_')||!id||id.length>200||!/^\d{10}$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300)return new Response('Invalid signature',{status:401});
 // Bound the stream before allocating the raw body, even without Content-Length.
 const reader=req.body?.getReader();const parts:Uint8Array[]=[];let size=0;
 if(reader)while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();return new Response('Too large',{status:413});}parts.push(value);}
 const raw=new Uint8Array(size);let offset=0;for(const p of parts){raw.set(p,offset);offset+=p.length;}
 try{
  const decode=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('raw',decode(config.secret.slice(6)),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const prefix=new TextEncoder().encode(id+'.'+timestamp+'.');const signed=new Uint8Array(prefix.length+raw.length);signed.set(prefix);signed.set(raw,prefix.length);
  let valid=false;for(const sig of signatures.split(' ').slice(0,10)){if(!sig.startsWith('v1,'))continue;try{if(await crypto.subtle.verify('HMAC',key,decode(sig.slice(3)),signed))valid=true;}catch{/* malformed signatures do not authenticate */}}
  if(!valid)return new Response('Invalid signature',{status:401});
  const event=JSON.parse(new TextDecoder().decode(raw));const status=event.type==='email.delivered'?'delivered':['email.bounced','email.complained'].includes(event.type)?'bounced':null;
  if(status){if(typeof event.data?.email_id!=='string'||!event.data.email_id||event.data.email_id.length>200)return new Response('Invalid receipt',{status:400});await record(id,event.data.email_id,status);}
  return Response.json({received:true});
 }catch{return new Response('Receipt could not be persisted',{status:503});}
}
