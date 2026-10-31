import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { estimateCatalog, estimateCatalogCategories } from "./estimateCatalog";

type DivisionId = "TRD" | "CRD";
type Customer = { id: string; display_name: string; email: string | null };
type Property = { id: string; customer_id: string; address_line1: string; city: string; state: string };
type LineItem = { description: string; quantity: string; unit: string; unit_price: string };
type RoofrMeasurement = { label: string; value: number; unit: string };
type RoofrReport = { id: string; original_filename: string; created_at: string; metadata: { extraction_status?: string; extracted_measurements?: RoofrMeasurement[] } | null };
type Proposal = { id: string; title: string; status: string; pricing_mode: string; total_amount: number; lump_sum_amount: number | null; created_at: string; customer_id: string; property_id: string };

export default function Proposals({ division, userId, canWrite }: { division: DivisionId; userId: string; canWrite: boolean }) {
  const [rows, setRows] = useState<Proposal[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [roofrReports, setRoofrReports] = useState<RoofrReport[]>([]);
  const [title, setTitle] = useState("");
  const [pricingMode, setPricingMode] = useState("both");
  const [lumpSum, setLumpSum] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: "", quantity: "1", unit: "EA", unit_price: "" }]);
  const [taxRate, setTaxRate] = useState("0");
  const [catalogCategory, setCatalogCategory] = useState(estimateCatalogCategories[0] || "Roofing systems and accessories");
  const [catalogSelection, setCatalogSelection] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [scope, setScope] = useState("");
  const [conditions, setConditions] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("Due upon completion unless otherwise stated in writing.");
  const [validUntil, setValidUntil] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sendingId, setSendingId] = useState("");
  const load = useCallback(async () => {
    if (!supabase) return;
    const [proposalResult, customerResult] = await Promise.all([
      supabase.from("crm_proposals").select("id,title,status,pricing_mode,total_amount,lump_sum_amount,created_at,customer_id,property_id").eq("division_id", division).order("created_at", { ascending: false }),
      supabase.from("crm_customer_divisions").select("customer_id,crm_customers(id,display_name,email)").eq("division_id", division)
    ]);
    if (proposalResult.error) setMessage(proposalResult.error.message);
    setRows((proposalResult.data ?? []) as Proposal[]);
    const customerRows = (customerResult.data ?? []).flatMap((item: any) => item.crm_customers ? [item.crm_customers] : []);
    setCustomers(customerRows as Customer[]);
    if (customerRows.length) {
      const { data, error } = await supabase.from("crm_properties").select("id,customer_id,address_line1,city,state").in("customer_id", customerRows.map((item: Customer) => item.id)).order("address_line1");
      if (error) setMessage(error.message);
      setProperties((data ?? []) as Property[]);
    } else { setProperties([]); }
  }, [division]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let active = true;
    async function loadRoofrReports() {
      if (!supabase || !propertyId) { setRoofrReports([]); return; }
      const { data, error } = await supabase.from("crm_files")
        .select("id,original_filename,created_at,metadata")
        .eq("division_id", division).eq("related_type", "property").eq("related_id", propertyId)
        .order("created_at", { ascending: false });
      if (!active) return;
      if (error) { setMessage(error.message); setRoofrReports([]); return; }
      setRoofrReports(((data || []) as RoofrReport[]).filter(report => report.metadata?.document_type === "roofr_measurement_report" && report.metadata?.extraction_status === "reviewed" && (report.metadata?.extracted_measurements || []).length > 0));
    }
    void loadRoofrReports();
    return () => { active = false; };
  }, [division, propertyId]);
  const customerProperties = properties.filter((item) => item.customer_id === customerId);
  const catalogMatches = estimateCatalog.filter(item => item.category === catalogCategory && (!catalogSearch.trim() || item.description.toLowerCase().includes(catalogSearch.trim().toLowerCase())));
  const itemSubtotal = lineItems.reduce((sum, item) => sum + Math.max(0, Number(item.quantity || 0)) * Math.max(0, Number(item.unit_price || 0)), 0);
  const subtotal = pricingMode === "lump_sum" ? Number(lumpSum || 0) : itemSubtotal;
  const taxAmount = subtotal * Math.max(0, Number(taxRate || 0)) / 100;
  const total = subtotal + taxAmount;
  function updateLine(index: number, patch: Partial<LineItem>) {
    setLineItems(current => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  }
  function importRoofrMeasurements(report: RoofrReport) {
    const measurements = report.metadata?.extracted_measurements || [];
    if (!measurements.length) return;
    setLineItems(current => {
      const existing = new Set(current.map(item => item.description.trim().toLowerCase()));
      const imported = measurements.filter(item => !existing.has((item.label + " from Roofr").toLowerCase())).map(item => ({ description: item.label + " from Roofr", quantity: String(item.value), unit: item.unit, unit_price: "" }));
      return [...current.filter(item => item.description.trim() || item.unit_price.trim()), ...imported];
    });
    setMessage("Reviewed Roofr quantities added as new estimate lines. Existing line items were left unchanged.");
  }
  function addCatalogItem() {
    const selected = estimateCatalog.find(item => item.description === catalogSelection && item.category === catalogCategory);
    if (!selected) return;
    setLineItems(current => [...current, { description: selected.description, quantity: "1", unit: selected.unit, unit_price: "" }]);
    setCatalogSelection("");
  }
  async function sendPdf(id: string) {
    if (!supabase) return;
    setSendingId(id); setMessage("");
    const { data, error } = await supabase.functions.invoke("crm-send-document", { body: { document_type: "proposal", document_id: id } });
    setMessage(error?.message || data?.error || (data?.success ? "PDF emailed to " + data.recipient : "Document email could not be sent."));
    setSendingId("");
  }
  async function saveProposal(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !customerId || !propertyId) return;
    if (pricingMode !== "lump_sum" && !lineItems.some(item => item.description.trim())) {
      setMessage("Add at least one described line item for itemized pricing."); return;
    }
    if (pricingMode !== "itemized" && !(Number(lumpSum) > 0)) {
      setMessage("Enter the lump sum amount."); return;
    }
    setBusy(true); setMessage("");
    const savedItems = pricingMode === "lump_sum" ? [] : lineItems.filter(item => item.description.trim()).map(item => ({
      description: item.description.trim(), quantity: Number(item.quantity || 1), unit: item.unit || "EA", unit_price: Number(item.unit_price || 0),
      amount: Number(item.quantity || 1) * Number(item.unit_price || 0)
    }));
    const { error } = await supabase.from("crm_proposals").insert({
      division_id: division, customer_id: customerId, property_id: propertyId, title: title.trim(),
      pricing_mode: pricingMode, line_items: savedItems, lump_sum_amount: pricingMode === "itemized" ? null : Number(lumpSum),
      subtotal, tax_amount: taxAmount, total_amount: total, scope_of_work: scope || null,
      existing_conditions: conditions || null, exclusions: exclusions || null, payment_terms: paymentTerms || null,
      valid_until: validUntil || null, created_by: userId,
      template_data: { template: division === "TRD" ? "residential_standard_v1" : "commercial_standard_v1", tax_rate_percent: Number(taxRate || 0) }
    });
    if (error) setMessage(error.message);
    else {
      setMessage("Proposal draft saved to this customer and property.");
      setShowForm(false); setTitle(""); setScope(""); setConditions(""); setExclusions(""); setLumpSum("");
      setLineItems([{ description: "", quantity: "1", unit: "EA", unit_price: "" }]); setTaxRate("0"); setValidUntil("");
      await load();
    }
    setBusy(false);
  }
  return <div className="content-stack"><section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">{division} PROPOSALS</p><h2>{division === "TRD" ? "Residential proposals" : "Commercial proposals"}</h2><p className="muted">Create and retain editable proposal drafts by customer and property. PDF delivery is available through the customer email action when the mail service is configured.</p></div>{canWrite && <button type="button" className="primary-button compact" onClick={() => setShowForm(!showForm)}>{showForm ? "Close form" : "+ New proposal"}</button>}</div>
    {showForm && <form className="inline-form" onSubmit={saveProposal}><div className="form-grid">
      <label className="wide">Customer<select required value={customerId} onChange={e => { setCustomerId(e.target.value); setPropertyId(""); }}><option value="">Select customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}</select></label>
      <label className="wide">Property<select required value={propertyId} onChange={e => setPropertyId(e.target.value)}><option value="">Select property</option>{customerProperties.map(p => <option key={p.id} value={p.id}>{p.address_line1}, {p.city}, {p.state}</option>)}</select></label>
      {propertyId && <div className="wide"><h3>Roofr measurement import</h3>{roofrReports.length ? roofrReports.map(report => <div className="button-row" key={report.id}><span>{report.original_filename} · {new Date(report.created_at).toLocaleDateString()}</span><button type="button" className="secondary-button" onClick={() => importRoofrMeasurements(report)}>Add reviewed measurements to estimate</button></div>) : <p className="muted">No reviewed Roofr measurements are saved for this property yet. Upload and review a report in the customer record first.</p>}</div>}
      <label className="wide">Proposal title<input required value={title} onChange={e => setTitle(e.target.value)} placeholder={division === "TRD" ? "Residential roof replacement proposal" : "Commercial roof restoration proposal"} /></label>
      <label className="wide">Pricing format<select value={pricingMode} onChange={e => setPricingMode(e.target.value)}><option value="both">Show itemized and lump sum options</option><option value="itemized">Itemized only</option><option value="lump_sum">Lump sum only</option></select></label>
      {pricingMode !== "lump_sum" && <div className="wide"><h3>Itemized pricing</h3><div className="form-grid"><label>Catalog category<select value={catalogCategory} onChange={e => { setCatalogCategory(e.target.value); setCatalogSelection(""); }}>{estimateCatalogCategories.map(category => <option key={category} value={category}>{category}</option>)}</select></label><label>Search catalog<input value={catalogSearch} onChange={e => { setCatalogSearch(e.target.value); setCatalogSelection(""); }} placeholder="Search roof, tarp, magnet, hand load..." /></label><label className="wide">Catalog item<select value={catalogSelection} onChange={e => setCatalogSelection(e.target.value)}><option value="">Choose a standard estimate item</option>{catalogMatches.map(item => <option key={item.description} value={item.description}>{item.description} ({item.unit})</option>)}</select></label><button type="button" className="secondary-button" disabled={!catalogSelection} onClick={addCatalogItem}>+ Add catalog item</button></div><p className="muted">Starter reference catalog only. Descriptions and units are editable. Enter pricing from your current estimate or authorized price list. No Xactimate codes or prices are represented as official.</p>{lineItems.map((item,index) => <div className="form-grid" key={index}><label className="wide">Description<input required value={item.description} onChange={e => updateLine(index,{description:e.target.value})} placeholder="Labor, materials, tear off, decking..." /></label><label>Quantity<input type="number" min="0" step="0.01" value={item.quantity} onChange={e => updateLine(index,{quantity:e.target.value})} /></label><label>Unit<select value={item.unit} onChange={e => updateLine(index,{unit:e.target.value})}><option>EA</option><option>SF</option><option>LF</option><option>SQ</option><option>HR</option><option>DAY</option><option>WK</option><option>MO</option><option>LS</option></select></label><label>Unit price ($)<input type="number" min="0" step="0.01" value={item.unit_price} onChange={e => updateLine(index,{unit_price:e.target.value})} /></label><p className="muted">Line total: {(Number(item.quantity || 0)*Number(item.unit_price || 0)).toLocaleString("en-US",{style:"currency",currency:"USD"})}</p></div>)}<button type="button" className="secondary-button" onClick={() => setLineItems(current => [...current,{description:"",quantity:"1",unit:"EA",unit_price:""}])}>+ Add line item</button></div>}
      {pricingMode !== "itemized" && <label>Lump sum amount ($)<input required type="number" min="0.01" step="0.01" value={lumpSum} onChange={e => setLumpSum(e.target.value)} /></label>}
      <label>Tax rate (%)<input type="number" min="0" step="0.01" value={taxRate} onChange={e => setTaxRate(e.target.value)} /></label>
      <label>Valid through<input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} /></label>
      <label className="wide">Existing conditions<textarea rows={2} value={conditions} onChange={e => setConditions(e.target.value)} /></label>
      <label className="wide">Scope of work<textarea rows={4} value={scope} onChange={e => setScope(e.target.value)} placeholder={division === "TRD" ? "Describe tear off, decking, underlayment, flashing, roofing material, ventilation and cleanup." : "Describe roof sections, system, preparation, insulation, membrane or coating, details, access and phasing."} /></label>
      <label className="wide">Exclusions<textarea rows={2} value={exclusions} onChange={e => setExclusions(e.target.value)} /></label>
      <label className="wide">Payment terms<textarea rows={2} value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} /></label>
      <div className="wide"><strong>Current estimate total: {total.toLocaleString("en-US",{style:"currency",currency:"USD"})}</strong>{pricingMode === "both" && <p className="muted">The lump sum is stored as an alternate price. The itemized total is used as the proposal's recorded total until the customer selects an option.</p>}</div>
    </div><button className="primary-button" disabled={busy || !customers.length || !customerProperties.length}>{busy ? "Saving..." : "Save proposal draft"}</button></form>}
    {message && <p className="inline-message">{message}</p>}
    {rows.length ? <div className="table-wrap"><table><thead><tr><th>Proposal</th><th>Customer</th><th>Pricing</th><th>Recorded total</th><th>Lump sum alternative</th><th>Status</th><th>Created</th><th>Action</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td><strong>{r.title}</strong></td><td>{customers.find(c => c.id === r.customer_id)?.display_name || "Customer"}</td><td>{r.pricing_mode.replaceAll("_"," ")}</td><td>{Number(r.total_amount || 0).toLocaleString("en-US",{style:"currency",currency:"USD"})}</td><td>{r.lump_sum_amount == null ? "—" : Number(r.lump_sum_amount).toLocaleString("en-US",{style:"currency",currency:"USD"})}</td><td><span className={"pill " + r.status}>{r.status.replaceAll("_"," ")}</span></td><td>{new Date(r.created_at).toLocaleDateString()}</td><td><button type="button" className="secondary-button" disabled={sendingId===r.id} onClick={()=>sendPdf(r.id)}>{sendingId===r.id?"Sending...":"Send PDF by email"}</button></td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>No proposal drafts yet</strong><span>Saved proposals will appear here and remain associated with their customer and property.</span></div>}
  </section></div>;
}
