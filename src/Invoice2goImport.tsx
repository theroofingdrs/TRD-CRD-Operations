import { useMemo, useState } from "react";
import { supabase } from "./lib/supabase";

type DivisionId = "TRD" | "CRD";
type ClientRow = {
  sourceRow: number;
  name: string;
  customerType: "individual" | "business" | "organization";
  email: string;
  phone: string;
  alternatePhone: string;
  address: string;
  address2: string;
  city: string;
  state: string;
  postal: string;
  notes: string;
  raw: Record<string, string>;
};
type HistoricalRow = {
  sourceRow: number;
  type: "invoice" | "estimate" | "credit_memo" | "other";
  customerName: string;
  customerEmail: string;
  number: string;
  date: string;
  dueDate: string;
  status: string;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  raw: Record<string, string>;
  sourceKey: string;
};
type Attachment = { file: File; customerId: string; customerName: string; type: "invoice" | "estimate" | "photo" | "other" };

const clean = (value: unknown) => String(value ?? "").trim();
const key = (value: unknown) => clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const money = (value: unknown) => {
  const n = Number(clean(value).replace(/[$,()]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(n) && clean(value) ? n : null;
};
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"' && quoted && input[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
function rowsFromCsv(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => key(h));
  return rows.slice(1).map((cells) => Object.fromEntries(headers.map((h, i) => [h, clean(cells[i])])));
}
function pick(row: Record<string, string>, aliases: string[]) {
  for (const alias of aliases) if (clean(row[key(alias)])) return clean(row[key(alias)]);
  return "";
}
function clientFrom(row: Record<string, string>, index: number): ClientRow | null {
  let name = pick(row, ["client name", "customer name", "name", "company name", "business name", "display name"]);
  if (!name) {
    const first = pick(row, ["first name", "firstname", "given name"]);
    const last = pick(row, ["last name", "lastname", "surname"]);
    name = [first, last].filter(Boolean).join(" ");
  }
  if (!name) return null;
  const email = pick(row, ["email", "email address", "client email", "customer email"]);
  const phone = pick(row, ["phone", "phone number", "mobile", "client phone", "customer phone"]);
  const address = pick(row, ["address", "address line 1", "street", "street address", "billing address", "client address"]);
  const city = pick(row, ["city", "town"]);
  const state = pick(row, ["state", "province", "region"]);
  const postal = pick(row, ["zip", "zip code", "postal code", "postcode"]);
  const business = pick(row, ["company name", "business name", "business", "organization"]);
  return {
    sourceRow: index + 2, name, customerType: business ? "business" : "individual", email, phone,
    alternatePhone: pick(row, ["alternate phone", "secondary phone", "work phone"]),
    address, address2: pick(row, ["address 2", "address line 2", "suite", "unit"]),
    city, state, postal, notes: pick(row, ["notes", "client notes", "customer notes", "description"]), raw: row
  };
}
function docFrom(row: Record<string, string>, index: number, filename: string): HistoricalRow | null {
  const lower = filename.toLowerCase();
  const rawType = pick(row, ["document type", "type", "kind"]).toLowerCase();
  const type: HistoricalRow["type"] = lower.includes("estimate") || rawType.includes("estimate") ? "estimate"
    : lower.includes("credit") || rawType.includes("credit") ? "credit_memo"
    : lower.includes("invoice") || rawType.includes("invoice") || !!pick(row, ["invoice number", "invoice no"]) ? "invoice" : "other";
  const number = pick(row, ["invoice number", "invoice no", "estimate number", "estimate no", "number", "document number", "id"]);
  const customerName = pick(row, ["client name", "customer name", "client", "customer", "name", "bill to"]);
  const customerEmail = pick(row, ["email", "client email", "customer email"]);
  if (type === "other" && !number) return null;
  return {
    sourceRow: index + 2, type, customerName, customerEmail, number,
    date: pick(row, ["date", "invoice date", "estimate date", "created date", "issue date"]),
    dueDate: pick(row, ["due date", "payment due", "due"]),
    status: pick(row, ["status", "payment status"]),
    subtotal: money(pick(row, ["subtotal", "sub total", "net amount"])),
    tax: money(pick(row, ["tax", "tax amount", "sales tax"])),
    total: money(pick(row, ["total", "amount", "total amount", "invoice total", "estimate total", "grand total"])),
    raw: row, sourceKey: key(filename) + "-" + (index + 2)
  };
}
async function unzip(file: File): Promise<File[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("This ZIP file could not be read.");
  const count = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  const output: File[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) break;
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (view.getUint32(localOffset, true) !== 0x04034b50) continue;
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(start, start + compressedSize);
    let content: ArrayBuffer;
    if (method === 0) content = compressed.slice().buffer;
    else if (method === 8 && typeof DecompressionStream !== "undefined") {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      content = await new Response(stream).arrayBuffer();
    } else throw new Error("ZIP compression method not supported for " + name);
    output.push(new File([content], name.split("/").pop() || name, { type: mimeFor(name) }));
  }
  return output;
}
function mimeFor(name: string) {
  const ext = name.toLowerCase().split(".").pop();
  return ext === "pdf" ? "application/pdf" : ext === "jpg" || ext === "jpeg" ? "image/jpeg"
    : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "csv" ? "text/csv"
    : ext === "json" ? "application/json" : "application/octet-stream";
}
function classifyAttachment(file: File): Attachment["type"] {
  const n = file.name.toLowerCase();
  if (n.includes("invoice")) return "invoice";
  if (n.includes("estimate") || n.includes("quote")) return "estimate";
  if (/\.(jpg|jpeg|png|webp)$/i.test(n)) return "photo";
  return "other";
}

