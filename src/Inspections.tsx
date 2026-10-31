import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";

type DivisionId = "TRD" | "CRD";
type Customer = { id: string; display_name: string };
type Property = { id: string; customer_id: string; address_line1: string; city: string; state: string };
type CheckItem = { category: string; location: string; issue: boolean; observation: string; severity: string; recommendation: string };
type PhotoDraft = { file: File; label: string; caption: string; roofSection: string };
type RoofrMeasurement = { label: string; value: number; unit: string; source_label?: string };
type RoofrReport = { id: string; original_filename: string; created_at: string; metadata: { document_type?: string; extraction_status?: string; extracted_measurements?: RoofrMeasurement[] } | null };
const residential = ["Shingles or roofing material","Hail or wind damage","Granule loss or surface wear","Ridge cap and hip","Flashing and valleys","Pipe boots and penetrations","Ventilation","Decking condition","Gutters and drainage","Interior water intrusion"];
const commercial = ["Roof membrane or surface","Seams and welds","Punctures, tears or surface damage","Ponding water","Perimeter flashing and coping","Penetrations and equipment curbs","Drains and scuppers","Insulation or deck concerns","HVAC and rooftop equipment","Previous repairs or coatings"];
const freshItems = (division: DivisionId): CheckItem[] => (division === "TRD" ? residential : commercial).map(category => ({ category, location: "", issue: false, observation: "", severity: "none", recommendation: "" }));

