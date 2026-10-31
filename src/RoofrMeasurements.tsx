import { useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";

type PropertyOption = { id: string; address_line1: string; city: string; state: string };
type ReportRow = {
  id: string; related_id: string; original_filename: string; object_path: string;
  bucket_id: string; created_at: string; metadata: Record<string, unknown> | null;
};

type Measurement = { label: string; value: number; unit: string; source_label: string };

async function extractPdfMeasurements(file: File): Promise<{ text: string; measurements: Measurement[] }> {
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
    pages.push(content.items.map((item: { str?: string }) => item.str || "").join(" "));
  }
  const text = pages.join("\n");
  const patterns: { label: string; unit: string; regex: RegExp }[] = [
    { label: "Total roof area", unit: "SF", regex: /(?:total\s+(?:roof\s+)?area|roof\s+area)\s*[:\-]?\s*([\d,]+(?:\.\d+)?)\s*(?:sq\.?\s*ft\.?|square\s*feet|sf)\b/i },
    { label: "Roof squares", unit: "SQ", regex: /(?:total\s+)?(?:roof\s+)?squares\s*[:\-]?\s*([\d,]+(?:\.\d+)?)\s*(?:sq\.?\s*)?\b/i },
    { label: "Ridge", unit: "LF", regex: /ridge(?:\s+length)?\s*[:\-]?\s*([\d,]+(?:\.\d+)?)\s*(?:lf|linear\s*ft\.?|ft\.?)/i },
    { label: "Hip", unit: "LF", regex: /hip(?:\s+length)?\s*[:\-]?\s*([\d,]+(?:\.\d+)?)\s*(?:lf|linear\s*ft\.?|ft\.?)/i },
    { label: "Valley", unit: "LF", regex: /valley(?:\s+length)?\s*[:\-]?\s*([\d,]+(?:\.\d+)?)\s*(?:lf|linear\s*ft\.?|ft\.?)/i },
    { label: "Eaves", unit: "LF", regex: /eaves?(?:\s+length)?\s*[:\-]?\s*([\d,]+(?:\.\d+)?)\s*(?:lf|linear\s*ft\.?|ft\.?)/i },
    { label: "Rakes", unit: "LF", regex: /rakes?(?:\s+length)?\s*[:\-]?\s*([\d,]+(?:\.\d+)?)\s*(?:lf|linear\s*ft\.?|ft\.?)/i },
    { label: "Perimeter", unit: "LF", regex: /perimeter\s*[:\-]?\s*([\d,]+(?:\.\d+)?)\s*(?:lf|linear\s*ft\.?|ft\.?)/i }
  ];
  const measurements: Measurement[] = [];
  for (const item of patterns) {
    const match = text.match(item.regex);
    if (match?.[1]) {
      const value = Number(match[1].replace(/,/g, ""));
      if (Number.isFinite(value) && value > 0) measurements.push({ label: item.label, value, unit: item.unit, source_label: match[0] });
    }
  }
  return { text, measurements };
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

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase || !file || !propertyId) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setMessage("Please select a Roofr PDF report."); return;
    }
    if (file.size > 25 * 1024 * 1024) { setMessage("The PDF must be 25 MB or smaller."); return; }
    setBusy(true); setMessage("Reading the Roofr report...");
    let extracted: { text: string; measurements: Measurement[] };
    try { extracted = await extractPdfMeasurements(file); }
    catch (error) {
      setBusy(false); setMessage("The PDF could not be read in this browser. " + (error instanceof Error ? error.message : String(error))); return;
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "roofr-report.pdf";
    const path = division + "/" + propertyId + "/roofr-" + crypto.randomUUID() + "-" + safeName;
    const { error: storageError } = await supabase.storage.from("roof-doctors-private")
      .upload(path, file, { contentType: "application/pdf", upsert: false });
    if (storageError) { setBusy(false); setMessage(storageError.message); return; }
    const { data, error } = await supabase.from("crm_files").insert({
      division_id: division, related_type: "property", related_id: propertyId,
      bucket_id: "roof-doctors-private", object_path: path, original_filename: file.name,
      content_type: "application/pdf", file_size_bytes: file.size, uploaded_by: userId,
      metadata: { document_type: "roofr_measurement_report", extraction_status: extracted.measurements.length ? "review_required" : "no_text_matches", extracted_at: new Date().toISOString(), extracted_measurements: extracted.measurements, extracted_text: extracted.text.slice(0, 100000) }
    }).select("id").single();
    if (error) {
      await supabase.storage.from("roof-doctors-private").remove([path]);
      setBusy(false); setMessage("Report registration failed. Uploaded file was removed. " + error.message); return;
    }
    setFile(null);
    const picker = document.getElementById("roofr-report-picker") as HTMLInputElement | null;
    if (picker) picker.value = "";
    setMessage(extracted.measurements.length
      ? "Report uploaded. " + extracted.measurements.length + " measurement values were found. Review them before using them in an estimate."
      : "Report uploaded and saved. No matching text measurements were detected. The report is preserved for review.");
    await load();
    const inserted = (await supabase.from("crm_files").select("id,related_id,original_filename,object_path,bucket_id,created_at,metadata").eq("id", data.id).single()).data as ReportRow | null;
    if (inserted) { setReview(inserted); setMeasurements((inserted.metadata?.extracted_measurements as Measurement[]) || []); }
    setBusy(false);
  }

  async function openReport(row: ReportRow) {
    if (!supabase) return;
    const { data, error } = await supabase.storage.from(row.bucket_id).createSignedUrl(row.object_path, 60);
    if (error) setMessage(error.message);
    else if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function saveReview() {
    if (!supabase || !review) return;
    setBusy(true);
    const next = { ...(review.metadata || {}), extracted_measurements: measurements, extraction_status: "reviewed", reviewed_at: new Date().toISOString() };
    const { error } = await supabase.from("crm_files").update({ metadata: next }).eq("id", review.id);
    if (error) setMessage(error.message);
    else { setMessage("Reviewed measurements saved. Select this property in a new estimate to enter the confirmed quantities."); setReview(null); await load(); }
    setBusy(false);
  }

  return <section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">ROOFR MEASUREMENTS</p><h3>Roof measurement reports</h3><p className="muted">Upload a Roofr PDF to this property. Extracted quantities are saved with the original report and require review.</p></div></div>
    {properties.length === 0 ? <p className="muted">Add a property before uploading a Roofr report.</p> : <>
      <label>Property<select value={propertyId} onChange={e => { setPropertyId(e.target.value); setReview(null); }}><option value="">Select property</option>{properties.map(p => <option key={p.id} value={p.id}>{p.address_line1}, {p.city}, {p.state}</option>)}</select></label>
      {canWrite && <form className="inline-form" onSubmit={upload}>
        <label className="wide">Roofr measurement PDF<input id="roofr-report-picker" type="file" accept="application/pdf,.pdf" onChange={e => setFile(e.target.files?.[0] || null)} /></label>
        <button className="primary-button" disabled={busy || !file || !propertyId}>{busy ? "Processing report..." : "Upload and extract measurements"}</button>
        <p className="fine-print">PDF only. Maximum 25 MB. The original report is retained in private property storage.</p>
      </form>}
      {message && <p className="inline-message">{message}</p>}
      {reports.length > 0 && <div className="table-wrap"><table><thead><tr><th>Report</th><th>Uploaded</th><th>Extraction</th><th>Action</th></tr></thead><tbody>{reports.map(row => <tr key={row.id}><td>{row.original_filename}</td><td>{new Date(row.created_at).toLocaleDateString()}</td><td>{String(row.metadata?.extraction_status || "uploaded").replaceAll("_", " ")}</td><td><button type="button" className="text-button" onClick={() => { setReview(row); setMeasurements((row.metadata?.extracted_measurements as Measurement[]) || []); }}>Review</button> <button type="button" className="text-button" onClick={() => void openReport(row)}>Open PDF</button></td></tr>)}</tbody></table></div>}
      {review && <div className="content-stack"><h4>Review extracted quantities</h4>
        {measurements.length === 0 ? <p className="muted">No recognizable text quantities were found. This report is still saved. A scanned or image based PDF will need OCR support.</p> :
          <div className="table-wrap"><table><thead><tr><th>Measurement</th><th>Quantity</th><th>Unit</th></tr></thead><tbody>{measurements.map((item, index) => <tr key={item.label}><td>{item.label}</td><td><input type="number" min="0" step="0.01" value={item.value} onChange={e => setMeasurements(current => current.map((m, i) => i === index ? { ...m, value: Number(e.target.value) } : m))} /></td><td>{item.unit}</td></tr>)}</tbody></table></div>}
        <div className="button-row"><button className="primary-button" disabled={busy} onClick={() => void saveReview()}>Save reviewed measurements</button><button type="button" className="secondary-button" onClick={() => setReview(null)}>Close review</button></div>
        <p className="fine-print">These quantities are stored for the property. They are not silently inserted into an existing estimate.</p>
      </div>}
    </>}
  </section>;
}
