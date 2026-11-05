export async function runNotifications(config:{enabled:boolean;apiKey?:string;from?:string;internalTo?:string}, rpc:(name:string,args?:Record<string,unknown>)=>Promise<any>, transport:typeof fetch=fetch) {
 if(!config.enabled)return {status:'disabled',processed:0};
 const email=(s:unknown):s is string=>typeof s==='string'&&/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(s);
 if(!config.apiKey||!email(config.from)||!email(config.internalTo))throw new Error('Configure verified notification sender, internal recipient and provider credential before enabling.');
 const jobs=await rpc('crm_intake_notification_work');let processed=0;
 for(const job of jobs){
  const p=job.payload;const recipient=job.recipient_kind==='internal'?config.internalTo:p.contactRecord?.email||p.email;
  if(!email(recipient))continue;
  const brand=job.division_id==='TRD'?'The Roof Doctors':'Commercial Roof Doctors';
  const estimateRequest=[p.source,p.landingPage,p.serviceRequested,p.leadType].some(value=>typeof value==='string'&&/estimate/i.test(value))||Boolean(p.estimateDetails&&typeof p.estimateDetails==='object');
  const subject=job.recipient_kind==='internal'?brand+(estimateRequest?': new estimate request':': new lead'):brand+': inquiry received';
  const body={from:config.from,to:[recipient],subject,text:job.recipient_kind==='internal'?'A new inquiry is in Operations. Review its contact details and follow-up task. Reference: '+job.submission_key:'Your inquiry has reached our Operations team. We will contact you to confirm your needs and availability. No appointment has been booked. Reference: '+job.submission_key};
  const operation=await rpc('crm_claim_intake_notification',{p_id:job.id,p_body:body});
  if(operation.action!=='send')continue;
  let state='uncertain',provider:null|string=null,error:null|string=null;
  try{
   const response=await transport('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+config.apiKey,'Content-Type':'application/json','Idempotency-Key':operation.key},body:operation.body,signal:AbortSignal.timeout(20000),redirect:'error'});
   const result=await response.json().catch(()=>null);
   if(response.ok&&typeof result?.id==='string'&&result.id){state='sent';provider=result.id;}
   else if([400,401,403,422].includes(response.status)){state='failed';error='Provider rejected request ('+response.status+').';}
   else error='Provider acceptance uncertain; verify before any resend.';
  }catch{error='Provider response unavailable; verify before any resend.';}
  await rpc('crm_finish_intake_notification',{p_id:job.id,p_claim:operation.claim,p_status:state,p_provider:provider,p_error:error});
  processed++;
 }
 return {status:'processed',processed};
}
