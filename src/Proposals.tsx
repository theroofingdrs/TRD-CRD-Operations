import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";

type DivisionId = "TRD" | "CRD";
type Customer = { id: string; display_name: string; email: string | null };
type Property = { id: string; customer_id: string; address_line1: string; city: string; state: string };
type Proposal = { id: string; title: string; status: string; pricing_mode: string; total_amount: number; created_at: string; customer_id: string; property_id: string };

export default function Proposals({ division, userId, canWrite }: { division: DivisionId; userId: string; canWrite: boolean }) {
  const [rows, setRows] = useState<Proposal[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [title, setTitle] = useState("");
  const [pricingMode, setPricingMode] = useState("both");
  const [lumpSum, setLumpSum] = useState("");
  const [lineDescription, setLineDescription] = useState("");
  const [lineAmount, setLineAmount] = useState("");
  const [scope, setScope] = useState("");
  const [conditions, setConditions] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("Due upon completion unless otherwise stated in writing.");
  const [validUntil, setValidUntil] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    if (!supabase) return;
    const [proposalResult, customerResult] = await Promise.all([
      supabase.from("crm_proposals").select("id,title,status,pricing_mode,total_amount,created_at,customer_id,property_id").eq("division_id", division).order("created_at", { ascending: false }),
      supabase.from("crm_customer_divisions").select("customer_id,crm_customers(id,display_name,email)").eq("division_id", division)
    ]);
    if (proposalResult.error) setMessage(proposalResult.error.message);
    setRows((proposalResult.data ?? []) as Proposal[]);
    const customerRows = (customerResult.data ?? []).flatMap((item: any) => item.crm_customers ? [item.crm_customers] : []);
    setCustomers(customerRows as Customer[]);
    const { data: propertyRows, error } = await supabase.from("crm_properties").select("id,customer_id,address_line1,city,state").in("customer_id", customerRows.map((item: Customer) => item.id)).order("address_line1");
    if (error) setMessage(error.message);
    setProperties((propertyRows ?? []) as Property[]);
  }, [division]);
  useEffect(() => { void load(); }, [load]);
  const customerProperties = properties.filter((item) => item.customer_id === customerId);

  async function saveProposal(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !customerId || !propertyId) return;
    setBusy(true); setMessage("");
    const itemAmount = Number(lineAmount || 0);
    const lumpAmount = Number(lumpSum || 0);
    const subtotal = pricingMode === "lump_sum" ? lumpAmount : pricingMode === "itemized" ? itemAmount : itemAmount;
    const total = pricingMode === "lump_sum" ? lumpAmount : subtotal;
    const lineItems = pricingMode === "lump_sum" ? [] : lineDescription.trim() ? [{ description: lineDescription.trim(), quantity: 1, unit_price: itemAmount, amount: itemAmount }] : [];
    const { error } = await supabase.from("crm_proposals").insert({
      division_id: division, customer_id: customerId, property_id: propertyId, title: title.trim(),
      pricing_mode: pricingMode, line_items: lineItems, lump_sum_amount: pricingMode === "itemized" ? null : lumpAmount,
      subtotal, tax_amount: 0, total_amount: total, scope_of_work: scope || null,
      existing_conditions: conditions || null, exclusions: exclusions || null,
      payment_terms: paymentTerms || null, valid_until: validUntil || null, created_by: userId,
      template_data: { template: division === "TRD" ? "residential_standard_v1" : "commercial_standard_v1" }
    });
    if (error) setMessage(error.message);
    else {
      setMessage("Proposal draft saved to this customer and property.");
      setShowForm(false); setTitle(""); setScope(""); setConditions(""); setExclusions(""); setLineDescription(""); setLineAmount(""); setLumpSum("");
      await load();
    }
    setBusy(false);
  }

  return <div className="content-stack"><section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">{division} PROPOSALS</p><h2>{division === "TRD" ? "Residential proposals" : "Commercial proposals"}</h2><p className="muted">Create and retain editable proposal drafts by customer and property. PDF delivery and email are the next stage.</p></div>{canWrite && <button className="primary-button compact" onClick={() => setShowForm(!showForm)}>{showForm ? "Close form" : "+ New proposal"}</button>}</div>
    {showForm && <form className="inline-form" onSubmit={saveProposal}><div className="form-grid">
      <label className="wide">Customer<select required value={customerId} onChange={e => { setCustomerId(e.target.value); setPropertyId(""); }}><option value="">Select customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}</select></label>
      <label className="wide">Property<select required value={propertyId} onChange={e => setPropertyId(e.target.value)}><option value="">Select property</option>{customerProperties.map(p => <option key={p.id} value={p.id}>{p.address_line1}, {p.city}, {p.state}</option>)}</select></label>
      <label className="wide">Proposal title<input required value={title} onChange={e => setTitle(e.target.value)} placeholder={division === "TRD" ? "Residential roof replacement proposal" : "Commercial roof restoration proposal"} /></label>
      <label>Pricing format<select value={pricingMode} onChange={e => setPricingMode(e.target.value)}><option value="both">Itemized and lump sum</option><option value="itemized">Itemized only</option><option value="lump_sum">Lump sum only</option></select></label>
      {pricingMode !== "lump_sum" && <><label>Initial line item<input value={lineDescription} onChange={e => setLineDescription(e.target.value)} placeholder="Labor, materials, tear off..." /></label><label>Line item amount ($)<input type="number" min="0" step="0.01" value={lineAmount} onChange={e => setLineAmount(e.target.value)} /></label></>}
      {pricingMode !== "itemized" && <label>Lump sum amount ($)<input type="number" min="0" step="0.01" value={lumpSum} onChange={e => setLumpSum(e.target.value)} /></label>}
      <label>Valid through<input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} /></label>
      <label className="wide">Existing conditions<textarea rows={2} value={conditions} onChange={e => setConditions(e.target.value)} /></label>
      <label className="wide">Scope of work<textarea rows={4} value={scope} onChange={e => setScope(e.target.value)} placeholder={division === "TRD" ? "Describe tear off, decking, underlayment, flashing, roofing material, ventilation and cleanup." : "Describe roof sections, system, preparation, insulation, membrane or coating, details, access and phasing."} /></label>
      <label className="wide">Exclusions<textarea rows={2} value={exclusions} onChange={e => setExclusions(e.target.value)} /></label>
      <label className="wide">Payment terms<textarea rows={2} value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} /></label>
    </div><button className="primary-button" disabled={busy || !customers.length || !customerProperties.length}>{busy ? "Saving..." : "Save proposal draft"}</button></form>}
    {message && <p className="inline-message">{message}</p>}
    {rows.length ? <div className="table-wrap"><table><thead><tr><th>Proposal</th><th>Customer</th><th>Pricing</th><th>Total</th><th>Status</th><th>Created</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td><strong>{r.title}</strong></td><td>{customers.find(c => c.id === r.customer_id)?.display_name || "Customer"}</td><td>{r.pricing_mode.replaceAll("_"," ")}</td><td>{Number(r.total_amount || 0).toLocaleString("en-US",{style:"currency",currency:"USD"})}</td><td><span className={"pill " + r.status}>{r.status.replaceAll("_"," ")}</span></td><td>{new Date(r.created_at).toLocaleDateString()}</td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>No proposal drafts yet</strong><span>Saved proposals will appear here and remain associated with their customer and property.</span></div>}
  </section></div>;
}
