import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {startChromium} from './chromium-startup.mjs';
async function fixture(body,run){
 const dir=await mkdtemp(path.join(os.tmpdir(),'crm-browser-test-'));const executable=path.join(dir,'test-chromium');
 await writeFile(executable,'#!/usr/bin/env node\nif(process.argv.includes("--version")){console.log("Chromium synthetic startup test");process.exit(0);}\n'+body,{mode:0o700});
 try{await run({executable,profile:path.join(dir,'profile')});}finally{await rm(dir,{recursive:true,force:true});}
}
test('missing executable reports its path and launch error immediately',async()=>{
 await assert.rejects(startChromium({executable:'/tmp/nonexistent-crm-chromium',profile:'/tmp/unused'}),error=>error.message.includes('/tmp/nonexistent-crm-chromium')&&error.message.includes('ENOENT'));
});
test('early browser exit reports stderr, version, path and exit code',async()=>{
 await fixture('console.error("synthetic missing libnss3.so");process.exit(127);',async config=>{
  await assert.rejects(startChromium({...config,timeoutMs:10000}),error=>['exited before DevTools','libnss3.so','exitCode=127',config.executable,'Chromium synthetic'].every(value=>error.message.includes(value)));
 });
});
test('hung startup reports timeout and stderr and terminates the owned process',async()=>{
 await fixture('console.error("synthetic browser not listening");setInterval(()=>{},1000);',async config=>{
  let child;await assert.rejects(startChromium({...config,timeoutMs:2000,onStart:p=>child=p}),error=>error.message.includes('timed out after 2000ms')&&error.message.includes('not listening'));
  assert(child.exitCode!==null||child.signalCode!==null);
 });
});
test('unrelated HTTP endpoint cannot be mistaken for a ready browser',async()=>{
 await fixture(`import('node:fs').then(fs=>{const profile=process.argv.find(a=>a.startsWith('--user-data-dir=')).split('=')[1];fs.mkdirSync(profile,{recursive:true});import('node:http').then(http=>{const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({webSocketDebuggerUrl:'ws://not-the-browser.invalid:80/'}));});server.listen(0,'127.0.0.1',()=>fs.writeFileSync(profile+'/DevToolsActivePort',String(server.address().port)));});});`,async config=>{
  await assert.rejects(startChromium({...config,timeoutMs:2000}),error=>error.message.includes('does not match the launched browser'));
 });
});
