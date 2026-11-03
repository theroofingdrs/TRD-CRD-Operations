import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { deliverOperation, requiredParent, verifyRecovery } from "./delivery.ts";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
type DocType = "proposal" | "inspection" | "warranty";
function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function immutableInputs(value: any): any {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) immutableInputs(child);
    Object.freeze(value);
  }
  return value;
}
function money(value: unknown): string {
  return Number(value || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
function wrap(value: string, max = 88): string[] {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > max && line) {
      lines.push(line); line = word;
    } else line = (line ? line + " " : "") + word;
  }
  if (line) lines.push(line);
  return lines;
}
async function makePdf(brand: string, title: string, sections: { heading: string; body: string[] }[], photos: { label: string; caption: string; section: string; bytes: Uint8Array; contentType: string }[], preparedAt: string) {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date(preparedAt));
  pdf.setModificationDate(new Date(preparedAt));
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const accent = rgb(0.88, 0.34, 0.12);
  const ink = rgb(0.13, 0.15, 0.17);
  const muted = rgb(0.38, 0.41, 0.44);
  const pages: any[] = [];
  let page = pdf.addPage([612, 792]);
  pages.push(page);
  let y = 690;
  const newPage = () => {
    page = pdf.addPage([612, 792]);
    pages.push(page);
    y = 724;
  };
  const draw = (text: string, size = 10, isBold = false, color = ink) => {
    const words = text.split(/\s+/);
    let line = "";
    for (const word of words) {
      const candidate = line ? line + " " + word : word;
      if (candidate.length > 92 && line) {
        if (y < 58) newPage();
        page.drawText(line, { x: 48, y, size, font: isBold ? bold : regular, color, maxWidth: 516 });
        y -= size + 6;
        line = word;
      } else line = candidate;
    }
    if (line) {
      if (y < 58) newPage();
      page.drawText(line, { x: 48, y, size, font: isBold ? bold : regular, color, maxWidth: 516 });
      y -= size + 7;
    }
  };
  page.drawRectangle({ x: 0, y: 748, width: 612, height: 44, color: accent });
  page.drawText(brand.toUpperCase(), { x: 48, y: 765, size: 12, font: bold, color: rgb(1, 1, 1), maxWidth: 516 });
  page.drawText(title, { x: 48, y: 718, size: 21, font: bold, color: ink, maxWidth: 516 });
  page.drawText("Prepared " + new Date(preparedAt).toLocaleDateString("en-US", { timeZone: "UTC" }), { x: 48, y: 700, size: 8, font: regular, color: muted });
  y = 670;
  for (const section of sections) {
    if (y < 82) newPage();
    page.drawRectangle({ x: 42, y: y - 5, width: 528, height: 22, color: rgb(0.96, 0.96, 0.95) });
    page.drawRectangle({ x: 42, y: y - 5, width: 4, height: 22, color: accent });
    page.drawText(section.heading, { x: 54, y, size: 11, font: bold, color: ink, maxWidth: 500 });
    y -= 28;
    for (const line of section.body) {
      if (!line) continue;
      draw(line, 9, false, ink);
    }
    y -= 9;
  }
  if (photos.length) {
    if (y < 100) newPage();
    page.drawRectangle({ x: 42, y: y - 5, width: 528, height: 22, color: rgb(0.96, 0.96, 0.95) });
    page.drawRectangle({ x: 42, y: y - 5, width: 4, height: 22, color: accent });
    page.drawText("PHOTO DOCUMENTATION", { x: 54, y, size: 11, font: bold, color: ink });
    y -= 34;
  }
  for (const photo of photos) {
    if (y < 120) newPage();
    draw(photo.label || "Inspection photo", 10, true, ink);
    if (photo.section) draw("Location: " + photo.section, 8, false, muted);
    if (photo.caption) draw(photo.caption, 8, false, ink);
    try {
      const image = photo.contentType === "image/jpeg" ? await pdf.embedJpg(photo.bytes) : await pdf.embedPng(photo.bytes);
      const size = image.scaleToFit(516, 300);
      if (y < size.height + 54) newPage();
      page.drawImage(image, { x: 48, y: y - size.height, width: size.width, height: size.height });
      y -= size.height + 22;
    } catch {
      draw("Image could not be embedded. View the original photo in the CRM.", 8, false, muted);
    }
  }
  pages.forEach((currentPage, index) => {
    currentPage.drawLine({ start: { x: 48, y: 42 }, end: { x: 564, y: 42 }, thickness: 0.6, color: rgb(0.82, 0.83, 0.83) });
    currentPage.drawText(brand + " | " + title, { x: 48, y: 27, size: 7, font: regular, color: muted, maxWidth: 420 });
    currentPage.drawText("Page " + (index + 1) + " of " + pages.length, { x: 490, y: 27, size: 7, font: regular, color: muted });
  });
  return await pdf.save();
}

