import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";

type DivisionId = "TRD" | "CRD";
type Customer = { id: string; display_name: string };
type Property = { id: string; customer_id: string; address_line1: string; city: string; state: string };
type CheckItem = { category: string; location: string; issue: boolean; observation: string; severity: string; recommendation: string };
type PhotoDraft = { file: File; label: string; caption: string; roofSection: string };
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
  const [roofArea, setRoofArea] = useState("");
  const [squares, setSquares] = useState("");
  const [pitch, setPitch] = useState("");
  const [sections, setSections] = useState("");
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
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
  useEffect(() => { setItems(freshItems(division)); setCustomerId(""); setPropertyId(""); }, [division]);
  const customerProperties = properties.filter(p => p.customer_id === customerId);
  function updateItem(index: number, patch: Partial<CheckItem>) {
    setItems(current => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  }
  function addPhotos(files: FileList | null) {
    if (!files) return;
    const next = Array.from(files).filter(file => file.type.startsWith("image/")).map(file => ({ file, label: "Inspection photo", caption: "", roofSection: "" }));
    setPhotos(current => [...current, ...next]);
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
      measurements: { roof_area_sq_ft: roofArea ? Number(roofArea) : null, roof_squares: squares ? Number(squares) : null, pitch: pitch || null },
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
    setCustomerId(""); setPropertyId(""); setItems(freshItems(division)); setSummary(""); setRecommendations(""); setWeather(""); setRoofArea(""); setSquares(""); setPitch(""); setSections(""); setPhotos([]);
    await load(); setBusy(false);
  }
  return <div className="content-stack"><section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">{division} INSPECTIONS</p><h2>{division === "TRD" ? "Residential roof inspection" : "Commercial roof inspection"}</h2><p className="muted">Division specific checklist, roof measurements, findings and labeled photos.</p></div></div>
    {canWrite && <form className="inline-form" onSubmit={save}><div className="form-grid">
      <label className="wide">Customer<select required value={customerId} onChange={e => { setCustomerId(e.target.value); setPropertyId(""); }}><option value="">Select customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}</select></label>
      <label className="wide">Property<select required value={propertyId} onChange={e => setPropertyId(e.target.value)}><option value="">Select property</option>{customerProperties.map(p => <option key={p.id} value={p.id}>{p.address_line1}, {p.city}, {p.state}</option>)}</select></label>
      <label>Overall condition<select value={overall} onChange={e => setOverall(e.target.value)}><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option><option value="critical">Critical</option></select></label>
      <label>Weather conditions<input value={weather} onChange={e => setWeather(e.target.value)} placeholder="Clear, wet, windy..." /></label>
      <label>Roof area (sq ft)<input type="number" min="0" value={roofArea} onChange={e => setRoofArea(e.target.value)} /></label>
      <label>Roof squares<input type="number" min="0" step="0.01" value={squares} onChange={e => setSquares(e.target.value)} /></label>
      <label>Pitch / slope<input value={pitch} onChange={e => setPitch(e.target.value)} placeholder="6:12, low slope..." /></label>
      <label className="wide">Roof sections, one per line<textarea rows={2} value={sections} onChange={e => setSections(e.target.value)} placeholder="Main roof\nRear addition\nNorth warehouse" /></label>
      <label className="wide">Inspection summary<textarea rows={3} value={summary} onChange={e => setSummary(e.target.value)} /></label>
      <label className="wide">Overall recommendations<textarea rows={3} value={recommendations} onChange={e => setRecommendations(e.target.value)} /></label>
    </div>
    <h3>Inspection checklist</h3><p className="muted">Check an item when a concern is present. Leave it unchecked to record no issue observed.</p>
    {items.map((item, index) => <div className="checklist-row" key={item.category}><div className="checklist-title"><label><input type="checkbox" checked={item.issue} onChange={e => updateItem(index,{issue:e.target.checked})} /> {item.category}</label></div><div className="form-grid"><label>Location<input value={item.location} onChange={e => updateItem(index,{location:e.target.value})} placeholder="North slope, section B..." /></label>{item.issue && <label>Severity<select value={item.severity} onChange={e => updateItem(index,{severity:e.target.value})}><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option><option value="critical">Critical</option></select></label>}<label className="wide">Observation<input value={item.observation} onChange={e => updateItem(index,{observation:e.target.value})} placeholder="Describe what was observed" /></label><label className="wide">Recommendation<input value={item.recommendation} onChange={e => updateItem(index,{recommendation:e.target.value})} placeholder="Recommended repair or action" /></label></div></div>)}
    <h3>Inspection photos</h3><label className="wide">Add photos<input type="file" accept="image/*" multiple onChange={e => addPhotos(e.target.files)} /></label>
    {photos.map((photo,index) => <div className="checklist-row" key={photo.file.name + index}><strong>{photo.file.name}</strong><div className="form-grid"><label>Photo label<input value={photo.label} onChange={e => setPhotos(current => current.map((p,i) => i===index ? {...p,label:e.target.value} : p))} /></label><label>Roof section or checklist item<input value={photo.roofSection} onChange={e => setPhotos(current => current.map((p,i) => i===index ? {...p,roofSection:e.target.value} : p))} placeholder="Enter matching checklist name" /></label><label className="wide">Caption<input value={photo.caption} onChange={e => setPhotos(current => current.map((p,i) => i===index ? {...p,caption:e.target.value} : p))} placeholder="What this photo documents" /></label></div></div>)}
    <button className="primary-button" disabled={busy || !customers.length || !customerProperties.length}>{busy ? "Saving inspection..." : "Save inspection and photos"}</button></form>}
    {message && <p className="inline-message">{message}</p>}
  </section><section className="panel"><h2>Recent inspections</h2>{inspections.length ? <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Property</th><th>Type</th><th>Status</th><th>Date</th></tr></thead><tbody>{inspections.map(row => <tr key={row.id}><td>{row.crm_customers?.display_name || "Customer"}</td><td>{row.crm_properties?.address_line1 || "Property"}, {row.crm_properties?.city || ""}</td><td>{row.inspection_type || "general"}</td><td>{row.status}</td><td>{row.inspected_at ? new Date(row.inspected_at).toLocaleDateString() : "Not scheduled"}</td></tr>)}</tbody></table></div> : <div className="empty-state">No inspections recorded yet.</div>}</section></div>;
}
