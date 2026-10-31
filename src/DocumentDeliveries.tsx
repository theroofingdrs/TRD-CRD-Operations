import { useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
type DivisionId = "TRD" | "CRD";
type Delivery = { id: string; document_type: string; document_id: string; recipient_email: string; subject: string; status: string; error_message: string | null; sent_at: string | null; created_at: string };
export default function DocumentDeliveries({ division }: { division: DivisionId }) {
  const [rows,setRows]=useState<Delivery[]>([]);
  const [message,setMessage]=useState("");
  const load=useCallback(async()=>{
    if(!supabase)return;
    const {data,error}=await supabase.from("crm_document_deliveries").select("id,document_type,document_id,recipient_email,subject,status,error_message,sent_at,created_at").eq("division_id",division).order("created_at",{ascending:false}).limit(100);
    if(error)setMessage(error.message);
    setRows((data??[]) as Delivery[]);
  },[division]);
  useEffect(()=>{void load();},[load]);
  return <div className="content-stack"><section className="panel"><p className="eyebrow">{division} DOCUMENTS</p><h2>Customer delivery history</h2><p className="muted">PDF email attempts and delivery status for this division.</p>{message&&<p className="inline-message">{message}</p>}
  {rows.length?<div className="table-wrap"><table><thead><tr><th>Document</th><th>Recipient</th><th>Subject</th><th>Status</th><th>Sent</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.document_type}<small>{row.document_id.slice(0,8)}</small></td><td>{row.recipient_email}</td><td>{row.subject}</td><td><span className={"pill "+row.status}>{row.status}</span>{row.error_message&&<small>{row.error_message}</small>}</td><td>{row.sent_at?new Date(row.sent_at).toLocaleString():"Not sent"}</td></tr>)}</tbody></table></div>:<div className="empty-state">No customer documents have been emailed from this division yet.</div>}
  </section></div>;
}
