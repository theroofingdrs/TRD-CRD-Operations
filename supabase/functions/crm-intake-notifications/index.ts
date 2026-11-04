import {createClient} from 'npm:@supabase/supabase-js@2.58.0';
import {runNotifications} from './worker.ts';
Deno.serve(async(req:Request)=>{
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(req.method!=='POST'||!key||req.headers.get('Authorization')!=='Bearer '+key)return new Response('Unauthorized',{status:401});
 const client=createClient(Deno.env.get('SUPABASE_URL')||'',key,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const result=await runNotifications({enabled:Deno.env.get('INTAKE_NOTIFICATIONS_ENABLED')==='true',apiKey:Deno.env.get('RESEND_API_KEY'),from:Deno.env.get('INTAKE_NOTIFICATION_FROM'),internalTo:Deno.env.get('INTAKE_NOTIFICATION_INTERNAL_TO')},async(name,args)=>{const {data,error}=await client.rpc(name,args);if(error)throw new Error('Notification persistence failed: '+error.code);return data;});
  return Response.json(result);
 }catch{return Response.json({error:'Notification processing failed. Inspect pending/uncertain receipts before retrying.'},{status:503});}
});
