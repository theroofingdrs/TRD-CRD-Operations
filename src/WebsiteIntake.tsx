import OperationalNotifications from "./OperationalNotifications";
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
type Receipt = {submission_key:string; received_at:string; status:string; attempts:number; matching:string|null; error_code:string|null; error_message:string|null; notifications?:Record<string,string>};
export default function WebsiteIntake({division}:{division:'TRD'|'CRD'}) {
 const [details,setDetails]=useState<Record<string,unknown>>({});
 const [page,setPage]=useState(0);
 const [rows,setRows]=useState<Receipt[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{
  if(!supabase)return;setBusy(true);
  const {data,error}=await supabase.rpc('crm_website_intake_status',{p_division:division,p_offset:page*100});
  if(error)setMessage('Intake status unavailable: '+error.message);else{setRows(data??[]);setMessage('');}setBusy(false);
 },[division,page]);
 useEffect(()=>{void load();},[load]);
 async function inspect(key:string){if(!supabase)return;const {data,error}=await supabase.rpc('crm_website_intake_details',{p_division:division,p_key:key});if(error)setMessage(error.message);else setDetails(current=>({...current,[key]:data}));}
 async function retry(key:string){
  if(!supabase||busy)return;setBusy(true);
  const {data,error}=await supabase.rpc('crm_retry_website_lead',{p_division:division,p_key:key});
  await load();
  if(error||!data?.ok)setMessage(error?.message||'Recovery did not complete. Review the saved error and retry after correcting the dependency.');
 }
 return <><section className="panel"><div className="panel-heading"><div><h2>Website intake</h2><p className="muted">New inquiries reach this division automatically. Failed receipts retain their original details for recovery.</p></div><button className="secondary-button" disabled={busy} onClick={()=>void load()}>Refresh status</button></div>{message&&<p role="alert" className="inline-message">{message}</p>}{rows.length>0?<div className="table-wrap"><table><thead><tr><th>Received</th><th>Status</th><th>Attempts</th><th>Matching / recovery</th><th>Notifications</th></tr></thead><tbody>{[...rows].sort((a,b)=>Number(b.status==='failed')-Number(a.status==='failed')).map(row=><tr key={row.submission_key}><td>{new Date(row.received_at).toLocaleString()}<span className="subline">{row.submission_key}</span></td><td>{row.status}</td><td>{row.attempts}</td><td>{row.error_code?<><span role="alert">{row.error_code}: {row.error_message}</span><button className="secondary-button" disabled={busy} onClick={()=>void retry(row.submission_key)}>Retry saved inquiry</button></>:row.matching?.replaceAll('_',' ')}<button className="text-button" onClick={()=>void inspect(row.submission_key)}>Review saved inquiry</button>{details[row.submission_key]!==undefined&&<pre style={{whiteSpace:'pre-wrap',maxWidth:400}}>{JSON.stringify(details[row.submission_key],null,2)}</pre>}</td><td>{Object.entries(row.notifications??{}).map(([kind,status])=><span className="subline" key={kind}>{kind}: {status}</span>)}</td></tr>)}</tbody></table></div>:<p className="muted">No intake receipts are available yet.</p>}<div className="button-row"><button className="secondary-button" disabled={busy||page===0} onClick={()=>setPage(page-1)}>Previous</button><span>Page {page+1} · Failed inquiries first</span><button className="secondary-button" disabled={busy||rows.length<100} onClick={()=>setPage(page+1)}>Next</button></div></section><OperationalNotifications key={division} division={division}/></>;
}
