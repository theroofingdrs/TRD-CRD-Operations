// Temporary read-only probe of the original runner launch command. No app/customer traffic.
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
const command=['chromium','google-chrome','google-chrome-stable'].find(name=>spawnSync('which',[name]).status===0);
if(!command)throw Error('Original browser discovery found no command.');
console.log('Original command:',command,'Resolved path:',spawnSync('which',[command],{encoding:'utf8'}).stdout.trim());
console.log('Existing DevTools listener:',spawnSync('ss',['-ltnp','sport = :19422'],{encoding:'utf8'}).stdout);
const profile=await mkdtemp(path.join(os.tmpdir(),'crm-original-probe-'));await mkdir(path.join(profile,'fixture-dist'));
let stderr='',error;const started=Date.now();
const child=spawn(command,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--no-first-run','--remote-debugging-port=19422','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
child.stderr.on('data',data=>stderr=(stderr+data).slice(-16000));child.on('error',e=>error=e.message);
try{
 let ready=false;
 while(Date.now()-started<45000&&child.exitCode===null&&child.signalCode===null&&!error){
  try{const r=await fetch('http://127.0.0.1:19422/json/version',{signal:AbortSignal.timeout(1000)});if(r.ok){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,250));
 }
 console.log(JSON.stringify({ready,elapsedMs:Date.now()-started,pid:child.pid,exitCode:child.exitCode,signal:child.signalCode,launchError:error||null}));
 console.log('Original launch stderr:\n'+(stderr||'(empty)'));
 const version=spawnSync(command,['--version'],{encoding:'utf8',timeout:10000});console.log('Version after probe:',version.stdout,version.stderr,version.error?.message||'');
}finally{
 if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise(r=>setTimeout(r,1000));if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
 await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