async function makeProposalPdf(
  division: string, brand: string, title: string, customerName: string, address: string,
  proposalNumber: string, sections: { heading: string; body: string[] }[], totalAmount: unknown,
  claimNumber: string, preparedAt: string
) {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date(preparedAt));
  pdf.setModificationDate(new Date(preparedAt));
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.10, 0.13, 0.17);
  const orange = rgb(0.91, 0.36, 0.16);
  const ink = rgb(0.15, 0.17, 0.20);
  const muted = rgb(0.42, 0.45, 0.49);
  const pale = rgb(0.96, 0.97, 0.97);
  const isResidential = division === "TRD";
  const logoUrl = isResidential
    ? "https://trd-crd-operations-687495157172.us-east1.run.app/brand-assets/the-roof-doctors.png"
    : "https://trd-crd-operations-687495157172.us-east1.run.app/brand-assets/commercial-roof-doctors.png";
  let logo: any = null;
  try {
    const response = await fetch(logoUrl, { signal: AbortSignal.timeout(8000) });
    if (response.ok && (response.headers.get("content-type") || "").includes("image/png")) {
      logo = await pdf.embedPng(new Uint8Array(await response.arrayBuffer()));
    }
  } catch { /* Branded text remains available if the hosted logo cannot be reached. */ }

  const pages: any[] = [];
  let page: any;
  let y = 0;
  const margin = isResidential ? 48 : 42;
  const width = 612 - margin * 2;
  const today = new Date(preparedAt).toLocaleDateString("en-US", { timeZone: "UTC" });
  const addPage = () => {
    page = pdf.addPage([612, 792]);
    pages.push(page);
    page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: 0, y: 786, width: 612, height: 6, color: navy });
    page.drawRectangle({ x: 0, y: 742, width: 612, height: 4, color: orange });
    if (logo) {
      const fitted = logo.scaleToFit(178, 34);
      page.drawImage(logo, { x: margin, y: 750 + (34 - fitted.height) / 2, width: fitted.width, height: fitted.height });
    } else {
      page.drawText(brand.toUpperCase(), { x: margin, y: 760, size: 12, font: bold, color: navy, maxWidth: 300 });
    }
    page.drawText(isResidential ? "(903) 231-5940  |  TheRoofingDrs@gmail.com" : "(903) 231-5940  |  TheRoofingDrs@gmail.com  |  CommercialRoofDoctors.com",
      { x: 300, y: 760, size: 7, font: regular, color: muted, maxWidth: 270 });
    y = 720;
  };
  const wrapLines = (value: string, font: any, size: number, maxWidth: number) => {
    const words = value.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? line + " " + word : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    if (line) lines.push(line);
    return lines;
  };
  const ensure = (needed: number) => { if (y - needed < 58) addPage(); };
  const paragraph = (value: string, size = 8.5, color = ink, indent = 0, boldText = false) => {
    const font = boldText ? bold : regular;
    const lines = wrapLines(value, font, size, width - indent);
    for (const line of lines) {
      ensure(size + 4);
      page.drawText(line, { x: margin + indent, y, size, font, color, maxWidth: width - indent });
      y -= size + 4;
    }
  };
  const sectionHeading = (heading: string) => {
    ensure(27);
    page.drawRectangle({ x: margin, y: y - 4, width, height: 18, color: pale });
    page.drawRectangle({ x: margin, y: y - 4, width: 3, height: 18, color: orange });
    page.drawText(heading.toUpperCase(), { x: margin + 9, y: y + 1, size: 8, font: bold, color: navy });
    y -= 23;
  };
  const drawFooter = () => {
    pages.forEach((p, index) => {
      p.drawLine({ start: { x: margin, y: 40 }, end: { x: 612 - margin, y: 40 }, thickness: 0.6, color: rgb(0.84, 0.85, 0.86) });
      p.drawText(brand + "  |  " + (isResidential ? "ROOFING ESTIMATE" : "COMMERCIAL ROOFING PROPOSAL"),
        { x: margin, y: 26, size: 6.5, font: regular, color: muted, maxWidth: 390 });
      p.drawText("Page " + (index + 1) + " of " + pages.length,
        { x: 500, y: 26, size: 6.5, font: regular, color: muted });
    });
  };

  addPage();
  if (isResidential) {
    page.drawText("ROOFING ESTIMATE", { x: margin, y: 710, size: 19, font: bold, color: navy });
    page.drawText("Estimate Date: " + today, { x: 405, y: 710, size: 8, font: regular, color: muted });
    y = 680;
    page.drawText("PREPARED FOR", { x: margin, y, size: 7, font: bold, color: muted });
    page.drawText("PROPERTY ADDRESS", { x: 330, y, size: 7, font: bold, color: muted });
    y -= 16;
    paragraph(customerName || "Customer", 10, ink, 0, true);
    const addressY = y + 14;
    const addressLines = wrapLines(address || "Property address on file", regular, 8.5, 230);
    addressLines.slice(0, 2).forEach((line, i) => page.drawText(line, { x: 330, y: addressY - i * 11, size: 8.5, font: regular, color: ink, maxWidth: 230 }));
    y -= Math.max(18, addressLines.slice(0, 2).length * 11);
    page.drawRectangle({ x: margin, y: y - 5, width, height: 22, color: pale });
    page.drawText("ESTIMATE NO: " + (proposalNumber || "DRAFT"), { x: margin + 9, y: y + 2, size: 7.5, font: bold, color: navy });
    page.drawText("CLAIM NO: " + (claimNumber || "N/A"), { x: 330, y: y + 2, size: 7.5, font: bold, color: navy });
    y -= 32;

    for (const section of sections) {
      if (section.heading === "Customer and property") continue;
      if (section.heading === "Introduction") {
        paragraph(section.body.join(" "), 8.2, muted);
        y -= 4;
        continue;
      }
      if (section.heading === "Itemized pricing") {
        if (!section.body.length) continue;
        sectionHeading("Description and pricing");
        const col = { desc: margin + 7, qty: 350, rate: 414, amount: 500 };
        page.drawText("DESCRIPTION", { x: col.desc, y, size: 6.5, font: bold, color: muted });
        page.drawText("QTY", { x: col.qty, y, size: 6.5, font: bold, color: muted });
        page.drawText("RATE", { x: col.rate, y, size: 6.5, font: bold, color: muted });
        page.drawText("AMOUNT", { x: col.amount, y, size: 6.5, font: bold, color: muted });
        y -= 12;
        for (let i = 0; i < section.body.length; i += 4) {
          const description = section.body[i] || "";
          const unitPrice = section.body[i + 1] || "";
          const quantity = section.body[i + 2] || "";
          const lineTotal = section.body[i + 3] || "";
          const qtyMatch = quantity.match(/(?:Billable quantity:\s*)?([\d,.]+(?:\s+\w+)?)/i);
          const rateMatch = unitPrice.match(/\$[\d,.]+/);
          const amountMatch = lineTotal.match(/\$[\d,.]+/);
          const lines = wrapLines(description, regular, 7.5, 285);
          const rowHeight = Math.max(17, lines.length * 9 + 6);
          ensure(rowHeight + 2);
          page.drawLine({ start: { x: margin + 5, y: y - 4 }, end: { x: 612 - margin - 5, y: y - 4 }, thickness: 0.35, color: rgb(0.88, 0.89, 0.90) });
          lines.forEach((line, index) => page.drawText(line, { x: col.desc, y: y - index * 9, size: 7.5, font: regular, color: ink, maxWidth: 285 }));
          page.drawText(qtyMatch?.[1] || "", { x: col.qty, y, size: 7.5, font: regular, color: ink, maxWidth: 55 });
          page.drawText(rateMatch?.[0] || "", { x: col.rate, y, size: 7.5, font: regular, color: ink, maxWidth: 70 });
          page.drawText(amountMatch?.[0] || "", { x: col.amount, y, size: 7.5, font: regular, color: ink, maxWidth: 65 });
          y -= rowHeight;
        }
        y -= 7;
        continue;
      }
      if (section.heading === "Itemized total") {
        sectionHeading("Estimate summary");
        for (const line of section.body) {
          const isTotal = /^Total\b/i.test(line);
          ensure(16);
          page.drawText(line, { x: isTotal ? margin + 8 : margin + 14, y, size: isTotal ? 10 : 8, font: isTotal ? bold : regular, color: isTotal ? navy : ink, maxWidth: width - 20 });
          y -= isTotal ? 16 : 12;
        }
        continue;
      }
      sectionHeading(section.heading);
      for (const line of section.body) paragraph(line, 8.2);
      y -= 4;
    }
    if (totalAmount != null) {
      ensure(42);
      page.drawRectangle({ x: margin, y: y - 26, width, height: 36, color: navy });
      page.drawText("ESTIMATE TOTAL", { x: margin + 11, y: y - 4, size: 8, font: bold, color: rgb(1, 1, 1) });
      page.drawText(money(totalAmount), { x: 430, y: y - 9, size: 15, font: bold, color: rgb(1, 1, 1) });
      y -= 47;
    }
    paragraph("This estimate is based on the information and conditions currently available. Final scope and quantities are subject to field verification and written approval.", 7.2, muted);
    ensure(45);
    y -= 5;
    page.drawLine({ start: { x: margin, y }, end: { x: 320, y }, thickness: 0.7, color: muted });
    page.drawLine({ start: { x: 350, y }, end: { x: 612 - margin, y }, thickness: 0.7, color: muted });
    page.drawText("CUSTOMER / AUTHORIZED SIGNATURE", { x: margin, y: y - 12, size: 6, font: bold, color: muted });
    page.drawText("DATE", { x: 350, y: y - 12, size: 6, font: bold, color: muted });
  } else {
    page.drawText(title || "COMMERCIAL ROOFING PROPOSAL", { x: margin, y: 710, size: 18, font: bold, color: navy, maxWidth: width });
    y = 680;
    page.drawText("PREPARED FOR", { x: margin, y, size: 7, font: bold, color: muted });
    page.drawText("PROJECT LOCATION", { x: 350, y, size: 7, font: bold, color: muted });
    page.drawText(customerName || "Customer", { x: margin, y: y - 15, size: 10, font: bold, color: ink, maxWidth: 285 });
    const addressLines = wrapLines(address || "Property address on file", regular, 8.5, 210);
    addressLines.slice(0, 2).forEach((line, i) => page.drawText(line, { x: 350, y: y - 15 - i * 11, size: 8.5, font: regular, color: ink, maxWidth: 210 }));
    y -= 42;
    page.drawRectangle({ x: margin, y: y - 5, width, height: 22, color: pale });
    page.drawText("PROPOSAL " + (proposalNumber || "DRAFT"), { x: margin + 9, y: y + 2, size: 7.5, font: bold, color: navy });
    page.drawText("PREPARED " + today, { x: 400, y: y + 2, size: 7.5, font: bold, color: navy });
    y -= 32;
    let forcedBreak = false;
    for (const section of sections) {
      if (section.heading === "Customer and property") continue;
      if (!forcedBreak && /^(Scope of work|Itemized pricing|Roofr measurement report)$/i.test(section.heading)) {
        addPage();
        forcedBreak = true;
      }
      sectionHeading(section.heading === "Itemized total" ? "Estimate summary" : section.heading);
      for (const line of section.body) {
        const isTotal = section.heading === "Itemized total" && /^Total\b/i.test(line);
        paragraph(line, isTotal ? 10 : 8.8, isTotal ? navy : ink, 0, isTotal);
      }
      y -= 7;
    }
    addPage();
    page.drawText("PROPOSAL ACCEPTANCE", { x: margin, y: 700, size: 17, font: bold, color: navy });
    y = 650;
    paragraph("The undersigned acknowledges the scope, pricing, exclusions, and terms described in this proposal and authorizes the work as presented, subject to the agreed written contract.", 10);
    y -= 36;
    page.drawLine({ start: { x: margin, y }, end: { x: 285, y }, thickness: 0.8, color: muted });
    page.drawLine({ start: { x: 330, y }, end: { x: 612 - margin, y }, thickness: 0.8, color: muted });
    page.drawText("AUTHORIZED SIGNATURE", { x: margin, y: y - 13, size: 6.5, font: bold, color: muted });
    page.drawText("DATE", { x: 330, y: y - 13, size: 6.5, font: bold, color: muted });
    y -= 48;
    page.drawLine({ start: { x: margin, y }, end: { x: 285, y }, thickness: 0.8, color: muted });
    page.drawLine({ start: { x: 330, y }, end: { x: 612 - margin, y }, thickness: 0.8, color: muted });
    page.drawText("PRINTED NAME / TITLE", { x: margin, y: y - 13, size: 6.5, font: bold, color: muted });
    page.drawText("COMPANY", { x: 330, y: y - 13, size: 6.5, font: bold, color: muted });
  }
  drawFooter();
  return await pdf.save();
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Authentication required." }, 401);
  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
  const resendKey = Deno.env.get("RESEND_API_KEY") || "";
  const from = Deno.env.get("RESEND_FROM_EMAIL") || "";
  if (!url || !key) return json({ error: "Supabase server configuration is missing." }, 500);
  if (!resendKey || !from) return json({ error: "Customer email is not configured. Add RESEND_API_KEY and RESEND_FROM_EMAIL to the Supabase function secrets." }, 503);
  let input: { document_type?: DocType; document_id?: string; action?: string; delivery_id?: string; provider_id?: string; evidence?: string };
  try { input = await req.json(); } catch { return json({ error: "Request body must be valid JSON." }, 400); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return json({ error: "Request body must be an object." }, 400);
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: auth, error: authError } = await client.auth.getUser(authorization.slice(7));
  if (authError || !auth.user) return json({ error: "Your sign in has expired. Sign in again." }, 401);

  if (input.action === "reconcile") {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!serviceKey || !/^[0-9a-f-]{36}$/i.test(input.delivery_id || "") || typeof input.provider_id !== "string" || typeof input.evidence !== "string" || input.evidence.trim().length < 3) return json({ error: "Delivery ID, provider email ID and evidence reference required." }, 400);
    const server = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    try {
      const { data: operation, error } = await server.rpc("crm_delivery_reconciliation", { p_actor: auth.user.id, p_id: input.delivery_id });
      if (error || !operation) return json({ error: "Exact division owner authorization required." }, 403);
      const context = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(operation.context_fingerprint == null ? resendKey : JSON.stringify([resendKey, from, operation.render_snapshot_id ? "crm-pdf-v3" : "crm-pdf-v2"])));
      const fingerprint = Array.from(new Uint8Array(context)).map(b => b.toString(16).padStart(2,"0")).join("");
      if (fingerprint !== operation.provider_context) throw new Error("Provider context changed.");
      const event = await verifyRecovery(operation, input.provider_id, resendKey);
      const { data, error: updateError } = await server.rpc("crm_delivery_reconciliation", { p_actor: auth.user.id, p_id: input.delivery_id, p_provider: input.provider_id, p_event: event, p_evidence: input.evidence });
      if (updateError || !data || data.status !== "accepted") throw new Error("Reconciliation persistence failed.");
      return json({ success: true, ...data });
    } catch { return json({ error: "Recovery could not be verified and persisted. No resend was attempted." }, 409); }
  }
  const type = input.document_type;
  const id = clean(input.document_id);
  if (!["proposal", "inspection", "warranty"].includes(type || "") || !/^[0-9a-f-]{36}$/i.test(id)) {
    return json({ error: "Select a valid document and document ID." }, 400);
  }
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!serviceKey) return json({ error: "Trusted delivery storage is not configured." }, 503);
  const server = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  // Caller-JWT capture is one database snapshot; the trusted boundary freezes it.
  const { data: inputs, error: inputsError } = await client.rpc("crm_document_render_inputs", { p_type: type, p_document: id });
  if (inputsError || !inputs) return json({ error: "Document not found or snapshot access denied." }, 404);
  const { data: snapshot, error: freezeError } = await server.rpc("crm_freeze_document_render", {
    p_actor: auth.user.id, p_type: type, p_document: id, p_inputs: inputs,
  });
  if (freezeError || !snapshot) return json({ error: "Rendering snapshot could not be authorized and frozen." }, 409);
  const frozen = immutableInputs(snapshot.inputs);
  const deliveryContext = snapshot.context;
  // No database rendering reads follow this point. Cached retries use the exact body.
  const data: any = { ...frozen.document, updated_at: snapshot.current_version,
    crm_customers: frozen.customer, crm_properties: frozen.property };
  let requestBody: string;
  if (snapshot.cached_body) {
    requestBody = snapshot.cached_body;
  } else {
    let division = "";
    let customerId = "";
    let propertyId = "";
    let recipient = "";
    let customerName = "";
    let address = "";
    let title = "";
    let brand = "";
    let proposalNumber = "";
    let proposalTotal: number | null = null;
    let proposalClaimNumber = "";
    const sections: { heading: string; body: string[] }[] = [];
    const photoImages: { label: string; caption: string; section: string; bytes: Uint8Array; contentType: string }[] = [];
    const extraAttachments: { filename: string; content: string }[] = [];
    if (type === "proposal") {
      division = data.division_id; customerId = data.customer_id; propertyId = data.property_id;
      let customer: any; let property: any;
      try {
        customer = requiredParent(data.crm_customers, customerId);
        property = requiredParent(data.crm_properties, propertyId);
        if (property.customer_id !== customerId) throw new Error();
      } catch { return json({ error: "Inconsistent document relationship." }, 403); }
      recipient = clean(customer.email); customerName = clean(customer.display_name);
      address = [property.address_line1,property.city,property.state,property.postal_code].filter(Boolean).join(", ");
      title = data.title;
      proposalNumber = clean(data.proposal_number);
      proposalTotal = Number(data.total_amount || 0);
      proposalClaimNumber = clean(data.template_data?.claim_number);
      const savedTemplate = frozen.template;
      brand = clean(savedTemplate?.company_name) || (division === "TRD" ? "The ROOF Doctors" : "Commercial ROOF Doctors");
      if (savedTemplate?.introduction) sections.push({ heading: "Introduction", body: [savedTemplate.introduction] });
      sections.push({ heading: "Customer and property", body: [customerName, address, data.proposal_number ? "Proposal " + data.proposal_number : ""] });
      if (data.existing_conditions) sections.push({ heading: "Existing conditions", body: [data.existing_conditions] });
      const roofrReportId = clean(data.template_data?.roofr_report_id);
      if (roofrReportId) {
        const roofrFile = frozen.report;
        if (!roofrFile || roofrFile.division_id !== division || roofrFile.related_type !== "property" || roofrFile.related_id !== propertyId || roofrFile.metadata?.document_type !== "roofr_measurement_report") return json({ error: "Required Roofr report relationship is unavailable or inconsistent." }, 403);
        if (roofrFile.metadata.document_type === "roofr_measurement_report") {
          const roofrValues = Array.isArray(roofrFile.metadata?.extracted_measurements) ? roofrFile.metadata.extracted_measurements : [];
          sections.push({ heading: "Roofr measurement report", body: [
            "Source report: " + clean(roofrFile.original_filename),
            ...roofrValues.map((item: any) => clean(item.label) + ": " + String(item.value) + " " + clean(item.unit)),
            "The original Roofr PDF is attached separately to this email."
          ] });
          const { data: roofrPdf } = await client.storage.from(roofrFile.bucket_id).download(roofrFile.object_path);
          if (!roofrPdf) return json({ error: "Required Roofr report bytes are unavailable." }, 503);
          if (roofrPdf) extraAttachments.push({
            filename: "Roofr-" + clean(roofrFile.original_filename).replace(/[^a-zA-Z0-9._-]/g, "_"),
            content: toBase64(new Uint8Array(await roofrPdf.arrayBuffer()))
          });
        }
      }
      const proposalScope = clean(data.scope_of_work) || clean(savedTemplate?.default_scope);
      if (proposalScope) sections.push({ heading: "Scope of work", body: [proposalScope] });
      if (Array.isArray(data.line_items) && data.line_items.length) sections.push({ heading: "Itemized pricing", body: data.line_items.flatMap((item: any) => [
        String(item.description) + " | Qty " + item.quantity + " " + clean(item.unit),
        "All-in price (materials and labor): " + money(item.unit_price) + " per " + clean(item.unit),
        "Billable quantity: " + String(item.billable_quantity ?? item.quantity),
        "Line total: " + money(item.amount)
      ]) });
      const pricingBreakdown = data.template_data?.pricing_breakdown || {};
      if (data.pricing_mode !== "lump_sum") sections.push({ heading: "Itemized total", body: [
        "All-in line item subtotal (materials and labor) " + money(pricingBreakdown.raw_item_subtotal ?? pricingBreakdown.base_subtotal ?? data.subtotal),
        ...(Number(pricingBreakdown.complexity_amount || 0) > 0 ? ["Complexity adjustment (" + String(pricingBreakdown.complexity_rate_percent) + "%) " + money(pricingBreakdown.complexity_amount)] : []),
        ...(Number(pricingBreakdown.pitch_amount || 0) > 0 ? ["Pitch adjustment (" + String(pricingBreakdown.pitch_rate_percent) + "%) " + money(pricingBreakdown.pitch_amount)] : []),
        "Subtotal before overhead " + money(pricingBreakdown.base_subtotal ?? data.subtotal),
        ...(pricingBreakdown.overhead_enabled ? ["Overhead (" + String(pricingBreakdown.overhead_rate_percent ?? 10) + "%) " + money(pricingBreakdown.overhead_amount)] : []),
        ...(pricingBreakdown.profit_enabled ? ["Profit (" + String(pricingBreakdown.profit_rate_percent ?? 10) + "% of subtotal plus overhead) " + money(pricingBreakdown.profit_amount)] : []),
        "Subtotal before tax " + money(data.subtotal),
        "Tax" + (pricingBreakdown.tax_rate_percent != null ? " (" + String(pricingBreakdown.tax_rate_percent) + "%)" : "") + " " + money(data.tax_amount),
        "Total " + money(data.total_amount)
      ] });
      if (data.lump_sum_amount != null) sections.push({ heading: "Lump sum option", body: [
        "Total including selected overhead, profit and tax " + money(data.lump_sum_amount)
      ] });
      const proposalExclusions = clean(data.exclusions) || clean(savedTemplate?.default_exclusions);
      if (proposalExclusions) sections.push({ heading: "Exclusions", body: [proposalExclusions] });
      const proposalPaymentTerms = clean(data.payment_terms) || clean(savedTemplate?.payment_terms);
      if (proposalPaymentTerms) sections.push({ heading: "Payment terms", body: [proposalPaymentTerms] });
      const proposalWarranty = clean(data.warranty_summary) || clean(savedTemplate?.warranty_summary);
      if (proposalWarranty) sections.push({ heading: "Warranty", body: [proposalWarranty] });
      if (data.valid_until) sections.push({ heading: "Valid through", body: [data.valid_until] });
      if (savedTemplate?.footer_text) sections.push({ heading: "Thank you", body: [savedTemplate.footer_text] });
    } else if (type === "inspection") {
      division = data.division_id; customerId = data.customer_id; propertyId = data.property_id;
      let customer: any; let property: any;
      try {
        customer = requiredParent(data.crm_customers, customerId);
        property = requiredParent(data.crm_properties, propertyId);
        if (property.customer_id !== customerId) throw new Error();
      } catch { return json({ error: "Inconsistent document relationship." }, 403); }
      recipient = clean(customer.email); customerName = clean(customer.display_name);
      address = [property.address_line1,property.city,property.state,property.postal_code].filter(Boolean).join(", ");
      title = "Roof inspection report"; brand = division === "TRD" ? "The ROOF Doctors" : "Commercial ROOF Doctors";
      sections.push({ heading: "Customer and property", body: [customerName, address, "Inspection type: " + data.inspection_type, "Inspected: " + (data.inspected_at || "Not recorded"), "Overall condition: " + (data.overall_condition || "Not recorded"), "Weather: " + (data.weather_conditions || "Not recorded")] });
      const measurements = data.measurements || {};
      const measurementLines = [
        "Roof area: " + (measurements.roof_area_sq_ft ?? "Not recorded") + " sq ft",
        "Roof squares: " + (measurements.roof_squares ?? "Not recorded"),
        "Pitch / slope: " + (measurements.pitch ?? "Not recorded")
      ];
      if (measurements.roofr_report_name) measurementLines.push("Source Roofr report: " + measurements.roofr_report_name);
      if (Array.isArray(measurements.roofr_measurements) && measurements.roofr_measurements.length) {
        for (const item of measurements.roofr_measurements) {
          measurementLines.push("Roofr " + clean(item.label) + ": " + String(item.value) + " " + clean(item.unit));
        }
      }
      sections.push({ heading: "Measurements", body: measurementLines });
      const inspectionRoofrReportId = clean(measurements.roofr_report_id);
      if (inspectionRoofrReportId) {
        const roofrFile = frozen.report;
        if (!roofrFile || roofrFile.division_id !== division || roofrFile.related_type !== "property" || roofrFile.related_id !== propertyId || roofrFile.metadata?.document_type !== "roofr_measurement_report") return json({ error: "Required Roofr report relationship is unavailable or inconsistent." }, 403);
        if (roofrFile.metadata.document_type === "roofr_measurement_report") {
          const { data: roofrPdf } = await client.storage.from(roofrFile.bucket_id).download(roofrFile.object_path);
          if (!roofrPdf) return json({ error: "Required Roofr report bytes are unavailable." }, 503);
          if (roofrPdf) extraAttachments.push({
            filename: "Roofr-" + clean(roofrFile.original_filename).replace(/[^a-zA-Z0-9._-]/g, "_"),
            content: toBase64(new Uint8Array(await roofrPdf.arrayBuffer()))
          });
        }
      }
      const claim = data.claim_information || {};
      const claimLines = [
        ["Insurance carrier", claim.carrier], ["Policy number", claim.policy_number],
        ["Claim number", claim.claim_number], ["Adjuster", claim.adjuster_name],
        ["Adjuster phone", claim.adjuster_phone], ["Adjuster email", claim.adjuster_email]
      ].filter((entry: any[]) => entry[1]).map((entry: any[]) => entry[0] + ": " + entry[1]);
      if (claimLines.length) sections.push({ heading: "Insurance and claim information", body: claimLines });
      const items = frozen.items;
      sections.push({ heading: "Checklist findings", body: (items || []).map((item: any) => item.category + (item.location ? " (" + item.location + ")" : "") + ": " + item.observation + (item.severity && item.severity !== "none" ? " | Severity: " + item.severity : "") + (item.recommendation ? " | Recommendation: " + item.recommendation : "")) });
      if (data.roof_sections?.length) sections.push({ heading: "Roof sections", body: data.roof_sections.map((s: any) => s.name || "Section") });
      if (data.summary) sections.push({ heading: "Summary", body: [data.summary] });
      if (data.recommendations) sections.push({ heading: "Recommendations", body: [data.recommendations] });
      const photos = frozen.photos;
      if (photos?.length) {
        sections.push({ heading: "Attached inspection photos", body: photos.map((p: any) => [p.photo_label,p.roof_section,p.caption].filter(Boolean).join(" | ")) });
        for (const photo of photos as any[]) {
          let file: any;
          try {
            file = requiredParent(photo.crm_files, photo.file_id);
            if (file.division_id !== division || file.related_type !== "inspection" || file.related_id !== id || file.bucket_id !== "roof-doctors-private") throw new Error();
          } catch { return json({ error: "Inspection photo relationship is inconsistent." }, 403); }
          if (!["image/jpeg","image/png"].includes(file.content_type)) continue;
          const { data: imageFile } = await client.storage.from(file.bucket_id).download(file.object_path);
          if (!imageFile) return json({ error: "Required inspection photo bytes are unavailable." }, 503);
          if (imageFile) photoImages.push({
            label: photo.photo_label || "Inspection photo", caption: photo.caption || "",
            section: photo.roof_section || "", bytes: new Uint8Array(await imageFile.arrayBuffer()), contentType: file.content_type
          });
        }
      }
    } else {
      division = data.division_id; customerId = data.customer_id; propertyId = data.property_id;
      let customer: any; let property: any;
      try {
        customer = requiredParent(data.crm_customers, customerId);
        property = requiredParent(data.crm_properties, propertyId);
        if (property.customer_id !== customerId) throw new Error();
      } catch { return json({ error: "Inconsistent document relationship." }, 403); }
      recipient = clean(customer.email); customerName = clean(customer.display_name);
      address = [property.address_line1,property.city,property.state,property.postal_code].filter(Boolean).join(", ");
      title = data.title; brand = division === "TRD" ? "The ROOF Doctors" : "Commercial ROOF Doctors";
      sections.push({ heading: "Customer and property", body: [customerName, address] });
      sections.push({ heading: "Warranty details", body: ["Type: " + data.warranty_type, "Provider: " + (data.provider_name || "Not specified"), "Roof system: " + (data.roof_system || "Not specified"), "Start date: " + (data.start_date || "Not specified"), "End date: " + (data.end_date || "Not specified")] });
      if (data.coverage_summary) sections.push({ heading: "Coverage", body: [data.coverage_summary] });
      if (data.exclusions) sections.push({ heading: "Exclusions", body: [data.exclusions] });
      if (data.maintenance_requirements) sections.push({ heading: "Maintenance requirements", body: [data.maintenance_requirements] });
    }
    if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return json({ error: "This customer does not have a valid email address on file." }, 400);
    const subject = brand + ": " + (type === "inspection" ? "Roof inspection report" : title);
    const pdfBytes = type === "proposal"
      ? await makeProposalPdf(division, brand, title, customerName, address, proposalNumber, sections, proposalTotal, proposalClaimNumber, snapshot.captured_at)
      : await makePdf(brand, title, sections, photoImages, snapshot.captured_at);
    const base64 = toBase64(new Uint8Array(pdfBytes));
    const fileName = type + "-" + id + ".pdf";
    requestBody = JSON.stringify({
      from, to: [recipient], subject,
      html: "<p>Hello " + customerName.replace(/[&<>"]/g, "") + ",</p><p>Attached is your document from " + brand + ".</p>",
      attachments: [{ filename: fileName, content: base64 }, ...extraAttachments],
    });
  }
  const providerBody = JSON.parse(requestBody);
  const pdfBytesForHash = Uint8Array.from(atob(providerBody.attachments[0].content), c => c.charCodeAt(0));
  const artifactDigest = await crypto.subtle.digest("SHA-256", pdfBytesForHash);
  const artifactHash = Array.from(new Uint8Array(artifactDigest)).map(b => b.toString(16).padStart(2,"0")).join("");
  const reservationBody = JSON.stringify({ ...providerBody, _crm_context: deliveryContext,
    _crm_snapshot: snapshot.id, _crm_pdf_sha256: artifactHash });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([resendKey, from, "crm-pdf-v3"])));
  const providerContext = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
  try {
    const { data: operation, error: claimError } = await server.rpc("crm_claim_document_delivery", {
      p_actor: auth.user.id, p_type: type, p_document: id, p_version: snapshot.current_version, p_body: reservationBody, p_context: providerContext,
    });
    if (claimError || !operation) return json({ error: "Delivery authorization or operation reservation failed. Reload the document before retrying." }, 409);
    const result = await deliverOperation(operation, resendKey, async (status, provider, error) => {
      const { error: persistenceError } = await server.rpc("crm_finish_document_delivery", { p_id: operation.id, p_claim: operation.claim, p_status: status, p_provider: provider, p_error: error });
      if (persistenceError) throw new Error("Delivery outcome could not be persisted.");
    });
    return json(result, result.success ? 200 : 202);
  } catch { return json({ error: "Delivery outcome is not confirmed durably. Retry the same document; do not create another send. Contact an owner for reconciliation." }, 503); }
});
