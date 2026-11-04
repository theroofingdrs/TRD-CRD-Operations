// Actual React/Vite + Chromium. All external traffic is intercepted; synthetic data only.
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
const widths=[320,360,375,390,430,768,1024,1440],baseline=process.argv.includes('--baseline');
const capture=process.env.RESPONSIVE_CAPTURE_DIR;const root=process.cwd();
const temp=await mkdtemp(path.join(os.tmpdir(),'crm-responsive-'));
const chrome=process.env.CHROME_BIN||['chromium','google-chrome','google-chrome-stable'].find(bin=>spawnSync('which',[bin]).status===0);
if(!chrome)throw Error('Chromium is required.');
const children=[],sockets=[];const results=[];let failures=0;
const user='10000000-0000-4000-8000-000000000001',customer='20000000-0000-4000-8000-000000000001',property='30000000-0000-4000-8000-000000000001';
const long='UnbrokenReference'.repeat(18),address='12345 Synthetic Roofing Service Road '+long;
const fixtures={
 crm_memberships:[{user_id:user,division_id:'TRD',role:'owner',active:true},{user_id:user,division_id:'CRD',role:'owner',active:true}],
 crm_profiles:[{user_id:user,display_name:'Layout Test Operator',email:'operator@example.test'}],
 crm_customer_divisions:[{customer_id:customer,division_id:'TRD'}],
 crm_customers:[{id:customer,customer_type:'individual',display_name:'Responsive Test Customer',email:long+'@example.test',phone:'9035550100',billing_address_line1:address,billing_city:'Synthetic City',billing_state:'TX',billing_postal_code:'00000',created_at:'2026-01-01T12:00Z',assigned_to:null}],
 crm_properties:[{id:property,customer_id:customer,address_line1:address,city:'Synthetic City',state:'TX',postal_code:'00000',property_type:'residential',county:'Test County',parcel_number:long,building_name:'Synthetic Building'}],
 crm_contacts:[{id:'contact',customer_id:customer,full_name:'Synthetic contact',email:long+'@example.test',phone:'9035550100',title:long,is_primary:true}],
 crm_leads:[{id:'lead',division_id:'TRD',customer_id:customer,property_id:property,service_interest:'Roof inspection '+long,status:'new',priority:'normal',description:long,source_record_id:'website-TRD-fixture',customer:{display_name:'Responsive Test Customer',email:long+'@example.test'},created_at:'2026-01-01T12:00Z'}],
 crm_projects:[{id:'project',division_id:'TRD',customer_id:customer,property_id:property,project_name:'Synthetic project '+long,project_type:'roof_replacement',pipeline_type:'retail',workflow_stage:'new_lead',status:'planning',contract_amount:1000,created_at:'2026-01-01T12:00Z',updated_at:'2026-01-01T12:00Z'}],
 crm_roofs:[{id:'roof',property_id:property,roof_section:'Synthetic roof '+long,roof_type:'shingle',condition_summary:long}],
 crm_claims:[{id:'claim',customer_id:customer,property_id:property,claim_number:long,policy_number:long,insurance_carrier:'Synthetic carrier',claim_status:'new'}],
 crm_appointments:[{id:'appointment',division_id:'TRD',customer_id:customer,property_id:property,appointment_type:'inspection',status:'scheduled',starts_at:'2027-01-01T15:00Z',ends_at:'2027-01-01T16:00Z',location_notes:long}],
 crm_inspections:[{id:'inspection',customer_id:customer,property_id:property,status:'draft',summary:long}],
 crm_tasks:[{id:'task',title:'Synthetic follow-up '+long,status:'open',priority:'normal',assigned_to:user}],
 crm_files:[{id:'file',related_id:property,related_type:'property',original_filename:long+'.pdf',content_type:'application/pdf',created_at:'2026-01-01T12:00Z',metadata:{document_type:'roofr_measurement_report',extracted_measurements:[{label:'Pitched roof squares',value:25,unit:'SQ',source_label:long}],extracted_structures:[{name:'Synthetic structure '+long,measurements:[{label:'Pitched roof squares',value:25,unit:'SQ'}]}]}}],
};
function start(bin,args,options={}){const child=spawn(bin,args,{stdio:'ignore',...options});children.push(child);return child;}
async function wait(check,label){for(let i=0;i<150;i++){try{if(await check())return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+label);}
try{
 const fixtureEnv={...process.env,VITE_SUPABASE_URL:'https://layout-fixture.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'synthetic-public-key',VITE_GOOGLE_MAPS_API_KEY:''};
 if(baseline){start(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','19400','--strictPort'],{env:fixtureEnv});}
 else{
  const dist=path.join(temp,'fixture-dist');const build=start(process.execPath,['node_modules/vite/bin/vite.js','build','--outDir',dist],{env:fixtureEnv});
  const status=await new Promise(resolve=>build.once('exit',resolve));assert.equal(status,0,'Production fixture build failed');
  start(process.execPath,['node_modules/vite/bin/vite.js','preview','--outDir',dist,'--host','127.0.0.1','--port','19400','--strictPort']);
 }
 start(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--no-first-run','--remote-debugging-port=19422','--user-data-dir='+temp,'about:blank']);
 await wait(async()=> (await fetch('http://127.0.0.1:19422/json/version')).ok,'Chromium');
 const target=await(await fetch('http://127.0.0.1:19422/json/new?about:blank',{method:'PUT'})).json();
 const ws=new WebSocket(target.webSocketDebuggerUrl);sockets.push(ws);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 let seq=0;const pending=new Map();let populated=false;const errors=[],requests=[];
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 ws.addEventListener('message',async event=>{
  const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}return;}
  if(m.method==='Runtime.exceptionThrown'){errors.push(m.params.exceptionDetails.text);return;}
  if(m.method!=='Fetch.requestPaused')return;
  const {requestId,request}=m.params;const url=new URL(request.url);
  if(url.hostname==='127.0.0.1'){await call('Fetch.continueRequest',{requestId});return;}
  let data=[];const table=url.pathname.split('/').at(-1);
  if(url.hostname==='layout-fixture.supabase.co'){
   if(request.method!=='OPTIONS')requests.push(table);
   if(request.method==='POST'&&!url.pathname.includes('/rpc/'))throw Error('Responsive tests must not mutate records.');
   data=fixtures[table]??[];
   if(table==='crm_maintenance_records')data=populated?[{id:'service',property_id:property,service_type:'roof_repair',status:'completed',priority:'normal',description:long,work_performed:long,findings:long,service_cost:100}]:[];
   if(table==='crm_website_lead_attachments')data=[{id:'attachment',filename:'synthetic.png',mime:'image/png',size_bytes:8}];
   if(table==='crm_website_attachment')data={filename:'synthetic.png',mime:'image/png',data_base64:'iVBORw0KGgo='};
   if(table==='crm_staff_booking_status')data={enabled:false,bookings:[]};
   if(Object.entries(request.headers).some(([k,v])=>k.toLowerCase()==='accept'&&v.includes('vnd.pgrst.object')))data=Array.isArray(data)?data[0]??null:data;
  }
  const allowed=Object.entries(request.headers).find(([k])=>k.toLowerCase()==='access-control-request-headers')?.[1]||'*';
  await call('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'content-type',value:'application/json'},{name:'access-control-allow-origin',value:'*'},{name:'access-control-allow-headers',value:allowed},{name:'access-control-allow-methods',value:'GET,POST,OPTIONS'},{name:'content-range',value:'0-0/1'}],body:Buffer.from(JSON.stringify(data)).toString('base64')});
 });
 const evaluate=async(expression)=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 await call('Browser.setDownloadBehavior',{behavior:'deny'});await call('Page.enable');await call('Runtime.enable');await call('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 const token=Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.synthetic';
 const session={access_token:token,refresh_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:user,aud:'authenticated',role:'authenticated',email:'operator@example.test'}};
 await call('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('sb-layout-fixture-auth-token',${JSON.stringify(JSON.stringify(session))});localStorage.setItem('trd-crd-workspace-${user}','{"division":"TRD","view":"customers"}');`});
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});
 await call('Page.navigate',{url:'http://127.0.0.1:19400/'});
 await wait(()=>evaluate('document.body.innerText.includes("Responsive Test Customer")'),'customer list');
 const clickElement=async expression=>{
  if(baseline){await evaluate(`(${expression}).click()`);}else{
   const point=await evaluate(`(async()=>{const e=${expression};if(!e)throw Error('Button missing');e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const r=e.getBoundingClientRect();const x=r.left+r.width/2,y=r.top+r.height/2;if(!e.contains(document.elementFromPoint(x,y)))throw Error('Control is not reachable at its rendered position');return {x,y,mobile:innerWidth<768};})()`);
   if(point.mobile){await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:point.x,y:point.y,radiusX:1,radiusY:1}]});await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
   else{await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,x:point.x,y:point.y});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:point.x,y:point.y});}
  }
  await new Promise(r=>setTimeout(r,100));
 };
 const clickText=async(text,scope='document')=>clickElement(`[...${scope}.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`);

 await clickText('Responsive Test Customer');await wait(()=>evaluate('!!document.querySelector(".customer-service-history")'),'customer details');
 async function inspect(name,width){
  await new Promise(r=>setTimeout(r,60));
  const data=await evaluate(`(()=>{
   const w=${width},main=document.querySelector('.main-area'),mr=main.getBoundingClientRect(),ms=getComputedStyle(main),left=mr.left+parseFloat(ms.paddingLeft),right=mr.right-parseFloat(ms.paddingRight);
   const permitted=e=>!!e.parentElement?.closest('.table-wrap,.kanban-board,.history-list pre');
   const bad=[...main.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&!permitted(e)&&(r.left<left-1||r.right>right+1);}).map(e=>{const r=e.getBoundingClientRect();return {tag:e.tagName,class:e.className,text:e.textContent.slice(0,65),left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width),min:getComputedStyle(e).minWidth};});
   const service=document.querySelector('.customer-service-history'),sr=service?.getBoundingClientRect();
   const nested=[...main.querySelectorAll('.panel,.panel-heading,.button-row,.form-grid,.inline-form,.customer-service-history,.table-wrap,input,select,textarea')].filter(e=>!permitted(e)&&e.getBoundingClientRect().width>0).flatMap(e=>{const p=e.parentElement,r=e.getBoundingClientRect(),pr=p.getBoundingClientRect(),ps=getComputedStyle(p);if(!['block','grid','flex'].includes(ps.display))return [];const l=pr.left+parseFloat(ps.borderLeftWidth)+parseFloat(ps.paddingLeft),right=pr.right-parseFloat(ps.borderRightWidth)-parseFloat(ps.paddingRight);return r.left<l-1||r.right>right+1?[{tag:e.tagName,class:e.className,left:Math.round(r.left),right:Math.round(r.right),parent:p.className,allowedLeft:Math.round(l),allowedRight:Math.round(right)}]:[];});
   const cellControls=[...main.querySelectorAll('td button,td input,td select,td textarea')].filter(e=>e.getBoundingClientRect().width>0).flatMap(e=>{const cell=e.closest('td'),r=e.getBoundingClientRect(),c=cell.getBoundingClientRect(),s=getComputedStyle(cell);const left=c.left+parseFloat(s.paddingLeft),right=c.right-parseFloat(s.paddingRight);return r.left<left-1||r.right>right+1?[{tag:e.tagName,text:e.textContent.slice(0,40),left:r.left,right:r.right,cellLeft:left,cellRight:right}]:[];});
   const heading=service?.querySelector('h3')?.getBoundingClientRect(),reference=service?.parentElement.querySelector('.customer-properties h3')?.getBoundingClientRect();
   const inset=heading&&reference?Math.round(heading.left-reference.left):0;
   const tallHeaders=[...main.querySelectorAll('.customer-detail-sections th, .customer-service-history ~ div th')].filter(e=>e.getBoundingClientRect().height>96).length;
   return {width:w,cellControls,layoutViewport:innerWidth,serviceHeadingInset:inset,tallHeaders,nested,document:document.documentElement.scrollWidth,bodyOverflow:getComputedStyle(document.body).overflowX,main:{left:mr.left,right:mr.right,contentLeft:left,contentRight:right},service:sr?{left:sr.left,right:sr.right,width:sr.width}:null,bad:bad.slice(0,25)};
  })()`);
  const result={scenario:name,...data};results.push(result);
  const fail=data.document>data.width+1||data.bad.length||data.cellControls.length||data.nested.length||data.serviceHeadingInset!==0||data.tallHeaders||(!baseline&&['hidden','clip'].includes(data.bodyOverflow));
  if(fail){failures++;console.log('LAYOUT FAILURE '+JSON.stringify(result));}
  else console.log('PASS '+name+' @ '+data.width+'px');
 }
 async function matrix(name,screenshot=false,interaction=null){for(const width of widths){await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<768});await inspect(name,width);if(interaction)await interaction();if(capture&&screenshot){await mkdir(capture,{recursive:true});await evaluate(`document.querySelector('.customer-service-history')?.scrollIntoView({block:'center',behavior:'instant'})`);const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(path.join(capture,name+'-'+width+'.png'),Buffer.from(shot.data,'base64'));}}}
 // Expose any content previously concealed by body-level clipping. No source CSS is changed.
 if(baseline){if(process.env.RESPONSIVE_BASELINE_CSS){const css=await readFile(process.env.RESPONSIVE_BASELINE_CSS,'utf8');await evaluate(`(()=>{const s=document.querySelector('style[data-vite-dev-id$="/src/styles.css"]');if(!s)throw Error('Stylesheet missing');s.textContent=${JSON.stringify(css)};})()`);}await evaluate(`document.body.style.overflowX='visible'`);}
 await matrix('customer-empty',true);
 await clickText('Review',"document.querySelector('.roofr-measurements')");await matrix('roofr-review');await clickText('20%+',"document.querySelector('.roofr-measurements')");await matrix('roofr-custom-waste');await clickText('Close review',"document.querySelector('.roofr-measurements')");
 await clickText('+ Add service record');await matrix('service-form');
 await clickText('+ Add property');await matrix('property-and-service-forms');
 await clickText('Edit customer');await matrix('customer-edit');
 // Reload fixture to exercise a populated service table and the rest of the workspace.
 populated=true;await clickText('Close details');await clickText('Responsive Test Customer');await matrix('customer-populated');
 const nav=await evaluate(`[...document.querySelectorAll('.main-nav button')].map(e=>e.textContent.replace(/^[^A-Za-z]+/,'').trim())`);
 for(const label of nav){await clickElement(`[...document.querySelectorAll('.main-nav button')].find(e=>e.textContent.replace(/^[^A-Za-z]+/,'').trim()===${JSON.stringify(label)})`);await new Promise(r=>setTimeout(r,150));await matrix('workspace-'+label.replaceAll(' ','-').toLowerCase());
  if(label==='Leads'){
   await clickText('Website attachments');await wait(()=>evaluate('document.body.textContent.includes("Download synthetic.png")'),'attachment manifest');
   const before=requests.filter(n=>n==='crm_website_attachment').length;
   await matrix('lead-attachment-controls',false,()=>clickText('Download synthetic.png (1 KB)'));
   await wait(()=>requests.filter(n=>n==='crm_website_attachment').length===before+widths.length,'attachment controls at all widths');
  }
  if(label==='Project Pipeline'){
   const has=await evaluate('!!document.querySelector(".pipeline-card-main,.pipeline-list-link")');
   if(has){await clickElement('document.querySelector(".pipeline-card-main,.pipeline-list-link")');await wait(()=>evaluate('!!document.querySelector(".project-detail")'),'project detail');await matrix('project-detail');
    for(const action of ['+ Add expense','Add supplement']){const found=await evaluate(`[...document.querySelectorAll('.project-detail button')].some(e=>e.textContent.trim()===${JSON.stringify(action)})`);if(found){await clickText(action,"document.querySelector('.project-detail')");await matrix('project-'+action.replaceAll(' ','-').toLowerCase());}}
   }
  }
  const add=await evaluate(`[...document.querySelectorAll('.main-area button')].filter(e=>/^\\+ (Add|New|Create)/.test(e.textContent.trim())).map(e=>e.textContent.trim())`);
  if(add[0]){await clickText(add[0],"document.querySelector('.main-area')");await matrix('form-'+label.replaceAll(' ','-').toLowerCase());}
 }
 if(capture)await writeFile(path.join(capture,'measurements.json'),JSON.stringify(results,null,2));
 if(!baseline)assert(results.every(r=>r.width===r.layoutViewport||r.layoutViewport<=r.width),'Mobile layout viewport expanded beyond the requested device width');
 assert.equal(errors.length,0,'Browser runtime errors: '+errors.join(', '));
 if(!baseline)assert.equal(failures,0,failures+' responsive checks failed');
 console.log('Rendered '+results.length+' scenarios/widths; '+failures+' failing checks'+(baseline?' (baseline diagnostic)':''));
}finally{
 for(const ws of sockets)ws.close();await Promise.all(children.map(p=>new Promise(r=>{if(p.exitCode!==null)return r();p.once('exit',r);p.kill('SIGTERM');})));
 await rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
