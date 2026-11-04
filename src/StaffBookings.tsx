import {useCallback,useEffect,useState,useRef} from 'react';
import {supabase} from './lib/supabase';import{centralInstant,centralLabel}from'./lib/central-time';
const services=['roof-inspection','roof-repair-estimate','roof-replacement-estimate','storm-damage-inspection','insurance-claim-inspection'];
type Booking={request_key:string;lead_id:string;appointment_id:string|null;status:string;start_at:string;end_at:string};
export default function StaffBookings({division,canWrite}:{division:'TRD'|'CRD';canWrite:boolean}){
 const[rows,setRows]=useState<Booking[]>([]),[enabled,setEnabled]=useState(false),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[start,setStart]=useState('');
 const[leads,setLeads]=useState<{id:string;service_interest:string|null}[]>([]),[lead,setLead]=useState(''),[service,setService]=useState(services[0]),[mode,setMode]=useState('on-site');
 const submission=useRef<{fingerprint:string;key:string}|null>(null);
 const load=useCallback(async()=>{if(!supabase||!canWrite)return;const{data,error}=await supabase.rpc('crm_staff_booking_status',{p_division:division});if(error){setMessage('Calendar status unavailable. Manual appointments remain below.');return;}setEnabled(data?.enabled===true);setRows(data?.bookings??[]);if(data?.enabled){const{data:options}=await supabase.from("crm_leads").select("id,service_interest").eq("division_id",division).not("status","in","(won,lost)").limit(100);setLeads(options??[]);}},[division,canWrite]);
 useEffect(()=>{void load();},[load]);
 async function change(row:Booking,action:'cancel'|'reschedule'|'reconcile'){
  if(!supabase||!enabled||busy)return;setBusy(true);setMessage('');
  try{const{data}=await supabase.auth.getSession();if(!data.session)throw Error('Sign in again.');
   const result=await fetch('https://theroofingdrs.com/commercial/api/staff/booking',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token},body:JSON.stringify({action,division,key:row.request_key,...(action==='reschedule'?{start:centralInstant(start)}:{})}),signal:AbortSignal.timeout(60000),redirect:'error'});
   const response=await result.json();if(!result.ok)throw Error(response.error||'Calendar operation unresolved.');setMessage('Calendar status: '+response.status+'. Notification delivery is tracked separately.');await load();
  }catch(error){setMessage((error as Error).message);}finally{setBusy(false);}
 }
 async function book(){
  if(!supabase||!enabled||busy)return;setBusy(true);setMessage('');
  try{
   const details={division,lead,service,mode,start:centralInstant(start)};const fingerprint=JSON.stringify(details);
   if(submission.current?.fingerprint!==fingerprint)submission.current={fingerprint,key:crypto.randomUUID()};
   const{data}=await supabase.auth.getSession();if(!data.session)throw Error('Sign in again.');
   const result=await fetch('https://theroofingdrs.com/commercial/api/staff/booking',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+data.session.access_token},body:JSON.stringify({action:'book',key:submission.current.key,...details}),signal:AbortSignal.timeout(60000),redirect:'error'});
   const response=await result.json();if(!result.ok)throw Error('Booking unresolved. Retain reference '+submission.current.key+' and check provider evidence before retrying.');
   setMessage('Booking status: '+response.status+'. Reference: '+submission.current.key);await load();
  }catch(error){setMessage((error as Error).message);}finally{setBusy(false);}
 }
 if(!canWrite)return null;
 return <section className="panel"><div className="panel-heading"><div><h2>Calendar bookings</h2><p className="muted">{enabled?'Provider-linked bookings use Central Time.':'Live calendar booking remains disabled. Use manual CRM appointments below.'}</p></div><button className="secondary-button" onClick={()=>void load()}>Refresh calendar status</button></div>{message&&<p role="status">{message}</p>}{enabled&&<div className="form-grid"><label>Lead<select value={lead} onChange={e=>setLead(e.target.value)}><option value="">Select a lead</option>{leads.map(item=><option key={item.id} value={item.id}>{item.service_interest||'Roofing inquiry'} · {item.id}</option>)}</select></label><label>Service<select value={service} onChange={e=>setService(e.target.value)}>{services.map(item=><option key={item} value={item}>{item.replaceAll('-',' ')}</option>)}</select></label><label>Mode<select value={mode} onChange={e=>setMode(e.target.value)}><option value="on-site">On site</option><option value="phone">Phone</option></select></label><label>Start (Central Time)<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label><button className="primary-button" disabled={busy||!lead||!start} onClick={()=>void book()}>Book through verified calendar</button></div>}{rows.length>0&&<><label>New start for rescheduling (Central Time)<input type="datetime-local" value={start} onChange={e=>setStart(e.target.value)}/></label><div className="table-wrap"><table><thead><tr><th>Reference</th><th>Reserved interval (Central)</th><th>Status</th><th>Actions</th></tr></thead><tbody>{rows.map(row=><tr key={row.request_key}><td>{row.request_key}<span className="subline">Lead: {row.lead_id}</span></td><td>{centralLabel(row.start_at)} – {centralLabel(row.end_at)}</td><td>{row.status}</td><td>{row.status==='confirmed'?<><button disabled={!enabled||busy||!start} onClick={()=>void change(row,'reschedule')}>Reschedule</button><button disabled={!enabled||busy} onClick={()=>void change(row,'cancel')}>Cancel booking</button></>:['uncertain','reserved','changing'].includes(row.status)&&<button disabled={!enabled||busy} onClick={()=>void change(row,'reconcile')}>Check provider evidence</button>}</td></tr>)}</tbody></table></div></>}</section>;
}
