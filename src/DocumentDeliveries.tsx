import { useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
type DivisionId = "TRD" | "CRD";
type Delivery = { id: string; document_type: string; document_id: string; recipient_email: string; subject: string; status: string; authority: string; provider_last_event: string | null; error_message: string | null; sent_at: string | null; created_at: string };
export default function DocumentDeliveries({ division, canReconcile = false }: { division: DivisionId; canReconcile?: boolean }) {
  const [rows,setRows]=useState<Delivery[]>([]);
  const [message,setMessage]=useState("");
  const load=useCallback(async()=>{
    if(!supabase)return;
    const {data,error}=await supabase.from("crm_document_deliveries").select("id,document_type,document_id,recipient_email,subject,status,authority,provider_last_event,error_message,sent_at,created_at").eq("division_id",division).order("created_at",{ascending:false}).limit(100);
    if(error)setMessage(error.message);
    setRows((data??[]) as Delivery[]);
  },[division]);
  useEffect(()=>{void load();},[load]);
  return <div className="content-stack"><section className="panel"><p className="eyebrow">{division} DOCUMENTS</p><h2>Customer delivery history</h2><p className="muted">Provider acceptance is not confirmed recipient delivery. Legacy entries are unverified. Uncertain outcomes must be reconciled without starting a new send.</p>{message&&<p className="inline-message">{message}</p>}
  {rows.length?<div className="table-wrap"><table><thead><tr><th>Document</th><th>Recipient</th><th>Subject</th><th>Status</th><th>Sent</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td>{row.document_type}<small>{row.document_id.slice(0,8)}</small></td><td>{row.recipient_email}</td><td>{row.subject}</td><td><span className={"pill "+row.status}>{row.status}</span><small>{row.authority === "server" ? "Server recorded" : "Legacy — unverified"}</small>{row.provider_last_event && <small>Provider event: {row.provider_last_event}</small>}{row.error_message&&<small>{row.error_message}</small>}{canReconcile && row.authority === "server" && <button onClick={async () => {
      if (!supabase) return;
      const providerId = window.prompt("Existing provider email ID from verified provider logs. This will not send another email.");
      if (!providerId) return;
      const evidence = window.prompt("Evidence reference for this operation's provider-log match (no secrets).");
      if (!evidence || evidence.trim().length < 3) return;
      const { data, error } = await supabase.functions.invoke("crm-send-document", { body: { action: "reconcile", delivery_id: row.id, provider_id: providerId, evidence } });
      setMessage(error?.message || data?.error || "Provider record reconciled. No email was sent.");
      if (!error && !data?.error) await load();
    }}>Verify existing provider message</button>}</td><td>{row.sent_at?new Date(row.sent_at).toLocaleString():"Not sent"}</td></tr>)}</tbody></table></div>:<div className="empty-state">No customer documents have been emailed from this division yet.</div>}
  </section></div>;
}