export default function Inspections({ division, userId, canWrite }: { division: DivisionId; userId: string; canWrite: boolean }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [inspections, setInspections] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [items, setItems] = useState<CheckItem[]>(() => freshItems(division));
  const [summary, setSummary] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [overall, setOverall] = useState("good");
  const [weather, setWeather] = useState("");
  const [carrier, setCarrier] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [claimNumber, setClaimNumber] = useState("");
  const [adjuster, setAdjuster] = useState("");
  const [adjusterPhone, setAdjusterPhone] = useState("");
  const [adjusterEmail, setAdjusterEmail] = useState("");
  const [roofArea, setRoofArea] = useState("");
  const [squares, setSquares] = useState("");
  const [pitch, setPitch] = useState("");
  const [roofrReports, setRoofrReports] = useState<RoofrReport[]>([]);
  const [roofrReportId, setRoofrReportId] = useState("");
  const [sections, setSections] = useState("");
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [sendingId, setSendingId] = useState("");
  const [viewingInspection, setViewingInspection] = useState<any | null>(null);
  const [viewingItems, setViewingItems] = useState<any[]>([]);
  const [viewingPhotos, setViewingPhotos] = useState<any[]>([]);
  const [loadingReport, setLoadingReport] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return;
    const [customerResult, inspectionResult] = await Promise.all([
      supabase.from("crm_customer_divisions").select("customer_id,crm_customers(id,display_name)").eq("division_id", division),
      supabase.from("crm_inspections").select("id,inspection_type,status,inspected_at,summary,property_id,crm_properties(address_line1,city,state),crm_customers(display_name)").eq("division_id", division).order("created_at", { ascending: false }).limit(50)
    ]);
    const customerRows = (customerResult.data ?? []).flatMap((row: any) => row.crm_customers ? [row.crm_customers] : []);
    setCustomers(customerRows as Customer[]);
    const { data: propertyRows, error } = await supabase.from("crm_properties").select("id,customer_id,address_line1,city,state").in("customer_id", customerRows.map((c: Customer) => c.id)).order("address_line1");
    if (error) setMessage(error.message);
    setProperties((propertyRows ?? []) as Property[]);
    if (inspectionResult.error) setMessage(inspectionResult.error.message);
    setInspections(inspectionResult.data ?? []);
  }, [division]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setItems(freshItems(division)); setCustomerId(""); setPropertyId(""); setRoofrReportId(""); setRoofrReports([]); }, [division]);
  useEffect(() => {
    let active = true;
    async function loadRoofrReports() {
      if (!supabase || !propertyId) { setRoofrReports([]); setRoofrReportId(""); return; }
      const { data, error } = await supabase.from("crm_files")
        .select("id,original_filename,created_at,metadata")
        .eq("division_id", division).eq("related_type", "property").eq("related_id", propertyId)
        .order("created_at", { ascending: false });
      if (!active) return;
      if (error) { setMessage("Roofr reports could not be loaded: " + error.message); setRoofrReports([]); return; }
      setRoofrReports(((data || []) as RoofrReport[]).filter(row => row.metadata?.document_type === "roofr_measurement_report" && row.metadata?.extraction_status === "reviewed"));
    }
    void loadRoofrReports();
    return () => { active = false; };
  }, [division, propertyId]);
  function applyRoofrReport(reportId: string) {
    setRoofrReportId(reportId);
    const report = roofrReports.find(row => row.id === reportId);
    if (!report) return;
    const values = report.metadata?.extracted_measurements || [];
    const area = values.find(item => item.label.toLowerCase().includes("roof area"));
    const squaresValue = values.find(item => item.label.toLowerCase().includes("squares"));
    if (area) setRoofArea(String(area.value));
    if (squaresValue) setSquares(String(squaresValue.value));
    setMessage("Reviewed Roofr measurements applied to this inspection. Verify the values before saving.");
  }
  const customerProperties = properties.filter(p => p.customer_id === customerId);
  function updateItem(index: number, patch: Partial<CheckItem>) {
    setItems(current => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  }
  function addPhotos(files: FileList | null) {
    if (!files) return;
    const next = Array.from(files).filter(file => ["image/jpeg", "image/png"].includes(file.type) && file.size <= 15 * 1024 * 1024).map(file => ({ file, label: "Inspection photo", caption: "", roofSection: "" }));
    if (next.length !== files.length) setMessage("Only JPG or PNG photos up to 15 MB each can be attached to the inspection PDF.");
    setPhotos(current => [...current, ...next]);
  }
  async function viewReport(id: string) {
    if (!supabase) return;
    const client = supabase;
    setLoadingReport(true); setMessage("");
    const { data, error } = await client.from("crm_inspections")
      .select("id,division_id,inspection_type,status,inspected_at,weather_conditions,overall_condition,summary,recommendations,measurements,roof_sections,claim_information,crm_customers(display_name),crm_properties(address_line1,city,state,postal_code)")
      .eq("id", id).single();
    if (error || !data) {
      setMessage(error?.message || "Inspection report could not be loaded.");
      setLoadingReport(false);
      return;
    }
    const [itemResult, photoResult] = await Promise.all([
      client.from("crm_inspection_items").select("id,category,location,observation,severity,recommendation").eq("inspection_id", id).order("created_at"),
      client.from("crm_inspection_photos").select("photo_label,caption,roof_section,crm_files(bucket_id,object_path,content_type,original_filename)").eq("inspection_id", id).order("created_at")
    ]);
    const photoRows = await Promise.all((photoResult.data || []).map(async (photo: any) => {
      const file = photo.crm_files;
      if (!file?.bucket_id || !file?.object_path) return { ...photo, signedUrl: "" };
      const { data: signed } = await client.storage.from(file.bucket_id).createSignedUrl(file.object_path, 3600);
      return { ...photo, signedUrl: signed?.signedUrl || "" };
    }));
    setViewingInspection(data);
    setViewingItems(itemResult.data || []);
    setViewingPhotos(photoRows);
    if (itemResult.error) setMessage(itemResult.error.message);
    if (photoResult.error) setMessage(photoResult.error.message);
    setLoadingReport(false);
  }
  async function sendPdf(id: string) {
    if (!supabase) return;
    setSendingId(id); setMessage("");
    const { data, error } = await supabase.functions.invoke("crm-send-document", { body: { document_type: "inspection", document_id: id } });
    setMessage(error?.message || data?.error || (data?.success ? "PDF emailed to " + data.recipient : "Document email could not be sent."));
    setSendingId("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !customerId || !propertyId) return;
    setBusy(true); setMessage("");
    const sectionList = sections.split("\n").map(value => value.trim()).filter(Boolean);
    const { data: inspection, error } = await supabase.from("crm_inspections").insert({
      division_id: division, customer_id: customerId, property_id: propertyId, inspector_id: userId,
      status: "draft", inspected_at: new Date().toISOString(), inspection_type: division === "TRD" ? "residential" : "commercial",
      weather_conditions: weather || null, overall_condition: overall, summary: summary || null, recommendations: recommendations || null,
      claim_information: { carrier: carrier || null, policy_number: policyNumber || null, claim_number: claimNumber || null, adjuster_name: adjuster || null, adjuster_phone: adjusterPhone || null, adjuster_email: adjusterEmail || null },
      measurements: {
        roof_area_sq_ft: roofArea ? Number(roofArea) : null, roof_squares: squares ? Number(squares) : null, pitch: pitch || null,
        roofr_report_id: roofrReportId || null,
        roofr_report_name: roofrReports.find(report => report.id === roofrReportId)?.original_filename || null,
        roofr_measurements: roofrReports.find(report => report.id === roofrReportId)?.metadata?.extracted_measurements || []
      },
      roof_sections: sectionList.map(name => ({ name }))
    }).select("id").single();
    if (error || !inspection) { setMessage(error?.message || "Inspection could not be saved."); setBusy(false); return; }
    const itemRows = items.map(item => ({
      inspection_id: inspection.id, category: item.category, location: item.location || null,
      observation: item.observation.trim() || (item.issue ? "Finding noted" : "No issue observed"),
      severity: item.issue ? item.severity : "none", recommendation: item.recommendation || null,
      photo_required: false, ai_generated: false, human_verified: true, verified_by: userId, verified_at: new Date().toISOString()
    }));
    const { data: savedItems, error: itemError } = await supabase.from("crm_inspection_items").insert(itemRows).select("id,category");
    if (itemError) setMessage("Inspection saved, but checklist items need attention: " + itemError.message);
    for (const photo of photos) {
      const safeName = photo.file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
      const objectPath = division + "/inspections/" + inspection.id + "/" + crypto.randomUUID() + "-" + safeName;
      const { error: uploadError } = await supabase.storage.from("roof-doctors-private").upload(objectPath, photo.file, { contentType: photo.file.type, upsert: false });
      if (uploadError) { setMessage("Inspection saved. A photo upload failed: " + uploadError.message); continue; }
      const { data: fileRow, error: fileError } = await supabase.from("crm_files").insert({
        division_id: division, related_type: "inspection", related_id: inspection.id, bucket_id: "roof-doctors-private",
        object_path: objectPath, original_filename: photo.file.name, content_type: photo.file.type,
        file_size_bytes: photo.file.size, uploaded_by: userId
      }).select("id").single();
      if (fileError || !fileRow) { setMessage("Photo uploaded but its CRM file record failed: " + (fileError?.message || "unknown error")); continue; }
      const matching = savedItems?.find((item: any) => item.category === photo.roofSection);
      const { error: photoError } = await supabase.from("crm_inspection_photos").insert({
        division_id: division, inspection_id: inspection.id, inspection_item_id: matching?.id || null,
        file_id: fileRow.id, photo_label: photo.label || "Inspection photo", caption: photo.caption || null,
        roof_section: photo.roofSection || null, created_by: userId
      });
      if (photoError) setMessage("Photo uploaded but photo details were not saved: " + photoError.message);
    }
    setMessage(itemError ? "Inspection saved with checklist errors. " + itemError.message : "Inspection and selected photos saved to the customer and property.");
    setCustomerId(""); setPropertyId(""); setItems(freshItems(division)); setSummary(""); setRecommendations(""); setWeather(""); setCarrier(""); setPolicyNumber(""); setClaimNumber(""); setAdjuster(""); setAdjusterPhone(""); setAdjusterEmail(""); setRoofArea(""); setSquares(""); setPitch(""); setSections(""); setRoofrReportId(""); setPhotos([]);
    await load(); setBusy(false);
  }
  return <div className="content-stack"><section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">{division} INSPECTIONS</p><h2>{division === "TRD" ? "Residential roof inspection" : "Commercial roof inspection"}</h2><p className="muted">Division specific checklist, roof measurements, findings and labeled photos.</p></div></div>
    {canWrite && <form className="inline-form" onSubmit={save}><div className="form-grid">
      <label className="wide">Customer<select required value={customerId} onChange={e => { setCustomerId(e.target.value); setPropertyId(""); setRoofrReportId(""); }}><option value="">Select customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}</select></label>
      <label className="wide">Property<select required value={propertyId} onChange={e => { setPropertyId(e.target.value); setRoofrReportId(""); }}><option value="">Select property</option>{customerProperties.map(p => <option key={p.id} value={p.id}>{p.address_line1}, {p.city}, {p.state}</option>)}</select></label>
      <label>Overall condition<select value={overall} onChange={e => setOverall(e.target.value)}><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option><option value="critical">Critical</option></select></label>
      <label>Weather conditions<input value={weather} onChange={e => setWeather(e.target.value)} placeholder="Clear, wet, windy..." /></label>
      <div className="wide"><h3>Optional insurance information</h3><p className="muted">Complete any fields relevant to this inspection. These details are included in the report when provided.</p></div>
      <label>Insurance carrier<input value={carrier} onChange={e => setCarrier(e.target.value)} placeholder="Carrier name" /></label>
      <label>Policy number<input value={policyNumber} onChange={e => setPolicyNumber(e.target.value)} /></label>
      <label>Claim number<input value={claimNumber} onChange={e => setClaimNumber(e.target.value)} /></label>
      <label>Adjuster name<input value={adjuster} onChange={e => setAdjuster(e.target.value)} /></label>
      <label>Adjuster phone<input type="tel" value={adjusterPhone} onChange={e => setAdjusterPhone(e.target.value)} /></label>
      <label>Adjuster email<input type="email" value={adjusterEmail} onChange={e => setAdjusterEmail(e.target.value)} /></label>
      {propertyId && <div className="wide"><h3>Roofr measurement report</h3>{roofrReports.length ? <><label>Use reviewed Roofr report<select value={roofrReportId} onChange={e => applyRoofrReport(e.target.value)}><option value="">Do not import a Roofr report</option>{roofrReports.map(report => <option key={report.id} value={report.id}>{report.original_filename} · {new Date(report.created_at).toLocaleDateString()}</option>)}</select></label><p className="fine-print">Selecting a report fills matching roof area and squares fields. The source report and extracted measurements will be recorded in this inspection.</p></> : <p className="muted">No reviewed Roofr report is saved for this property. Upload and review one in the customer record first.</p>}</div>}
      <label>Roof area (sq ft)<input type="number" min="0" value={roofArea} onChange={e => setRoofArea(e.target.value)} /></label>
      <label>Roof squares<input type="number" min="0" step="0.01" value={squares} onChange={e => setSquares(e.target.value)} /></label>
      <label>Pitch / slope<input value={pitch} onChange={e => setPitch(e.target.value)} placeholder="6:12, low slope..." /></label>
      <label className="wide">Roof sections, one per line<textarea rows={2} value={sections} onChange={e => setSections(e.target.value)} placeholder="Main roof\nRear addition\nNorth warehouse" /></label>
      <label className="wide">Inspection summary<textarea rows={3} value={summary} onChange={e => setSummary(e.target.value)} /></label>
      <label className="wide">Overall recommendations<textarea rows={3} value={recommendations} onChange={e => setRecommendations(e.target.value)} /></label>
    </div>
    <h3>Inspection checklist</h3><p className="muted">Check an item when a concern is present. Leave it unchecked to record no issue observed.</p>
    {items.map((item, index) => <div className="checklist-row" key={item.category}><div className="checklist-title"><label><input type="checkbox" checked={item.issue} onChange={e => updateItem(index,{issue:e.target.checked})} /> {item.category}</label></div><div className="form-grid"><label>Location<input value={item.location} onChange={e => updateItem(index,{location:e.target.value})} placeholder="North slope, section B..." /></label>{item.issue && <label>Severity<select value={item.severity} onChange={e => updateItem(index,{severity:e.target.value})}><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option><option value="critical">Critical</option></select></label>}<label className="wide">Observation<input value={item.observation} onChange={e => updateItem(index,{observation:e.target.value})} placeholder="Describe what was observed" /></label><label className="wide">Recommendation<input value={item.recommendation} onChange={e => updateItem(index,{recommendation:e.target.value})} placeholder="Recommended repair or action" /></label></div></div>)}
    <h3>Inspection photos</h3><label className="wide">Add photos<input type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" multiple onChange={e => addPhotos(e.target.files)} /></label>
    {photos.map((photo,index) => <div className="checklist-row" key={photo.file.name + index}><strong>{photo.file.name}</strong><div className="form-grid"><label>Photo label<input value={photo.label} onChange={e => setPhotos(current => current.map((p,i) => i===index ? {...p,label:e.target.value} : p))} /></label><label>Roof section or checklist item<select value={photo.roofSection} onChange={e => setPhotos(current => current.map((p,i) => i===index ? {...p,roofSection:e.target.value} : p))}><option value="">No section selected</option>{sections.split("\n").map(value => value.trim()).filter(Boolean).map(value => <option key={"section-"+value} value={value}>{value}</option>)}{items.map(item => <option key={"item-"+item.category} value={item.category}>{item.category}</option>)}</select></label><label className="wide">Caption<input value={photo.caption} onChange={e => setPhotos(current => current.map((p,i) => i===index ? {...p,caption:e.target.value} : p))} placeholder="What this photo documents" /></label></div></div>)}
    <button className="primary-button" disabled={busy || !customers.length || !customerProperties.length}>{busy ? "Saving inspection..." : "Save inspection and photos"}</button></form>}
    {message && <p className="inline-message">{message}</p>}
  </section>
  {viewingInspection && <section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">{division} INSPECTION REPORT</p><h2>{viewingInspection.crm_customers?.display_name || "Customer"} | {viewingInspection.crm_properties?.address_line1 || "Property"}</h2><p className="muted">{[viewingInspection.crm_properties?.city, viewingInspection.crm_properties?.state, viewingInspection.crm_properties?.postal_code].filter(Boolean).join(", ")}</p></div><button type="button" className="secondary-button" onClick={() => { setViewingInspection(null); setViewingItems([]); setViewingPhotos([]); }}>Close report</button></div>
    <div className="form-grid">
      <div><strong>Inspection date</strong><p>{viewingInspection.inspected_at ? new Date(viewingInspection.inspected_at).toLocaleString() : "Not recorded"}</p></div>
      <div><strong>Report status</strong><p>{viewingInspection.status}</p></div>
      <div><strong>Inspection type</strong><p>{viewingInspection.inspection_type}</p></div>
      <div><strong>Overall condition</strong><p>{viewingInspection.overall_condition || "Not recorded"}</p></div>
      <div><strong>Weather</strong><p>{viewingInspection.weather_conditions || "Not recorded"}</p></div>
      <div><strong>Insurance carrier</strong><p>{viewingInspection.claim_information?.carrier || "Not provided"}</p></div>
      <div><strong>Policy number</strong><p>{viewingInspection.claim_information?.policy_number || "Not provided"}</p></div>
      <div><strong>Claim number</strong><p>{viewingInspection.claim_information?.claim_number || "Not provided"}</p></div>
      <div><strong>Adjuster</strong><p>{viewingInspection.claim_information?.adjuster_name || "Not provided"}</p></div>
      <div><strong>Adjuster phone</strong><p>{viewingInspection.claim_information?.adjuster_phone || "Not provided"}</p></div>
      <div><strong>Adjuster email</strong><p>{viewingInspection.claim_information?.adjuster_email || "Not provided"}</p></div>
      <div><strong>Roof area</strong><p>{viewingInspection.measurements?.roof_area_sq_ft ?? "Not recorded"} sq ft</p></div>
      <div><strong>Roof squares</strong><p>{viewingInspection.measurements?.roof_squares ?? "Not recorded"}</p></div>
      <div><strong>Pitch / slope</strong><p>{viewingInspection.measurements?.pitch || "Not recorded"}</p></div>
      {viewingInspection.measurements?.roofr_report_name && <div className="wide"><strong>Roofr source report</strong><p>{viewingInspection.measurements.roofr_report_name}</p><p className="muted">Imported from reviewed property measurements. Source report ID: {viewingInspection.measurements.roofr_report_id}</p></div>}
      {viewingInspection.measurements?.roofr_measurements?.length > 0 && <div className="wide"><strong>Roofr extracted measurements</strong><ul>{viewingInspection.measurements.roofr_measurements.map((item: RoofrMeasurement, index: number) => <li key={index}>{item.label}: {item.value} {item.unit}</li>)}</ul></div>}
    </div>
    {viewingInspection.roof_sections?.length > 0 && <><h3>Roof sections</h3><ul>{viewingInspection.roof_sections.map((section: any, index: number) => <li key={index}>{section.name || "Section"}</li>)}</ul></>}
    {viewingInspection.summary && <><h3>Inspection summary</h3><p>{viewingInspection.summary}</p></>}
    <h3>Inspection findings</h3>
    {viewingItems.length ? viewingItems.map((item: any) => <div className="checklist-row" key={item.id}><strong>{item.category}</strong><p className="muted">{item.location || "Location not specified"}{item.severity && item.severity !== "none" ? " | " + item.severity.toUpperCase() : ""}</p><p>{item.observation}</p>{item.recommendation && <p><strong>Recommendation:</strong> {item.recommendation}</p>}</div>) : <p className="muted">No checklist findings recorded.</p>}
    {viewingInspection.recommendations && <><h3>Overall recommendations</h3><p>{viewingInspection.recommendations}</p></>}
    <h3>Photo documentation</h3>
    {viewingPhotos.length ? <div className="form-grid">{viewingPhotos.map((photo: any, index: number) => <div className="checklist-row" key={index}>{photo.signedUrl && <img src={photo.signedUrl} alt={photo.photo_label || "Inspection photo"} style={{ width: "100%", maxHeight: "260px", objectFit: "contain" }} />}<strong>{photo.photo_label || "Inspection photo"}</strong><p className="muted">{photo.roof_section || "Location not specified"}</p><p>{photo.caption || "No caption"}</p></div>)}</div> : <p className="muted">No photos attached.</p>}
    <button type="button" className="primary-button" disabled={sendingId===viewingInspection.id} onClick={() => sendPdf(viewingInspection.id)}>{sendingId===viewingInspection.id ? "Sending..." : "Email this inspection report"}</button>
  </section>}
  <section className="panel"><h2>Recent inspections</h2>{inspections.length ? <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Property</th><th>Type</th><th>Status</th><th>Date</th><th>Action</th></tr></thead><tbody>{inspections.map(row => <tr key={row.id}><td>{row.crm_customers?.display_name || "Customer"}</td><td>{row.crm_properties?.address_line1 || "Property"}, {row.crm_properties?.city || ""}</td><td>{row.inspection_type || "general"}</td><td>{row.status}</td><td>{row.inspected_at ? new Date(row.inspected_at).toLocaleDateString() : "Not scheduled"}</td><td><button type="button" className="secondary-button" disabled={loadingReport} onClick={()=>viewReport(row.id)}>{loadingReport?"Loading...":"View report"}</button> <button type="button" className="secondary-button" disabled={sendingId===row.id} onClick={()=>sendPdf(row.id)}>{sendingId===row.id?"Sending...":"Email PDF"}</button></td></tr>)}</tbody></table></div> : <div className="empty-state">No inspections recorded yet.</div>}</section></div>;
}