export default function ImportCenter({ division, userId }: { division: DivisionId; userId: string }) {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [historical, setHistorical] = useState<HistoricalRow[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [existing, setExisting] = useState<{ id: string; display_name: string; email: string | null; phone: string | null }[]>([]);
  const [batchName, setBatchName] = useState("Invoice2go migration");
  const [shareBoth, setShareBoth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const preview = useMemo(() => clients.map((client) => {
    const match = existing.find((row) =>
      (client.email && row.email && key(client.email) === key(row.email)) ||
      (client.phone && row.phone && key(client.phone) === key(row.phone)) ||
      key(client.name) === key(row.display_name)
    );
    return { ...client, matched: match || null };
  }), [clients, existing]);

  async function loadExisting() {
    if (!supabase) return;
    const { data: links, error: linkError } = await supabase.from("crm_customer_divisions").select("customer_id").eq("division_id", division);
    if (linkError) throw linkError;
    const ids = (links || []).map((r: { customer_id: string }) => r.customer_id);
    if (!ids.length) { setExisting([]); return; }
    const { data, error } = await supabase.from("crm_customers").select("id,display_name,email,phone").in("id", ids);
    if (error) throw error;
    setExisting((data || []) as typeof existing);
  }

  async function readFiles(list: FileList | File[]) {
    setBusy(true); setMessage(""); setErrors([]);
    try {
      let expanded: File[] = [];
      for (const file of Array.from(list)) {
        if (file.name.toLowerCase().endsWith(".zip")) expanded.push(...await unzip(file));
        else expanded.push(file);
      }
      const clientRows: ClientRow[] = [];
      const docRows: HistoricalRow[] = [];
      const docs: Attachment[] = [];
      for (const file of expanded) {
        const name = file.name.toLowerCase();
        if (name.endsWith(".csv") || name.endsWith(".tsv") || name.endsWith(".txt")) {
          const text = await file.text();
          const csvText = name.endsWith(".tsv") ? text.replace(/\t/g, ",") : text;
          const parsed = rowsFromCsv(csvText);
          parsed.forEach((row, i) => {
            const client = clientFrom(row, i);
            if (client && (name.includes("client") || name.includes("customer") || (!name.includes("invoice") && !name.includes("estimate") && !name.includes("expense")))) clientRows.push(client);
            const doc = docFrom(row, i, name);
            if (doc && (name.includes("invoice") || name.includes("estimate") || doc.type !== "other")) docRows.push(doc);
          });
        } else if (name.endsWith(".json")) {
          const data = JSON.parse(await file.text());
          const records = Array.isArray(data) ? data : Array.isArray(data.clients) ? data.clients : Array.isArray(data.data) ? data.data : [];
          records.forEach((item: Record<string, unknown>, i: number) => {
            const row = Object.fromEntries(Object.entries(item).map(([k, v]) => [key(k), clean(v)]));
            const client = clientFrom(row, i);
            if (client) clientRows.push(client);
          });
        } else if (/\.(pdf|jpg|jpeg|png|webp)$/i.test(name)) {
          docs.push({ file, customerId: "", customerName: "", type: classifyAttachment(file) });
        }
      }
      const deduped = new Map<string, ClientRow>();
      clientRows.forEach((r) => deduped.set(key(r.email || r.phone || r.name) + "|" + key(r.address), r));
      setClients(Array.from(deduped.values()));
      setHistorical(docRows);
      setAttachments(docs);
      await loadExisting();
      setLoaded(true);
      setMessage("Files analyzed. Review the customer matches and document assignments before importing.");
    } catch (error) {
      setErrors([error instanceof Error ? error.message : "The selected files could not be read."]);
    } finally { setBusy(false); }
  }

  function assignAttachment(index: number, customerId: string) {
    const customer = preview.find((r) => r.matched?.id === customerId) || preview.find((r) => r.name === customerId);
    setAttachments((current) => current.map((item, i) => i === index ? { ...item, customerId, customerName: customer?.name || customer?.matched?.display_name || "" } : item));
  }

  async function commitImport() {
    if (!supabase || !clients.length) return;
    setBusy(true); setMessage(""); setErrors([]);
    const failures: string[] = [];
    let created = 0, matched = 0, propertiesCreated = 0, documentsCreated = 0, uploaded = 0;
    const customerMap = new Map<string, string>();
    try {
      const { data: batch, error: batchError } = await supabase.from("crm_import_batches").insert({
        division_id: division, source_system: "Invoice2go", batch_name: batchName.trim() || "Invoice2go migration",
        source_files: { customer_rows: clients.length, historical_rows: historical.length, attachments: attachments.length },
        created_by: userId
      }).select("id").single();
      if (batchError) throw batchError;
      for (const client of clients) {
        try {
          const existingMatch = existing.find((row) =>
            (client.email && row.email && key(client.email) === key(row.email)) ||
            (client.phone && row.phone && key(client.phone) === key(row.phone)) ||
            key(client.name) === key(row.display_name)
          );
          let customerId = existingMatch?.id || "";
          if (customerId) matched++;
          else {
            const { data, error } = await supabase.from("crm_customers").insert({
              display_name: client.name, customer_type: client.customerType, email: client.email || null,
              phone: client.phone || null, alternate_phone: client.alternatePhone || null,
              billing_address_line1: client.address || null, billing_address_line2: client.address2 || null,
              billing_city: client.city || null, billing_state: client.state || null,
              billing_postal_code: client.postal || null, notes: client.notes || null, created_by: userId
            }).select("id").single();
            if (error) throw error;
            customerId = data.id; created++;
          }
          const divisionIds: DivisionId[] = shareBoth ? ["TRD", "CRD"] : [division];
          const { error: linkError } = await supabase.from("crm_customer_divisions").upsert(
            divisionIds.map((division_id) => ({ customer_id: customerId, division_id })),
            { onConflict: "customer_id,division_id", ignoreDuplicates: true }
          );
          if (linkError) throw linkError;
          if (client.address && client.city) {
            const { data: foundProperty, error: propertyLookupError } = await supabase.from("crm_properties")
              .select("id").eq("customer_id", customerId).ilike("address_line1", client.address).ilike("city", client.city).limit(1).maybeSingle();
            if (propertyLookupError) throw propertyLookupError;
            if (!foundProperty) {
              const { error } = await supabase.from("crm_properties").insert({
                customer_id: customerId, address_line1: client.address, address_line2: client.address2 || null,
                city: client.city, state: client.state || "TX", postal_code: client.postal || null
              });
              if (error) throw error;
              propertiesCreated++;
            }
          }
          customerMap.set(key(client.name), customerId);
          if (client.email) customerMap.set(key(client.email), customerId);
        } catch (error) { failures.push(client.name + ": " + (error instanceof Error ? error.message : "save failed")); }
      }
      for (const item of historical) {
        try {
          const customerId = customerMap.get(key(item.customerEmail)) || customerMap.get(key(item.customerName));
          if (!customerId) { failures.push("Historical " + (item.number || "document") + ": customer could not be matched"); continue; }
          const { error } = await supabase.from("crm_historical_documents").upsert({
            division_id: division, customer_id: customerId, document_type: item.type,
            document_number: item.number || null, document_date: item.date || null, due_date: item.dueDate || null,
            status: item.status || null, subtotal: item.subtotal, tax_amount: item.tax, total_amount: item.total,
            source_system: "Invoice2go", source_record_id: item.sourceKey, import_batch_id: batch.id,
            original_filename: null, metadata: item.raw, created_by: userId
          }, { onConflict: "division_id,source_system,source_record_id", ignoreDuplicates: true });
          if (error) throw error;
          documentsCreated++;
        } catch (error) { failures.push("Historical document: " + (error instanceof Error ? error.message : "save failed")); }
      }
      for (const item of attachments) {
        try {
          let customerId = item.customerId;
          if (!customerId) {
            const match = preview.find((row) => item.file.name.toLowerCase().includes(row.name.toLowerCase()));
            if (match) customerId = match.matched?.id || customerMap.get(key(match.name)) || "";
          }
          if (!customerId) { failures.push(item.file.name + ": assign this file to a customer before importing"); continue; }
          if (item.file.size > 15 * 1024 * 1024) { failures.push(item.file.name + ": exceeds the 15 MB file limit"); continue; }
          const safeName = item.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const objectPath = division + "/" + customerId + "/invoice2go/" + batch.id + "/" + safeName;
          const { error: uploadError } = await supabase.storage.from("roof-doctors-private").upload(objectPath, item.file, { contentType: item.file.type || mimeFor(item.file.name), upsert: false });
          if (uploadError) throw uploadError;
          const { data: fileRow, error: fileError } = await supabase.from("crm_files").insert({
            division_id: division, related_type: "customer", related_id: customerId, bucket_id: "roof-doctors-private",
            object_path: objectPath, original_filename: item.file.name, content_type: item.file.type || mimeFor(item.file.name),
            file_size_bytes: item.file.size, uploaded_by: userId,
            metadata: { source_system: "Invoice2go", import_batch_id: batch.id, historical_document_type: item.type }
          }).select("id").single();
          if (fileError) throw fileError;
          const { error: historyError } = await supabase.from("crm_historical_documents").insert({
            division_id: division, customer_id: customerId, document_type: item.type === "photo" ? "photo" : item.type,
            original_filename: item.file.name, storage_file_id: fileRow.id, source_system: "Invoice2go",
            import_batch_id: batch.id, metadata: { imported_as_attachment: true }, created_by: userId
          });
          if (historyError) throw historyError;
          uploaded++;
        } catch (error) { failures.push(item.file.name + ": " + (error instanceof Error ? error.message : "upload failed")); }
      }
      await supabase.from("crm_import_batches").update({
        completed_at: new Date().toISOString(),
        summary: { customers_created: created, customers_matched: matched, properties_created: propertiesCreated, historical_documents_created: documentsCreated, attachments_uploaded: uploaded, failures }
      }).eq("id", batch.id);
      setErrors(failures);
      setMessage("Import finished. " + created + " new customers, " + matched + " existing customers matched, " + propertiesCreated + " properties, " + documentsCreated + " historical records, and " + uploaded + " files imported.");
      await loadExisting();
    } catch (error) {
      setErrors(failures);
      setMessage(error instanceof Error ? error.message : "Import failed.");
    } finally { setBusy(false); }
  }

  return <div className="content-stack">
    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">DATA MIGRATION</p><h2>Import customers and history</h2><p className="muted">Bring Invoice2go customers, estimates, invoices, and original attachments into this CRM.</p></div><span className="pill">Private import</span></div>
      <div className="inline-form">
        <div className="form-grid">
          <label>Import batch name<input value={batchName} onChange={(e) => setBatchName(e.target.value)} /></label>
          <label>Import into division<select value={division} disabled><option value="TRD">The Roof Doctors (Residential)</option><option value="CRD">Commercial Roof Doctors</option></select></label>
          <label className="wide">Select Invoice2go export files<input type="file" multiple accept=".csv,.tsv,.txt,.json,.zip,.pdf,.jpg,.jpeg,.png,.webp" onChange={(e) => e.target.files && void readFiles(e.target.files)} /><small>CSV, TSV, JSON, ZIP, PDF, JPG, PNG, and WebP. ZIP archives are unpacked in your browser. Nothing is uploaded until you confirm.</small></label>
          <label className="wide"><span><input type="checkbox" checked={shareBoth} onChange={(e) => setShareBoth(e.target.checked)} /> Share imported customer records with both TRD and CRD</span><small>Use only when the customer belongs to both companies. Financial and historical documents remain assigned to the selected division.</small></label>
        </div>
      </div>
      {message && <p className="inline-message">{message}</p>}
      {errors.length > 0 && <div className="error-banner"><strong>{errors.length} item(s) need attention</strong><ul>{errors.slice(0, 12).map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
    </section>
    {loaded && <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">IMPORT REVIEW</p><h2>Review before importing</h2><p className="muted">Existing customers are matched and reused. Existing information is never overwritten.</p></div></div>
      <div className="stat-grid">
        <div className="stat-card"><span>Customer rows</span><strong>{clients.length}</strong></div>
        <div className="stat-card"><span>Existing matches</span><strong>{preview.filter((r) => r.matched).length}</strong></div>
        <div className="stat-card"><span>Historical rows</span><strong>{historical.length}</strong></div>
        <div className="stat-card"><span>Attachments</span><strong>{attachments.length}</strong></div>
      </div>
      {clients.length > 0 && <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Email</th><th>Phone</th><th>Address</th><th>Import action</th></tr></thead><tbody>{preview.slice(0, 100).map((row, i) => <tr key={i}><td><strong>{row.name}</strong></td><td>{row.email || "—"}</td><td>{row.phone || "—"}</td><td>{[row.address,row.city,row.state,row.postal].filter(Boolean).join(", ") || "—"}</td><td>{row.matched ? "Match: " + row.matched.display_name : "Create new customer"}</td></tr>)}</tbody></table>{preview.length > 100 && <p className="muted">Showing first 100 of {preview.length} customer rows.</p>}</div>}
      {attachments.length > 0 && <div className="inline-form"><h3>Assign original files</h3><p className="muted">Files are matched by filename when possible. Choose a customer for any unassigned file.</p>{attachments.map((item, i) => <label key={i}>{item.file.name}<select value={item.customerId} onChange={(e) => assignAttachment(i, e.target.value)}><option value="">Select customer</option>{preview.map((row, j) => <option key={j} value={row.matched?.id || row.name}>{row.name}{row.matched ? " (existing)" : ""}</option>)}</select></label>)}</div>}
      <div className="panel-actions"><button className="primary-button" disabled={busy || !clients.length} onClick={() => void commitImport()}>{busy ? "Importing..." : "Confirm and import records"}</button></div>
      <p className="fine-print">Historical estimates and invoices remain archived records. They will not become active proposals, invoices, revenue, or current pipeline items.</p>
    </section>}
  </div>;
}
