import { registerFile } from "./registerFile";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { supabase } from "./lib/supabase";

type PropertyOption = { id: string; address_line1: string; city: string; state: string };
type ReportRow = {
  id: string; related_id: string; original_filename: string; object_path: string;
  bucket_id: string; created_at: string; metadata: Record<string, unknown> | null;
};

type Measurement = { label: string; value: number; unit: string; source_label: string };
type RoofStructure = { name: string; measurements: Measurement[] };

async function extractPdfMeasurements(file: File): Promise<{ text: string; measurements: Measurement[]; structures: RoofStructure[] }> {
  // PDF.js is loaded only when a Roofr PDF is uploaded.
  // @ts-expect-error PDF.js is loaded from its versioned browser ESM distribution.
  const pdfjs = await import(/* @vite-ignore */ "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: bytes, useWorkerFetch: false, isEvalSupported: false }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item: { str?: string }) => item.str || "").join(" ").replace(/\s+/g, " "));
  }
  const text = pages.join("\n");
  const summaryPage = pages.find(page => /Report summary/i.test(page)) || pages[pages.length - 1] || "";
  const measurements: Measurement[] = [];
  const add = (label: string, value: number, unit: string, source: string) => {
    if (Number.isFinite(value) && value >= 0) measurements.push({ label, value: Math.round(value * 100) / 100, unit, source_label: source });
  };
  const readArea = (label: string, pattern: RegExp) => {
    const match = summaryPage.match(pattern);
    if (match?.[1]) add(label, Number(match[1].replace(/,/g, "")), "SF", match[0]);
  };
  readArea("Total roof area", /Total roof area\s+([\d,]+(?:\.\d+)?)\s*sqft/i);
  readArea("Pitched roof area", /Total pitched area\s+([\d,]+(?:\.\d+)?)\s*sqft/i);
  readArea("Flat roof area", /Total flat area\s+([\d,]+(?:\.\d+)?)\s*sqft/i);
  const facets = summaryPage.match(/Total roof facets\s+(\d+)\s+facets/i);
  if (facets) add("Roof facets", Number(facets[1]), "EA", facets[0]);
  const pitch = summaryPage.match(/Predominant pitch\s+(\d+\s*\/\s*12)/i);
  if (pitch) add("Predominant pitch", Number(pitch[1].replace(/\s/g, "").split("/")[0]), "PITCH", pitch[1].replace(/\s/g, ""));
  const lengthLabels = ["Eaves", "Valleys", "Hips", "Ridges", "Rakes", "Wall flashing", "Step flashing", "Transitions", "Parapet wall", "Unspecified"];
  for (const label of lengthLabels) {
    const match = summaryPage.match(new RegExp("Total\\s+" + label + "\\s+(\\d+)\\s*ft\\s*(\\d+)\\s*in", "i"));
    if (match) add(label, Number(match[1]) + Number(match[2]) / 12, "LF", match[0]);
  }
  const totalArea = measurements.find(item => item.label === "Total roof area")?.value;
  const pitchedArea = measurements.find(item => item.label === "Pitched roof area")?.value;
  const flatArea = measurements.find(item => item.label === "Flat roof area")?.value;
  if (totalArea !== undefined) add("Total roof squares", totalArea / 100, "SQ", "Calculated from total roof area divided by 100");
  if (pitchedArea !== undefined) add("Pitched roof squares", pitchedArea / 100, "SQ", "Calculated from pitched roof area divided by 100");
  if (flatArea !== undefined) add("Flat roof squares", flatArea / 100, "SQ", "Calculated from flat roof area divided by 100");

  const structures: RoofStructure[] = [];
  for (const page of pages) {
    const heading = page.match(/(Structure\s+#\d+)\s+summary/i);
    if (!heading) continue;
    const structureMeasurements: Measurement[] = [];
    const area = page.match(/Total roof area\s+([\d,]+(?:\.\d+)?)\s*sqft/i);
    const structurePitched = page.match(/Total pitched area\s+([\d,]+(?:\.\d+)?)\s*sqft/i);
    if (area) structureMeasurements.push({ label: "Total roof area", value: Number(area[1].replace(/,/g, "")), unit: "SF", source_label: area[0] });
    if (structurePitched) structureMeasurements.push({ label: "Pitched roof area", value: Number(structurePitched[1].replace(/,/g, "")), unit: "SF", source_label: structurePitched[0] });
    for (const label of ["Eaves", "Valleys", "Hips", "Ridges", "Rakes"]) {
      const match = page.match(new RegExp("Total\\s+" + label + "\\s+(\\d+)\\s*ft\\s*(\\d+)\\s*in", "i"));
      if (match) structureMeasurements.push({ label, value: Math.round((Number(match[1]) + Number(match[2]) / 12) * 100) / 100, unit: "LF", source_label: match[0] });
    }
    const structurePitch = page.match(/Predominant pitch\s+(\d+\s*\/\s*12)/i);
    if (structurePitch) structureMeasurements.push({ label: "Predominant pitch", value: Number(structurePitch[1].replace(/\s/g, "").split("/")[0]), unit: "PITCH", source_label: structurePitch[1].replace(/\s/g, "") });
    structures.push({ name: heading[1], measurements: structureMeasurements });
  }
  return { text, measurements, structures };
}

export default function RoofrMeasurements({ division, userId, properties, canWrite }: {
  division: "TRD" | "CRD"; userId: string; properties: PropertyOption[]; canWrite: boolean;
}) {
  const [propertyId, setPropertyId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [review, setReview] = useState<ReportRow | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [wasteFactor, setWasteFactor] = useState("10");
  const [customWasteFactor, setCustomWasteFactor] = useState("20");
  const [structures, setStructures] = useState<RoofStructure[]>([]);

  useEffect(() => {
    if (!properties.some(p => p.id === propertyId)) setPropertyId(properties[0]?.id || "");
  }, [properties, propertyId]);

  const load = useCallback(async () => {
    if (!supabase || !propertyId) { setReports([]); return; }
    const { data, error } = await supabase.from("crm_files")
      .select("id,related_id,original_filename,object_path,bucket_id,created_at,metadata")
      .eq("division_id", division).eq("related_type", "property").eq("related_id", propertyId)
      .order("created_at", { ascending: false });
    if (error) setMessage(error.message);
    setReports(((data || []) as ReportRow[]).filter(row => row.metadata?.document_type === "roofr_measurement_report"));
  }, [division, propertyId]);

  useEffect(() => { void load(); }, [load]);

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !file || !propertyId) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setMessage("Please select a Roofr PDF report."); return;
    }
    if (file.size > 15 * 1024 * 1024) { setMessage("The PDF must be 15 MB or smaller because that is the current private storage limit."); return; }
    setBusy(true); setMessage("Reading the Roofr report...");
    let extracted: { text: string; measurements: Measurement[]; structures: RoofStructure[] } = { text: "", measurements: [], structures: [] };
    let extractionError = "";
    try { extracted = await extractPdfMeasurements(file); }
    catch (error) { extractionError = error instanceof Error ? error.message : String(error); }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "roofr-report.pdf";
    const path = division + "/" + propertyId + "/roofr-" + crypto.randomUUID() + "-" + safeName;
    const { error: storageError } = await supabase.storage.from("roof-doctors-private")
      .upload(path, file, { contentType: "application/pdf", upsert: false });
    if (storageError) { setBusy(false); setMessage(storageError.message); return; }
    const { data, error } = await registerFile(supabase, {
      division_id: division, related_type: "property", related_id: propertyId,
      bucket_id: "roof-doctors-private", object_path: path, original_filename: file.name,
      content_type: "application/pdf", file_size_bytes: file.size, uploaded_by: userId,
      metadata: { document_type: "roofr_measurement_report", extraction_status: extractionError ? "extraction_failed" : extracted.measurements.length ? "review_required" : "no_text_matches", extraction_error: extractionError || null, extracted_at: new Date().toISOString(), extracted_measurements: extracted.measurements, extracted_structures: extracted.structures, extracted_text: extracted.text.slice(0, 100000) }
    });
    if (error) {
      await supabase.storage.from("roof-doctors-private").remove([path]);
      setBusy(false); setMessage("Report registration failed. Uploaded file was removed. " + error.message); return;
    }
    setFile(null);
    const picker = document.getElementById("roofr-report-picker") as HTMLInputElement | null;
    if (picker) picker.value = "";
    setMessage(extractionError
      ? "Report uploaded and preserved. Automatic reading could not run: " + extractionError
      : extracted.measurements.length
        ? "Report uploaded. " + extracted.measurements.length + " summary measurements and " + extracted.structures.length + " structure breakdowns were found. Review them before using them in an estimate."
        : "Report uploaded and saved. No matching text measurements were detected. The report is preserved for review.");
    await load();
    const inserted = (await supabase.from("crm_files").select("id,related_id,original_filename,object_path,bucket_id,created_at,metadata").eq("id", data.id).single()).data as ReportRow | null;
    if (inserted) { setReview(inserted); setMeasurements((inserted.metadata?.extracted_measurements as Measurement[]) || []); setStructures((inserted.metadata?.extracted_structures as RoofStructure[]) || []); setWasteFactor("10"); setCustomWasteFactor("20"); }
    setBusy(false);
  }

  async function openReport(row: ReportRow) {
    if (!supabase) return;
    const { data, error } = await supabase.storage.from(row.bucket_id).createSignedUrl(row.object_path, 60);
    if (error) setMessage(error.message);
    else if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function reextractReport(row: ReportRow) {
    if (!supabase) return;
    setBusy(true); setMessage("Re-reading the saved Roofr PDF...");
    const { data, error } = await supabase.storage.from(row.bucket_id).download(row.object_path);
    if (error || !data) { setBusy(false); setMessage(error?.message || "The saved PDF could not be downloaded."); return; }
    try {
      const file = new File([data], row.original_filename, { type: "application/pdf" });
      const extracted = await extractPdfMeasurements(file);
      setReview(row);
      setMeasurements(extracted.measurements);
      setStructures(extracted.structures);
      const savedWaste = Number(row.metadata?.waste_factor_percent || 10);
      setWasteFactor(savedWaste >= 20 ? "20+" : String(savedWaste));
      setCustomWasteFactor(String(Math.max(20, savedWaste)));
      setMessage("Re-extraction complete. Check the values and save the reviewed measurements to update this report.");
    } catch (error) {
      setMessage("The original PDF is safe, but re-extraction failed: " + (error instanceof Error ? error.message : String(error)));
    }
    setBusy(false);
  }

  async function saveReview() {
    if (!supabase || !review) return;
    setBusy(true);
    const finalWasteFactor = wasteFactor === "20+" ? Math.max(20, Number(customWasteFactor) || 20) : Number(wasteFactor);
    const { error } = await supabase.rpc("crm_review_roofr_measurements", { p_file_id: review.id, p_measurements: measurements, p_structures: structures, p_waste_factor: finalWasteFactor });
    if (error) setMessage(error.message);
    else { setMessage("Reviewed measurements saved. Select this property in a new estimate to enter the confirmed quantities."); setReview(null); await load(); }
    setBusy(false);
  }

  return <section className="panel roofr-measurements">
    <div className="panel-heading"><div><p className="eyebrow">ROOFR MEASUREMENTS</p><h3>Roof measurement reports</h3><p className="muted">Upload a Roofr PDF to this property. Extracted quantities are saved with the original report and require review.</p></div></div>
    {properties.length === 0 ? <p className="muted">Add a property before uploading a Roofr report.</p> : <>
      <label className="field-label">Property<select value={propertyId} onChange={e => { setPropertyId(e.target.value); setReview(null); }}><option value="">Select property</option>{properties.map(p => <option key={p.id} value={p.id}>{p.address_line1}, {p.city}, {p.state}</option>)}</select></label>
      {canWrite && <form className="inline-form" onSubmit={upload}>
        <label className="field-label">Roofr measurement PDF<input id="roofr-report-picker" type="file" accept="application/pdf,.pdf" onChange={e => setFile(e.target.files?.[0] || null)} /></label>
        <button className="primary-button" disabled={busy || !file || !propertyId}>{busy ? "Processing report..." : "Upload and extract measurements"}</button>
        <p className="fine-print">PDF only. Maximum 15 MB. The original report is retained in private property storage.</p>
      </form>}
      {message && <p className="inline-message">{message}</p>}
      {reports.length > 0 && <div className="table-wrap"><table><thead><tr><th>Report</th><th>Uploaded</th><th>Extraction</th><th>Action</th></tr></thead><tbody>{reports.map(row => <tr key={row.id}><td data-label="Report">{row.original_filename}</td><td data-label="Uploaded">{new Date(row.created_at).toLocaleDateString()}</td><td data-label="Extraction">{String(row.metadata?.extraction_status || "uploaded").replaceAll("_", " ")}</td><td data-label="Action"><button type="button" className="text-button" onClick={() => { setReview(row); setMeasurements((row.metadata?.extracted_measurements as Measurement[]) || []); setStructures((row.metadata?.extracted_structures as RoofStructure[]) || []); const savedWaste = Number(row.metadata?.waste_factor_percent || 10); setWasteFactor(savedWaste >= 20 ? "20+" : String(savedWaste)); setCustomWasteFactor(String(Math.max(20, savedWaste))); }}>Review</button> <button type="button" className="text-button" disabled={busy} onClick={() => void reextractReport(row)}>Re-extract</button> <button type="button" className="text-button" onClick={() => void openReport(row)}>Open PDF</button></td></tr>)}</tbody></table></div>}
      {review && <div className="content-stack"><h4>Review extracted quantities</h4>
        {measurements.length === 0 ? <p className="muted">No recognizable text quantities were found. This report is still saved. A scanned or image based PDF will need OCR support.</p> :
          <div className="table-wrap"><table><thead><tr><th>Measurement</th><th>Quantity</th><th>Unit</th><th>Source</th></tr></thead><tbody>{measurements.map((item, index) => <tr key={item.label}><td data-label="Measurement">{item.label}</td><td data-label="Quantity"><input type="number" min="0" step="0.01" value={item.value} onChange={e => setMeasurements(current => current.map((m, i) => i === index ? { ...m, value: Number(e.target.value) } : m))} /></td><td data-label="Unit">{item.unit}</td><td data-label="Source">{item.source_label}</td></tr>)}</tbody></table></div>}
        {structures.length > 0 && <div><h4>Individual structure breakdowns</h4><p className="muted">Structure values are reference details only. They are not added to the overall roof totals.</p>{structures.map(structure => <div key={structure.name}><strong>{structure.name}</strong><ul>{structure.measurements.map(item => <li key={item.label}>{item.label}: {item.value.toFixed(2)} {item.unit}</li>)}</ul></div>)}</div>}
        <div className="content-stack"><h4>Roofing waste allowance</h4><p className="muted">Choose one combined allowance based on roof complexity and pitch. It is applied to pitched roof squares only. Flat roofing quantities remain separate.</p>
          <div className="button-row">{["10", "12", "15", "20+"].map(option => <button key={option} type="button" className={wasteFactor === option ? "primary-button" : "secondary-button"} onClick={() => setWasteFactor(option)}>{option === "20+" ? "20%+" : option + "%"}</button>)}</div>
          {wasteFactor === "20+" && <label>Custom waste allowance (%)<input type="number" min="20" max="100" step="1" value={customWasteFactor} onChange={e => setCustomWasteFactor(e.target.value)} /></label>}
          {(() => { const pitched = measurements.find(item => item.label === "Pitched roof squares")?.value || 0; const factor = wasteFactor === "20+" ? Math.max(20, Number(customWasteFactor) || 20) : Number(wasteFactor); return <p><strong>Estimated pitched quantity with {factor}% allowance: {(pitched * (1 + factor / 100)).toFixed(2)} SQ</strong></p>; })()}
        </div>
        <div className="button-row"><button className="primary-button" disabled={busy || (wasteFactor === "20+" && (!(Number(customWasteFactor) >= 20) || Number(customWasteFactor) > 100))} onClick={() => void saveReview()}>Save reviewed measurements</button><button type="button" className="secondary-button" onClick={() => setReview(null)}>Close review</button></div>
        <p className="fine-print">The selected waste allowance is saved with this report. Estimate import adds a separate waste adjusted pitched squares line and preserves all existing estimate lines.</p>
      </div>}
    </>}
  </section>;
}
