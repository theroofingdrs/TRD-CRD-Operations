type Rpc=(name:string,args?:Record<string,unknown>)=>Promise<any>;
const subjects:Record<string,string>={assignment:'Lead assigned',appointment_update:'Appointment update',appointment_reminder:'Appointment reminder',project_completed:'Project update'};
export async function runOperationalNotifications(config:{enabled:boolean;apiKey?:string;from?:string},rpc:Rpc,transport:typeof fetch=fetch){
 if(!config.enabled)return {status:'disabled',processed:0};
 if(!config.apiKey||!config.from||!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(config.from))throw Error('Verified notification sender and provider credential required.');
 const jobs=await rpc('crm_operational_notification_work');let processed=0;
 for(const job of jobs){
  if(!subjects[job.kind]||typeof job.recipient!=='string')throw Error('Unknown notification contract.');
  const p=job.payload;const brand=job.division_id==='TRD'?'The Roof Doctors':'Commercial Roof Doctors';
  let text='Reference: '+p.reference;
  if(job.kind==='assignment')text='A lead has been assigned to you. Review its details and follow-up in Operations. '+text;
  else if(job.kind==='project_completed')text='Your project has been marked complete in Operations. Contact our team with any questions. '+text;
  else{
   const start=Date.parse(p.start);if(!Number.isFinite(start))throw Error('Invalid appointment snapshot.');
   const time=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',dateStyle:'full',timeStyle:'short'}).format(start);
   text=(p.status==='cancelled'?'This appointment has been cancelled.':'Appointment '+(job.kind==='appointment_reminder'?'reminder':'update')+': '+time+' (Central Time). Status: '+p.status+'.')+' '+text;
  }
  const operation=await rpc('crm_claim_operational_notification',{p_id:job.id,p_body:{from:config.from,to:[job.recipient],subject:brand+': '+subjects[job.kind],text}});
  if(operation.action!=='send')continue;
  let status='uncertain',provider:string|null=null,error:string|null=null;
  try{
   const r=await transport('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+config.apiKey,'Content-Type':'application/json','Idempotency-Key':operation.key},body:operation.body,signal:AbortSignal.timeout(20000),redirect:'error'});
   const data=await r.json().catch(()=>null);
   if(r.ok&&typeof data?.id==='string'&&data.id){status='accepted';provider=data.id;}
   else if([400,401,403,422].includes(r.status)){status='failed';error='Provider rejected request ('+r.status+').';}
   else error='Provider acceptance uncertain; inspect evidence before any resend.';
  }catch{error='Provider response unavailable; inspect evidence before any resend.';}
  await rpc('crm_finish_operational_notification',{p_id:job.id,p_claim:operation.claim,p_status:status,p_provider:provider,p_error:error});processed++;
 }
 return {status:'processed',processed};
}
