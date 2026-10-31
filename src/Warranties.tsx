import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";

type DivisionId = "TRD" | "CRD";
type Customer = { id: string; display_name: string };
type Property = { id: string; customer_id: string; address_line1: string; city: string; state: string };
type Warranty = { id: string; title: string; warranty_type: string; status: string; start_date: string | null; end_date: string | null; customer_id: string; property_id: string };

export default function Warranties({ division, userId, canWrite }: { division: DivisionId; userId: string; canWrite: boolean }) {
  const [customers,setCustomers]=useState<Customer[]>([]);
  const [properties,setProperties]=useState<Property[]>([]);
  const [rows,setRows]=useState<Warranty[]>([]);
  const [customerId,setCustomerId]=useState("");
  const [propertyId,setPropertyId]=useState("");
  const [title,setTitle]=useState("");
  const [type,setType]=useState("workmanship");
  const [provider,setProvider]=useState("");
  const [system,setSystem]=useState("");
  const [coverage,setCoverage]=useState("");
  const [exclusions,setExclusions]=useState("");
  const [maintenance,setMaintenance]=useState("");
  const [start,setStart]=useState("");
  const [end,setEnd]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [sendingId,setSendingId]=useState("");
  const load=useCallback(async()=>{
    if(!supabase)return;
    const [customerResult,warrantyResult]=await Promise.all([
      supabase.from("crm_customer_divisions").select("customer_id,crm_customers(id,display_name)").eq("division_id",division),
      supabase.from("crm_warranties").select("id,title,warranty_type,status,start_date,end_date,customer_id,property_id").eq("division_id",division).order("created_at",{ascending:false})
    ]);
    const list=(customerResult.data??[]).flatMap((row:any)=>row.crm_customers?[row.crm_customers]:[]);
    setCustomers(list as Customer[]);
    if(list.length){
      const {data,error}=await supabase.from("crm_properties").select("id,customer_id,address_line1,city,state").in("customer_id",list.map((c:Customer)=>c.id)).order("address_line1");
      if(error)setMessage(error.message);
      setProperties((data??[]) as Property[]);
    }else setProperties([]);
    if(warrantyResult.error)setMessage(warrantyResult.error.message);
    setRows((warrantyResult.data??[]) as Warranty[]);
  },[division]);
  useEffect(()=>{void load();},[load]);
  const options=properties.filter(p=>p.customer_id===customerId);
  async function sendPdf(id:string){
    if(!supabase)return;
    setSendingId(id);setMessage("");
    const {data,error}=await supabase.functions.invoke("crm-send-document",{body:{document_type:"warranty",document_id:id}});
    setMessage(error?.message||data?.error||(data?.success?"PDF emailed to "+data.recipient:"Document email could not be sent."));
    setSendingId("");
  }
  async function save(event:FormEvent){
    event.preventDefault(); if(!supabase||!customerId||!propertyId)return;
    setBusy(true);setMessage("");
    const {error}=await supabase.from("crm_warranties").insert({
      division_id:division,customer_id:customerId,property_id:propertyId,title:title.trim(),warranty_type:type,
      provider_name:provider||null,roof_system:system||null,coverage_summary:coverage||null,
      exclusions:exclusions||null,maintenance_requirements:maintenance||null,
      start_date:start||null,end_date:end||null,created_by:userId
    });
    if(error)setMessage(error.message);
    else{setMessage("Warranty record saved to this customer and property.");setTitle("");setProvider("");setSystem("");setCoverage("");setExclusions("");setMaintenance("");setStart("");setEnd("");setCustomerId("");setPropertyId("");await load();}
    setBusy(false);
  }
  return <div className="content-stack"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">{division} WARRANTY RECORDS</p><h2>{division==="TRD"?"Residential warranties":"Commercial warranties"}</h2><p className="muted">Create workmanship and manufacturer warranty records tied to the customer and property. Branded PDF generation and email delivery are the next document stage.</p></div></div>
  {canWrite&&<form className="inline-form" onSubmit={save}><div className="form-grid">
    <label className="wide">Customer<select required value={customerId} onChange={e=>{setCustomerId(e.target.value);setPropertyId("");}}><option value="">Select customer</option>{customers.map(c=><option key={c.id} value={c.id}>{c.display_name}</option>)}</select></label>
    <label className="wide">Property<select required value={propertyId} onChange={e=>setPropertyId(e.target.value)}><option value="">Select property</option>{options.map(p=><option key={p.id} value={p.id}>{p.address_line1}, {p.city}, {p.state}</option>)}</select></label>
    <label className="wide">Warranty title<input required value={title} onChange={e=>setTitle(e.target.value)} placeholder="Workmanship warranty" /></label>
    <label>Warranty type<select value={type} onChange={e=>setType(e.target.value)}><option value="workmanship">Workmanship</option><option value="manufacturer">Manufacturer</option><option value="system">Roof system</option><option value="other">Other</option></select></label>
    <label>Provider / manufacturer<input value={provider} onChange={e=>setProvider(e.target.value)} /></label>
    <label className="wide">Roof system<input value={system} onChange={e=>setSystem(e.target.value)} placeholder={division==="TRD"?"Architectural shingles, metal...":"TPO, PVC, EPDM, modified bitumen, coating, metal..."} /></label>
    <label className="wide">Coverage summary<textarea rows={3} value={coverage} onChange={e=>setCoverage(e.target.value)} /></label>
    <label className="wide">Exclusions<textarea rows={2} value={exclusions} onChange={e=>setExclusions(e.target.value)} /></label>
    <label className="wide">Maintenance requirements<textarea rows={2} value={maintenance} onChange={e=>setMaintenance(e.target.value)} /></label>
    <label>Start date<input type="date" value={start} onChange={e=>setStart(e.target.value)} /></label>
    <label>End date<input type="date" min={start||undefined} value={end} onChange={e=>setEnd(e.target.value)} /></label>
  </div><button className="primary-button" disabled={busy||!customers.length||!options.length}>{busy?"Saving...":"Save warranty record"}</button></form>}
  {message&&<p className="inline-message">{message}</p>}
  {rows.length?<div className="table-wrap"><table><thead><tr><th>Warranty</th><th>Customer</th><th>Type</th><th>Coverage dates</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td><strong>{row.title}</strong></td><td>{customers.find(c=>c.id===row.customer_id)?.display_name||"Customer"}</td><td>{row.warranty_type}</td><td>{row.start_date||"Not set"} to {row.end_date||"Open"}</td><td>{row.status}</td><td><button type="button" className="secondary-button" disabled={sendingId===row.id} onClick={()=>sendPdf(row.id)}>{sendingId===row.id?"Sending...":"Send PDF by email"}</button></td></tr>)}</tbody></table></div>:<div className="empty-state">No warranty records yet.</div>}
  </section></div>;
}
