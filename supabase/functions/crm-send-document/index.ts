import { createClient } from "npm:@supabase/supabase-js@2.58.0";
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
async function makePdf(brand: string, title: string, sections: { heading: string; body: string[] }[], photos: { label: string; caption: string; section: string; bytes: Uint8Array; contentType: string }[] = []) {
  const pdf = await PDFDocument.create();
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
  page.drawText("Prepared " + new Date().toLocaleDateString("en-US"), { x: 48, y: 700, size: 8, font: regular, color: muted });
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
  let input: { document_type?: DocType; document_id?: string };
  try { input = await req.json(); } catch { return json({ error: "Request body must be valid JSON." }, 400); }
  const type = input.document_type;
  const id = clean(input.document_id);
  if (!["proposal", "inspection", "warranty"].includes(type || "") || !/^[0-9a-f-]{36}$/i.test(id)) {
    return json({ error: "Select a valid document and document ID." }, 400);
  }
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: auth, error: authError } = await client.auth.getUser(authorization.slice(7));
  if (authError || !auth.user) return json({ error: "Your sign in has expired. Sign in again." }, 401);

  let division = "";
  let customerId = "";
  let propertyId = "";
  let recipient = "";
  let customerName = "";
  let address = "";
  let title = "";
  let brand = "";
  const sections: { heading: string; body: string[] }[] = [];
  const photoImages: { label: string; caption: string; section: string; bytes: Uint8Array; contentType: string }[] = [];
  if (type === "proposal") {
    const { data, error } = await client.from("crm_proposals").select("id,division_id,customer_id,property_id,title,proposal_number,pricing_mode,line_items,lump_sum_amount,subtotal,tax_amount,total_amount,scope_of_work,existing_conditions,exclusions,payment_terms,warranty_summary,valid_until,crm_customers(display_name,email),crm_properties(address_line1,city,state,postal_code)").eq("id", id).single();
    if (error || !data) return json({ error: "Proposal not found or access denied." }, 404);
    division = data.division_id; customerId = data.customer_id; propertyId = data.property_id;
    recipient = clean(data.crm_customers?.email); customerName = clean(data.crm_customers?.display_name);
    address = [data.crm_properties?.address_line1,data.crm_properties?.city,data.crm_properties?.state,data.crm_properties?.postal_code].filter(Boolean).join(", ");
    title = data.title;
    const { data: savedTemplate } = await client.from("crm_proposal_templates")
      .select("company_name,introduction,default_scope,default_exclusions,payment_terms,warranty_summary,footer_text")
      .eq("division_id", division).maybeSingle();
    brand = clean(savedTemplate?.company_name) || (division === "TRD" ? "The ROOF Doctors" : "Commercial ROOF Doctors");
    if (savedTemplate?.introduction) sections.push({ heading: "Introduction", body: [savedTemplate.introduction] });
    sections.push({ heading: "Customer and property", body: [customerName, address, data.proposal_number ? "Proposal " + data.proposal_number : ""] });
    if (data.existing_conditions) sections.push({ heading: "Existing conditions", body: [data.existing_conditions] });
    const proposalScope = clean(data.scope_of_work) || clean(savedTemplate?.default_scope);
    if (proposalScope) sections.push({ heading: "Scope of work", body: [proposalScope] });
    if (Array.isArray(data.line_items) && data.line_items.length) sections.push({ heading: "Itemized pricing", body: data.line_items.map((item: any) => String(item.description) + " | Qty " + item.quantity + " | " + money(item.unit_price) + " each | " + money(item.amount)) });
    if (data.pricing_mode !== "lump_sum") sections.push({ heading: "Itemized total", body: ["Subtotal " + money(data.subtotal), "Tax " + money(data.tax_amount), "Total " + money(data.total_amount)] });
    if (data.lump_sum_amount != null) sections.push({ heading: "Lump sum option", body: [money(data.lump_sum_amount)] });
    const proposalExclusions = clean(data.exclusions) || clean(savedTemplate?.default_exclusions);
    if (proposalExclusions) sections.push({ heading: "Exclusions", body: [proposalExclusions] });
    const proposalPaymentTerms = clean(data.payment_terms) || clean(savedTemplate?.payment_terms);
    if (proposalPaymentTerms) sections.push({ heading: "Payment terms", body: [proposalPaymentTerms] });
    const proposalWarranty = clean(data.warranty_summary) || clean(savedTemplate?.warranty_summary);
    if (proposalWarranty) sections.push({ heading: "Warranty", body: [proposalWarranty] });
    if (data.valid_until) sections.push({ heading: "Valid through", body: [data.valid_until] });
    if (savedTemplate?.footer_text) sections.push({ heading: "Thank you", body: [savedTemplate.footer_text] });
  } else if (type === "inspection") {
    const { data, error } = await client.from("crm_inspections").select("id,division_id,customer_id,property_id,inspection_type,inspected_at,weather_conditions,overall_condition,summary,recommendations,measurements,roof_sections,claim_information,crm_customers(display_name,email),crm_properties(address_line1,city,state,postal_code)").eq("id", id).single();
    if (error || !data) return json({ error: "Inspection not found or access denied." }, 404);
    division = data.division_id; customerId = data.customer_id; propertyId = data.property_id;
    recipient = clean(data.crm_customers?.email); customerName = clean(data.crm_customers?.display_name);
    address = [data.crm_properties?.address_line1,data.crm_properties?.city,data.crm_properties?.state,data.crm_properties?.postal_code].filter(Boolean).join(", ");
    title = "Roof inspection report"; brand = division === "TRD" ? "The ROOF Doctors" : "Commercial ROOF Doctors";
    sections.push({ heading: "Customer and property", body: [customerName, address, "Inspection type: " + data.inspection_type, "Inspected: " + (data.inspected_at || "Not recorded"), "Overall condition: " + (data.overall_condition || "Not recorded"), "Weather: " + (data.weather_conditions || "Not recorded")] });
    const measurements = data.measurements || {};
    sections.push({ heading: "Measurements", body: ["Roof area: " + (measurements.roof_area_sq_ft ?? "Not recorded") + " sq ft", "Roof squares: " + (measurements.roof_squares ?? "Not recorded"), "Pitch / slope: " + (measurements.pitch ?? "Not recorded")] });
    const claim = data.claim_information || {};
    const claimLines = [
      ["Insurance carrier", claim.carrier], ["Policy number", claim.policy_number],
      ["Claim number", claim.claim_number], ["Adjuster", claim.adjuster_name],
      ["Adjuster phone", claim.adjuster_phone], ["Adjuster email", claim.adjuster_email]
    ].filter((entry: any[]) => entry[1]).map((entry: any[]) => entry[0] + ": " + entry[1]);
    if (claimLines.length) sections.push({ heading: "Insurance and claim information", body: claimLines });
    const { data: items } = await client.from("crm_inspection_items").select("category,location,observation,severity,recommendation").eq("inspection_id", id).order("created_at");
    sections.push({ heading: "Checklist findings", body: (items || []).map((item: any) => item.category + (item.location ? " (" + item.location + ")" : "") + ": " + item.observation + (item.severity && item.severity !== "none" ? " | Severity: " + item.severity : "") + (item.recommendation ? " | Recommendation: " + item.recommendation : "")) });
    if (data.roof_sections?.length) sections.push({ heading: "Roof sections", body: data.roof_sections.map((s: any) => s.name || "Section") });
    if (data.summary) sections.push({ heading: "Summary", body: [data.summary] });
    if (data.recommendations) sections.push({ heading: "Recommendations", body: [data.recommendations] });
    const { data: photos } = await client.from("crm_inspection_photos").select("photo_label,caption,roof_section,crm_files(bucket_id,object_path,content_type)").eq("inspection_id", id).order("created_at");
    if (photos?.length) {
      sections.push({ heading: "Attached inspection photos", body: photos.map((p: any) => [p.photo_label,p.roof_section,p.caption].filter(Boolean).join(" | ")) });
      for (const photo of photos as any[]) {
        const file = photo.crm_files;
        if (!file || !["image/jpeg","image/png"].includes(file.content_type)) continue;
        const { data: imageFile } = await client.storage.from(file.bucket_id).download(file.object_path);
        if (imageFile) photoImages.push({
          label: photo.photo_label || "Inspection photo", caption: photo.caption || "",
          section: photo.roof_section || "", bytes: new Uint8Array(await imageFile.arrayBuffer()), contentType: file.content_type
        });
      }
    }
  } else {
    const { data, error } = await client.from("crm_warranties").select("id,division_id,customer_id,property_id,title,warranty_type,provider_name,roof_system,coverage_summary,exclusions,maintenance_requirements,start_date,end_date,crm_customers(display_name,email),crm_properties(address_line1,city,state,postal_code)").eq("id", id).single();
    if (error || !data) return json({ error: "Warranty not found or access denied." }, 404);
    division = data.division_id; customerId = data.customer_id; propertyId = data.property_id;
    recipient = clean(data.crm_customers?.email); customerName = clean(data.crm_customers?.display_name);
    address = [data.crm_properties?.address_line1,data.crm_properties?.city,data.crm_properties?.state,data.crm_properties?.postal_code].filter(Boolean).join(", ");
    title = data.title; brand = division === "TRD" ? "The ROOF Doctors" : "Commercial ROOF Doctors";
    sections.push({ heading: "Customer and property", body: [customerName, address] });
    sections.push({ heading: "Warranty details", body: ["Type: " + data.warranty_type, "Provider: " + (data.provider_name || "Not specified"), "Roof system: " + (data.roof_system || "Not specified"), "Start date: " + (data.start_date || "Not specified"), "End date: " + (data.end_date || "Not specified")] });
    if (data.coverage_summary) sections.push({ heading: "Coverage", body: [data.coverage_summary] });
    if (data.exclusions) sections.push({ heading: "Exclusions", body: [data.exclusions] });
    if (data.maintenance_requirements) sections.push({ heading: "Maintenance requirements", body: [data.maintenance_requirements] });
  }
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return json({ error: "This customer does not have a valid email address on file." }, 400);
  const subject = brand + ": " + (type === "inspection" ? "Roof inspection report" : title);
  const pdfBytes = await makePdf(brand, title, sections, photoImages);
  const base64 = toBase64(new Uint8Array(pdfBytes));
  const fileName = type + "-" + id + ".pdf";
  const { data: delivery, error: deliveryError } = await client.from("crm_document_deliveries").insert({
    division_id: division, document_type: type, document_id: id, customer_id: customerId, property_id: propertyId,
    recipient_email: recipient, subject, status: "sending", created_by: auth.user.id
  }).select("id").single();
  if (deliveryError || !delivery) return json({ error: "Could not create the document delivery record: " + (deliveryError?.message || "unknown error") }, 500);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + resendKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      from, to: [recipient], subject,
      html: "<p>Hello " + customerName.replace(/[&<>"]/g, "") + ",</p><p>Attached is your " + (type === "inspection" ? "roof inspection report" : type) + " from " + brand + " for " + address.replace(/[&<>"]/g, "") + ".</p><p>Please contact our office with any questions.</p>",
      attachments: [{ filename: fileName, content: base64 }]
    })
  });
  const responseBody = await response.json().catch(() => ({}));
  if (!response.ok) {
    await client.from("crm_document_deliveries").update({ status: "failed", error_message: JSON.stringify(responseBody).slice(0, 1000) }).eq("id", delivery.id);
    return json({ error: "Email provider rejected the message.", details: responseBody }, 502);
  }
  await client.from("crm_document_deliveries").update({ status: "sent", provider_message_id: responseBody.id || null, sent_at: new Date().toISOString() }).eq("id", delivery.id);
  if (type === "proposal") await client.from("crm_proposals").update({ status: "sent" }).eq("id", id);
  return json({ success: true, recipient, delivery_id: delivery.id, provider_message_id: responseBody.id || null });
});
