import test from 'node:test';import assert from 'node:assert/strict';
import {runOperationalNotifications} from './operations.ts';import {handleReceipt} from '../crm-notification-receipts/handler.ts';
const config={enabled:true,apiKey:'synthetic',from:'sender@example.test'};
test('all operational templates use frozen provider identity; acceptance is distinct from delivery',async()=>{
 const completed=[];const bodies=[];
 await runOperationalNotifications(config,async(name,p)=>{
  if(name==='crm_operational_notification_work')return ['assignment','appointment_update','appointment_reminder','project_completed'].map(kind=>({id:kind,kind,division_id:'CRD',recipient:'test@example.test',payload:{reference:'synthetic',start:'2027-03-15T13:30Z',status:'confirmed'}}));
  if(name==='crm_claim_operational_notification'){bodies.push(p.p_body);return {action:'send',body:JSON.stringify(p.p_body),key:p.p_id,claim:'claim'};}
  completed.push(p);
 },async()=>Response.json({id:'provider-id'}));
 assert.equal(completed.length,4);assert(completed.every(p=>p.p_status==='accepted'));assert(bodies.find(b=>b.subject.includes('reminder')).text.includes('8:30 AM (Central Time)'));
});
test('disabled, busy and unresolved operations do not produce duplicate sends',async()=>{
 assert.equal((await runOperationalNotifications({enabled:false},()=>{throw Error('unexpected');})).processed,0);
 const p=[];await runOperationalNotifications(config,async(name,args)=>{if(name==='crm_operational_notification_work')return [{id:'1',kind:'assignment',division_id:'TRD',recipient:'test@example.test',payload:{reference:'1'}}];if(name==='crm_claim_operational_notification')return {action:'send',key:'stable',body:'frozen',claim:'claim'};p.push(args);},async()=>{throw Error('timeout');});assert.equal(p[0].p_status,'uncertain');
});
async function signed(body,delta=0){const secret=btoa('synthetic-webhook-secret');const id='event-test';const timestamp=String(Math.floor(Date.now()/1000)+delta);const key=await crypto.subtle.importKey('raw',new TextEncoder().encode('synthetic-webhook-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(id+'.'+timestamp+'.'+body));return {secret:'whsec_'+secret,request:new Request('https://test.invalid/receipt',{method:'POST',headers:{'svix-id':id,'svix-timestamp':timestamp,'svix-signature':'v1,'+btoa(String.fromCharCode(...new Uint8Array(signature)))},body})};}
test('signed delivery receipts persist evidence; forged or expired callbacks cannot',async()=>{
 const body=JSON.stringify({type:'email.delivered',data:{email_id:'provider-id'}});const f=await signed(body);const records=[];
 assert.equal((await handleReceipt(f.request,{enabled:true,secret:f.secret},async(...p)=>records.push(p))).status,200);assert.deepEqual(records,[['event-test','provider-id','delivered']]);
 const expired=await signed(body,-600);assert.equal((await handleReceipt(expired.request,{enabled:true,secret:expired.secret},()=>{throw Error('unauthorized');})).status,401);
 const forged=await signed(body);forged.request.headers.set('svix-signature','v1,Zm9yZ2Vk');assert.equal((await handleReceipt(forged.request,{enabled:true,secret:forged.secret},()=>{throw Error('unauthorized');})).status,401);
});
test('receipt persistence failure is retriable and never acknowledges discarded evidence',async()=>{
 const f=await signed(JSON.stringify({type:'email.bounced',data:{email_id:'provider-id'}}));assert.equal((await handleReceipt(f.request,{enabled:true,secret:f.secret},async()=>{throw Error('database unavailable');})).status,503);
});
