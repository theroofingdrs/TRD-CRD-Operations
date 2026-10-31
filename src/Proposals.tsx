import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { estimateCatalog, estimateCatalogCategories } from "./estimateCatalog";

type DivisionId = "TRD" | "CRD";
type Customer = { id: string; display_name: string; email: string | null };
type Property = { id: string; customer_id: string; address_line1: string; city: string; state: string };
type LineItem = { description: string; quantity: string; unit: string; unit_price: string };
type RoofrMeasurement = { label: string; value: number; unit: string };
type RoofrReport = { id: string; original_filename: string; created_at: string; metadata: { document_type?: string; extraction_status?: string; extracted_measurements?: RoofrMeasurement[]; predominant_pitch?: string | null; pitch_distribution?: { pitch: string; area_sqft: number; squares: number }[] } | null };
type Proposal = { id: string; title: string; status: string; pricing_mode: string; total_amount: number; lump_sum_amount: number | null; created_at: string; customer_id: string; property_id: string };
type PriceBookEntry = { category: string; description: string; unit: string; unit_price: number | null; is_active: boolean };
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export default function Proposals({ division, userId, canWrite, initialCustomerId = "", initialPropertyId = "", onLaunchConsumed }: { division: DivisionId; userId: string; canWrite: boolean; initialCustomerId?: string; initialPropertyId?: string; onLaunchConsumed?: () => void }) {
  const [rows, setRows] = useState<Proposal[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [priceBookRows, setPriceBookRows] = useState<PriceBookEntry[]>([]);
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [propertyId, setPropertyId] = useState(initialPropertyId);
  const [roofrReports, setRoofrReports] = useState<RoofrReport[]>([]);
  const [selectedRoofrReportId, setSelectedRoofrReportId] = useState("");
  const [title, setTitle] = useState(initialPropertyId ? (division === "TRD" ? "Residential roof replacement proposal" : "Commercial roof replacement proposal") : "");
  const [pricingMode, setPricingMode] = useState("both");
  const [lumpSum, setLumpSum] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: "", quantity: "1", unit: "EA", unit_price: "" }]);
  const [taxRate, setTaxRate] = useState("0");
  const [overheadEnabled, setOverheadEnabled] = useState(true);
  const [profitEnabled, setProfitEnabled] = useState(true);
  const [catalogCategory, setCatalogCategory] = useState(estimateCatalogCategories[0] || "Roofing systems and accessories");
  const [catalogSelection, setCatalogSelection] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [scope, setScope] = useState("");
  const [conditions, setConditions] = useState("");
  const [exclusions, setExclusions] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("Due upon completion unless otherwise stated in writing.");
  const [warrantySummary, setWarrantySummary] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [wasteFactorPercent, setWasteFactorPercent] = useState("10");
  const [complexityFactor, setComplexityFactor] = useState("standard");
  const [pitchFactor, setPitchFactor] = useState("standard");
  const [showForm, setShowForm] = useState(Boolean(initialPropertyId));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sendingId, setSendingId] = useState("");
  const load = useCallback(async () => {
    if (!supabase) return;
    const [proposalResult, customerResult, templateResult, priceBookResult] = await Promise.all([
      supabase.from("crm_proposals").select("id,title,status,pricing_mode,total_amount,lump_sum_amount,created_at,customer_id,property_id").eq("division_id", division).order("created_at", { ascending: false }),
      supabase.from("crm_customer_divisions").select("customer_id,crm_customers(id,display_name,email)").eq("division_id", division),
      supabase.from("crm_proposal_templates").select("default_scope,default_exclusions,payment_terms,warranty_summary").eq("division_id", division).maybeSingle(),
      supabase.from("crm_price_book").select("category,description,unit,unit_price,is_active").eq("division_id",division).eq("is_active",true)
    ]);
    if (templateResult.data) {
      setScope(templateResult.data.default_scope || "");
      setExclusions(templateResult.data.default_exclusions || "");
      setPaymentTerms(templateResult.data.payment_terms || "");
      setWarrantySummary(templateResult.data.warranty_summary || "");
    }
    if (proposalResult.error) setMessage(proposalResult.error.message);
    if (priceBookResult.error) setMessage(priceBookResult.error.message);
    setPriceBookRows((priceBookResult.data || []) as PriceBookEntry[]);
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
  useEffect(() => { if (initialCustomerId && initialPropertyId) onLaunchConsumed?.(); }, []);
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
      const eligibleReports = ((data || []) as RoofrReport[]).filter(report => report.metadata?.document_type === "roofr_measurement_report" && report.metadata?.extraction_status === "reviewed" && (report.metadata?.extracted_measurements || []).length > 0);
      setRoofrReports(eligibleReports);
      if (eligibleReports.length === 1) {
        const report = eligibleReports[0];
        setSelectedRoofrReportId(report.id);
        const imported = (report.metadata?.extracted_measurements || []).filter(item => typeof item.value === "number" && Number.isFinite(item.value)).map(item => ({ description: item.label + " from Roofr", quantity: String(item.value), unit: item.unit === "FACETS" ? "EA" : item.unit, unit_price: "" }));
        setLineItems(current => [...current.filter(item => !item.description.toLowerCase().endsWith(" from roofr")), ...imported]);
        setMessage("The only reviewed Roofr report for this property was automatically selected and its measurements were imported.");
      }
    }
    void loadRoofrReports();
    return () => { active = false; };
  }, [division, propertyId]);
  const customerProperties = properties.filter((item) => item.customer_id === customerId);
  const selectedRoofrReport = roofrReports.find(report => report.id === selectedRoofrReportId);
  const roofSquares = selectedRoofrReport?.metadata?.extracted_measurements?.find(item => item.label.toLowerCase().includes("roof squares"))?.value;
  const adjustedRoofSquares = typeof roofSquares === "number" ? roofSquares * (1 + Number(wasteFactorPercent) / 100) : null;
  const allCatalogItems = [...estimateCatalog,...priceBookRows.filter(row=>!estimateCatalog.some(item=>item.category===row.category&&item.description===row.description&&item.unit===row.unit)).map(row=>({category:row.category,description:row.description,unit:row.unit}))];
  const catalogCategories = Array.from(new Set([...estimateCatalogCategories,...priceBookRows.map(row=>row.category)])).sort();
  const catalogMatches = allCatalogItems.filter(item => item.category === catalogCategory && (!catalogSearch.trim() || item.description.toLowerCase().includes(catalogSearch.trim().toLowerCase())));
  const itemSubtotal = roundMoney(lineItems.reduce((sum, item) => sum + Math.max(0, Number(item.quantity || 0)) * Math.max(0, Number(item.unit_price || 0)), 0));
  const baseSubtotal = roundMoney(Math.max(0, pricingMode === "lump_sum" ? Number(lumpSum || 0) : itemSubtotal));
  const overheadAmount = overheadEnabled ? roundMoney(baseSubtotal * 0.10) : 0;
  const profitBase = roundMoney(baseSubtotal + overheadAmount);
  const profitAmount = profitEnabled ? roundMoney(profitBase * 0.10) : 0;
  const subtotal = roundMoney(baseSubtotal + overheadAmount + profitAmount);
  const taxRateValue = Math.max(0, Number(taxRate || 0));
  const taxAmount = roundMoney(subtotal * taxRateValue / 100);
  const total = roundMoney(subtotal + taxAmount);
  const lumpSumBase = roundMoney(Math.max(0, Number(lumpSum || 0)));
  const lumpSumOverhead = overheadEnabled ? roundMoney(lumpSumBase * 0.10) : 0;
  const lumpSumProfit = profitEnabled ? roundMoney((lumpSumBase + lumpSumOverhead) * 0.10) : 0;
  const lumpSumSubtotal = roundMoney(lumpSumBase + lumpSumOverhead + lumpSumProfit);
  const lumpSumTax = roundMoney(lumpSumSubtotal * taxRateValue / 100);
  const calculatedLumpSumTotal = roundMoney(lumpSumSubtotal + lumpSumTax);
  function updateLine(index: number, patch: Partial<LineItem>) {
    setLineItems(current => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  }
  function importRoofrMeasurements(report: RoofrReport) {
    const measurements = report.metadata?.extracted_measurements || [];
    setSelectedRoofrReportId(report.id);
    if (!measurements.length) return;
    setLineItems(current => {
      const imported = measurements.filter(item => typeof item.value === "number" && Number.isFinite(item.value)).map(item => ({ description: item.label + " from Roofr", quantity: String(item.value), unit: item.unit === "FACETS" ? "EA" : item.unit, unit_price: "" }));
      return [...current.filter(item => item.description.trim() && !item.description.toLowerCase().endsWith(" from roofr")), ...imported];
    });
    setMessage("Reviewed Roofr quantities added as new estimate lines. Existing line items were left unchanged.");
  }
  function addCatalogItem() {
    const selected = allCatalogItems.find(item => item.description === catalogSelection && item.category === catalogCategory);
    if (!selected) return;
    const savedPrice = priceBookRows.find(row=>row.category===selected.category&&row.description===selected.description&&row.unit===selected.unit)?.unit_price;
    setLineItems(current => [...current, { description: selected.description, quantity: "1", unit: selected.unit, unit_price: savedPrice == null ? "" : String(savedPrice) }]);
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
    setBusy(true); setMessage("");
    const savedItems = pricingMode === "lump_sum" ? [] : lineItems.filter(item => item.description.trim()).map(item => ({
      description: item.description.trim(), quantity: Number(item.quantity || 1), unit: item.unit || "EA", unit_price: Number(item.unit_price || 0),
      amount: roundMoney(Number(item.quantity || 1) * Number(item.unit_price || 0))
    }));
    const { error } = await supabase.from("crm_proposals").insert({
      division_id: division, customer_id: customerId, property_id: propertyId, title: title.trim(),
      pricing_mode: pricingMode, line_items: savedItems, lump_sum_amount: pricingMode === "itemized" || !lumpSum ? null : calculatedLumpSumTotal,
      subtotal, tax_amount: taxAmount, total_amount: total, scope_of_work: scope || null,
      existing_conditions: conditions || null, exclusions: exclusions || null, payment_terms: paymentTerms || null,
      valid_until: validUntil || null, warranty_summary: warrantySummary || null, created_by: userId,
      template_data: { template: division === "TRD" ? "residential_standard_v1" : "commercial_standard_v1", tax_rate_percent: taxRateValue, pricing_breakdown: { base_subtotal: baseSubtotal, overhead_enabled: overheadEnabled, overhead_rate_percent: 10, overhead_amount: overheadAmount, profit_enabled: profitEnabled, profit_rate_percent: 10, profit_base: profitBase, profit_amount: profitAmount, subtotal_before_tax: subtotal, tax_rate_percent: taxRateValue, tax_amount: taxAmount, total: total, lump_sum_base: lumpSum ? lumpSumBase : null, lump_sum_overhead: lumpSum ? lumpSumOverhead : null, lump_sum_profit: lumpSum ? lumpSumProfit : null, lump_sum_subtotal_before_tax: lumpSum ? lumpSumSubtotal : null, lump_sum_tax: lumpSum ? lumpSumTax : null, lump_sum_total: lumpSum ? calculatedLumpSumTotal : null }, roofr_report_id: selectedRoofrReportId || null, roofr_measurements: selectedRoofrReport?.metadata?.extracted_measurements || [], roofr_predominant_pitch: selectedRoofrReport?.metadata?.predominant_pitch || null, roofr_pitch_distribution: selectedRoofrReport?.metadata?.pitch_distribution || [], adjusted_roof_squares: adjustedRoofSquares, waste_factor_percent: Number(wasteFactorPercent), waste_factor_label: wasteFactorPercent === "20" ? "20%+" : wasteFactorPercent + "%", complexity_factor: complexityFactor, pitch_factor: pitchFactor }
    });
    if (error) setMessage(error.message);
    else {
      setMessage("Proposal draft saved to this customer and property.");
      setShowForm(false); setTitle(""); setScope(""); setConditions(""); setExclusions(""); setLumpSum(""); setSelectedRoofrReportId("");
      setLineItems([{ description: "", quantity: "1", unit: "EA", unit_price: "" }]); setTaxRate("0"); setOverheadEnabled(true); setProfitEnabled(true); setValidUntil(""); setWasteFactorPercent("10"); setComplexityFactor("standard"); setPitchFactor("standard");
      await load();
    }
    setBusy(false);
  }
  return <div className="content-stack"><section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">{division} PROPOSALS</p><h2>{division === "TRD" ? "Residential proposals" : "Commercial proposals"}</h2><p className="muted">Create and retain editable proposal drafts by customer and property. PDF delivery is available through the customer email action when the mail service is configured.</p></div>{canWrite && <button type="button" className="primary-button compact" onClick={() => setShowForm(!showForm)}>{showForm ? "Close form" : "+ New proposal"}</button>}</div>
    {showForm && <form className="inline-form" onSubmit={saveProposal}><div className="form-grid">
      <label className="wide">Customer<select required value={customerId} onChange={e => { setCustomerId(e.target.value); setPropertyId(""); setSelectedRoofrReportId(""); setRoofrReports([]); setLineItems(current => current.filter(item => !item.description.toLowerCase().endsWith(" from roofr"))); }}><option value="">Select customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}</select></label>
      <label className="wide">Property<select required value={propertyId} onChange={e => { setPropertyId(e.target.value); setSelectedRoofrReportId(""); setRoofrReports([]); setLineItems(current => current.filter(item => !item.description.toLowerCase().endsWith(" from roofr"))); }}><option value="">Select property</option>{customerProperties.map(p => <option key={p.id} value={p.id}>{p.address_line1}, {p.city}, {p.state}</option>)}</select></label>
      {propertyId && <div className="wide"><h3>Roofr measurement import</h3>{roofrReports.length ? roofrReports.map(report => <div className="button-row" key={report.id}><span>{report.original_filename} · {new Date(report.created_at).toLocaleDateString()}</span><button type="button" className="secondary-button" onClick={() => importRoofrMeasurements(report)}>{selectedRoofrReportId === report.id ? "Selected for estimate" : "Select report and import measurements"}</button></div>) : <p className="muted">No reviewed Roofr measurements are saved for this property yet. Upload and review a report in the customer record first.</p>}</div>}
      {propertyId && !roofrReports.length && <div className="wide"><p className="inline-message">No reviewed Roofr measurements are available for this property. You can still save a proposal draft and add measurements or pricing later.</p></div>}
      {propertyId && <div className="wide"><h3>Waste, complexity and pitch factors</h3><p className="muted">These selections are saved with the proposal. Roofr source quantities remain unchanged; adjusted quantities are planning references only.</p><div className="button-row" role="group" aria-label="Waste factor">{[10,12,15,20].map(value => <button key={value} type="button" className={wasteFactorPercent === String(value) ? "primary-button compact" : "secondary-button compact"} aria-pressed={wasteFactorPercent === String(value)} onClick={() => setWasteFactorPercent(String(value))}>{value === 20 ? "20%+" : value + "%"}</button>)}</div><div className="form-grid"><label>Complexity factor<select value={complexityFactor} onChange={e => setComplexityFactor(e.target.value)}><option value="standard">Standard</option><option value="moderate">Moderate</option><option value="complex">Complex</option><option value="very_complex">Very complex</option></select></label><label>Pitch factor<select value={pitchFactor} onChange={e => setPitchFactor(e.target.value)}><option value="standard">Standard pitch</option><option value="low_slope">Low slope / flat</option><option value="steep">Steep pitch</option><option value="very_steep">Very steep pitch</option></select></label></div></div>}
      {selectedRoofrReport && <div className="wide"><h3>Imported Roofr source values</h3><p className="muted">Original extracted measurements are retained with this proposal. Source quantities are shown before waste allowance.</p><div className="form-grid">{(selectedRoofrReport.metadata?.extracted_measurements || []).map((item,index) => <div key={item.label + index}><strong>{item.label}</strong><p>{item.value} {item.unit}</p></div>)}</div>{selectedRoofrReport.metadata?.predominant_pitch && <p><strong>Predominant pitch:</strong> {selectedRoofrReport.metadata.predominant_pitch}</p>}{(selectedRoofrReport.metadata?.pitch_distribution || []).length > 0 && <div className="table-wrap"><table><thead><tr><th>Pitch</th><th>Area (sq ft)</th><th>Squares</th></tr></thead><tbody>{selectedRoofrReport.metadata?.pitch_distribution?.map(item => <tr key={item.pitch}><td>{item.pitch}</td><td>{item.area_sqft.toLocaleString()}</td><td>{item.squares.toFixed(1)}</td></tr>)}</tbody></table></div>}{adjustedRoofSquares !== null && <p><strong>Planning quantity including {wasteFactorPercent === "20" ? "20%+" : wasteFactorPercent + "%"} waste:</strong> {adjustedRoofSquares.toFixed(1)} squares</p>}</div>}
      <label className="wide">Proposal title<input required value={title} onChange={e => setTitle(e.target.value)} placeholder={division === "TRD" ? "Residential roof replacement proposal" : "Commercial roof restoration proposal"} /></label>
      <label className="wide">Pricing format<select value={pricingMode} onChange={e => setPricingMode(e.target.value)}><option value="both">Show itemized and lump sum options</option><option value="itemized">Itemized only</option><option value="lump_sum">Lump sum only</option></select></label>
      {pricingMode !== "lump_sum" && <div className="wide"><h3>Itemized pricing</h3><div className="form-grid"><label>Catalog category<select value={catalogCategory} onChange={e => { setCatalogCategory(e.target.value); setCatalogSelection(""); }}>{catalogCategories.map(category => <option key={category} value={category}>{category}</option>)}</select></label><label>Search catalog<input value={catalogSearch} onChange={e => { setCatalogSearch(e.target.value); setCatalogSelection(""); }} placeholder="Search roof, tarp, magnet, hand load..." /></label><label className="wide">Catalog item<select value={catalogSelection} onChange={e => setCatalogSelection(e.target.value)}><option value="">Choose a standard estimate item</option>{catalogMatches.map(item => <option key={item.description} value={item.description}>{item.description} ({item.unit})</option>)}</select></label><button type="button" className="secondary-button" disabled={!catalogSelection} onClick={addCatalogItem}>+ Add catalog item</button></div><p className="muted">Starter catalog with division-specific saved prices. Items without a saved rate stay blank; enter verified rates in the Price book. No Xactimate codes or prices are represented as official.</p>{lineItems.map((item,index) => <div className="form-grid" key={index}><label className="wide">Description<input required value={item.description} onChange={e => updateLine(index,{description:e.target.value})} placeholder="Labor, materials, tear off, decking..." /></label><label>Quantity<input type="number" min="0" step="0.01" value={item.quantity} onChange={e => updateLine(index,{quantity:e.target.value})} /></label><label>Unit<select value={item.unit} onChange={e => updateLine(index,{unit:e.target.value})}><option>EA</option><option>SF</option><option>LF</option><option>SQ</option><option>HR</option><option>DAY</option><option>WK</option><option>MO</option><option>LS</option><option>CY</option><option>SHEET</option><option>ROLL</option><option>GAL</option><option>BDL</option></select></label><label>Unit price ($)<input type="number" min="0" step="0.01" value={item.unit_price} onChange={e => updateLine(index,{unit_price:e.target.value})} /></label><p className="muted">Line total: {(Number(item.quantity || 0)*Number(item.unit_price || 0)).toLocaleString("en-US",{style:"currency",currency:"USD"})}</p></div>)}<button type="button" className="secondary-button" onClick={() => setLineItems(current => [...current,{description:"",quantity:"1",unit:"EA",unit_price:""}])}>+ Add line item</button></div>}
      {pricingMode !== "itemized" && <label>Lump sum amount ($)<input required type="number" min="0.01" step="0.01" value={lumpSum} onChange={e => setLumpSum(e.target.value)} /></label>}
      <div className="wide"><h3>Overhead, profit and tax</h3><p className="muted">Calculations update automatically. Overhead is added first at 10%. Profit is then calculated at 10% of the subtotal plus overhead. Tax is calculated on the resulting pre-tax subtotal using the applicable rate entered below.</p><div className="form-grid"><label><input type="checkbox" checked={overheadEnabled} onChange={e => setOverheadEnabled(e.target.checked)} /> Add overhead (10%)</label><label><input type="checkbox" checked={profitEnabled} onChange={e => setProfitEnabled(e.target.checked)} /> Add profit (10%)</label><label>Applicable tax rate (%)<input type="number" min="0" step="0.01" value={taxRate} onChange={e => setTaxRate(e.target.value)} /></label></div><p className="fine-print">Enter the tax rate applicable to this job. Tax treatment can vary by jurisdiction and work type; this version applies the entered rate to the full pre-tax subtotal.</p></div>
      <label>Valid through<input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} /></label>
      <label className="wide">Existing conditions<textarea rows={2} value={conditions} onChange={e => setConditions(e.target.value)} /></label>
      <label className="wide">Scope of work<textarea rows={4} value={scope} onChange={e => setScope(e.target.value)} placeholder={division === "TRD" ? "Describe tear off, decking, underlayment, flashing, roofing material, ventilation and cleanup." : "Describe roof sections, system, preparation, insulation, membrane or coating, details, access and phasing."} /></label>
      <label className="wide">Exclusions<textarea rows={2} value={exclusions} onChange={e => setExclusions(e.target.value)} /></label>
      <label className="wide">Payment terms<textarea rows={2} value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)} /></label>
      <label className="wide">Warranty wording<textarea rows={2} value={warrantySummary} onChange={e => setWarrantySummary(e.target.value)} /></label>
      <div className="wide"><h3>Automatic estimate breakdown</h3><div className="table-wrap"><table><tbody><tr><td>Line item / lump sum base</td><td>{baseSubtotal.toLocaleString("en-US",{style:"currency",currency:"USD"})}</td></tr>{overheadEnabled && <tr><td>Overhead (10%)</td><td>{overheadAmount.toLocaleString("en-US",{style:"currency",currency:"USD"})}</td></tr>}{profitEnabled && <tr><td>Profit (10% of base plus overhead)</td><td>{profitAmount.toLocaleString("en-US",{style:"currency",currency:"USD"})}</td></tr>}<tr><td>Subtotal before tax</td><td>{subtotal.toLocaleString("en-US",{style:"currency",currency:"USD"})}</td></tr><tr><td>Tax ({taxRateValue.toFixed(2)}%)</td><td>{taxAmount.toLocaleString("en-US",{style:"currency",currency:"USD"})}</td></tr><tr><th>Current estimate total</th><th>{total.toLocaleString("en-US",{style:"currency",currency:"USD"})}</th></tr></tbody></table></div>{pricingMode === "both" && <p className="muted">Calculated lump sum alternative, including the selected overhead, profit and tax settings: {calculatedLumpSumTotal.toLocaleString("en-US",{style:"currency",currency:"USD"})}. The itemized total remains the recorded proposal total until the customer selects an option.</p>}</div>
    </div><button className="primary-button" disabled={busy || !customers.length || !customerProperties.length}>{busy ? "Saving..." : "Save proposal draft"}</button></form>}
    {message && <p className="inline-message">{message}</p>}
    {rows.length ? <div className="table-wrap"><table><thead><tr><th>Proposal</th><th>Customer</th><th>Pricing</th><th>Recorded total</th><th>Lump sum alternative</th><th>Status</th><th>Created</th><th>Action</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td><strong>{r.title}</strong></td><td>{customers.find(c => c.id === r.customer_id)?.display_name || "Customer"}</td><td>{r.pricing_mode.replaceAll("_"," ")}</td><td>{Number(r.total_amount || 0).toLocaleString("en-US",{style:"currency",currency:"USD"})}</td><td>{r.lump_sum_amount == null ? "—" : Number(r.lump_sum_amount).toLocaleString("en-US",{style:"currency",currency:"USD"})}</td><td><span className={"pill " + r.status}>{r.status.replaceAll("_"," ")}</span></td><td>{new Date(r.created_at).toLocaleDateString()}</td><td><button type="button" className="secondary-button" disabled={sendingId===r.id} onClick={()=>sendPdf(r.id)}>{sendingId===r.id?"Sending...":"Send PDF by email"}</button></td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>No proposal drafts yet</strong><span>Saved proposals will appear here and remain associated with their customer and property.</span></div>}
  </section></div>;
}
