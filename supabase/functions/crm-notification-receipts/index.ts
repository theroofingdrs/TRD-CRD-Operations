import {createClient} from 'npm:@supabase/supabase-js@2.58.0';
import {handleReceipt} from './handler.ts';
Deno.serve(async(req:Request)=>handleReceipt(req,{enabled:Deno.env.get('NOTIFICATION_RECEIPTS_ENABLED')==='true',secret:Deno.env.get('RESEND_WEBHOOK_SECRET')},async(event,provider,status)=>{
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');const url=Deno.env.get('SUPABASE_URL');if(!key||!url)throw Error('Service configuration missing.');
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {error}=await client.rpc('crm_operational_notification_receipt',{p_event:event,p_provider:provider,p_status:status});if(error)throw Error('Receipt persistence failed.');
}));
