import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverOperation, requiredParent } from './delivery.ts';
const operation = { action:'send', id:'synthetic-operation', key:'crm-document/synthetic', body:'{"to":["synthetic@example.test"]}' };
test('relationship adapter rejects missing, mismatched and ambiguous parents', () => {
  assert.equal(requiredParent({id:'a'},'a').id,'a');
  assert.equal(requiredParent([{id:'a'}],'a').id,'a');
  for(const input of [null,[],[{id:'a'},{id:'b'}],{id:'b'}]) assert.throws(()=>requiredParent(input,'a'));
});
test('provider acceptance is durably recorded and is not claimed delivered', async()=>{
  const states=[];
  const result=await deliverOperation(operation,'synthetic-key',async(...args)=>states.push(args),async(url,options)=>{
    assert.equal(url,'https://api.resend.com/emails'); assert.equal(options.headers['Idempotency-Key'],operation.key); assert.equal(options.body,operation.body);
    return Response.json({id:'provider-test'});
  });
  assert.equal(result.status,'accepted');assert.deepEqual(states,[['accepted','provider-test',null]]);assert.equal(result.delivered,undefined);
});
test('definitive validation rejection is recorded',async()=>{
  let state;const r=await deliverOperation(operation,'synthetic',async s=>{state=s},async()=>Response.json({name:'validation_error'},{status:422}));
  assert.equal(state,'failed');assert.equal(r.success,false);
});
test('timeouts, malformed success, 409, 429 and 5xx remain uncertain',async()=>{
  for(const response of [null,Response.json({}),Response.json({}, {status:409}),Response.json({}, {status:429}),Response.json({}, {status:503})]){
    let state;await deliverOperation(operation,'synthetic',async s=>{state=s},async()=>{if(!response)throw new Error('timeout');return response});assert.equal(state,'uncertain');
  }
});
test('persistence failure propagates after acceptance',async()=>{
  await assert.rejects(deliverOperation(operation,'synthetic',async()=>{throw Error('storage')},async()=>Response.json({id:'test'})),/storage/);
});
test('busy, completed and manual-review operations cannot call the provider',async()=>{
  for(const action of ['busy','complete','review'])await deliverOperation({...operation,action,status:action==='complete'?'accepted':'uncertain'},'synthetic',async()=>assert.fail(),async()=>assert.fail());
});
test('same operation retries preserve immutable provider bytes and key',async()=>{
  const accepted=new Map();let sends=0;
  const provider=async(_url,options)=>{const key=options.headers['Idempotency-Key'];if(!accepted.has(key)){accepted.set(key,options.body);sends++}else assert.equal(accepted.get(key),options.body);return Response.json({id:'test'})};
  await Promise.all(Array.from({length:8},()=>deliverOperation(operation,'synthetic',async()=>{},provider)));
  assert.equal(sends,1); // Mock provider's documented bounded idempotency contract.
});
test('manual recovery is GET-only and requires the operation tag and frozen recipient/body',async()=>{
  const { verifyRecovery }=await import('./delivery.ts');
  const id='10000000-0000-0000-0000-000000000001';
  const op={id:'operation-test',body:JSON.stringify({to:['customer@example.test'],from:'office@example.test',subject:'Test',html:'<p>Synthetic</p>'})};
  const email={id,...JSON.parse(op.body),last_event:'delivered',tags:[{name:'crm_operation',value:op.id}]};
  assert.equal(await verifyRecovery(op,id,'synthetic',async(url,options)=>{assert.equal(url,'https://api.resend.com/emails/'+id);assert.equal(options.method,undefined);return Response.json(email)}),'delivered');
  for(const change of [{tags:[]},{to:['other@example.test']},{html:'different'},{id:'wrong'}])await assert.rejects(verifyRecovery(op,id,'synthetic',async()=>Response.json({...email,...change})));
});

test('provider retrieval failure leaves reconciliation unverified and never resends',async()=>{
  const { verifyRecovery }=await import('./delivery.ts');
  const id='10000000-0000-0000-0000-000000000001';
  for(const failure of [null,404,403,429,500,'malformed']) {
    let calls=0;
    await assert.rejects(verifyRecovery({id:'operation',body:'{}'},id,'synthetic',async(_url,options)=>{
      calls++;assert.equal(options.method,undefined);
      if(failure===null)throw Error('timeout');
      if(failure==='malformed')return new Response('invalid json');
      return Response.json({}, {status:failure});
    }));
    assert.equal(calls,1);
  }
});
