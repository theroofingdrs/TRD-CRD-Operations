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
  const words = value.split(/\\s+/);
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
async function makePdf(brand: string, title: string, sections: { heading: string; body: string[] }[]) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]);
  let y = 742;
  const draw = (text: string, size = 10, isBold = false) => {
    if (y < 54) { page = pdf.addPage([612, 792]); y = 742; }
    page.drawText(text, { x: 48, y, size, font: isBold ? bold : regular, color: rgb(0.12, 0.15, 0.18), maxWidth: 516 });
    y -= size + 7;
  };
  draw(brand.toUpperCase(), 11, true);
  draw(title, 20, true);
  y -= 8;
  for (const section of sections) {
    draw(section.heading, 12, true);
    for (const line of section.body) for (const wrapped of wrap(line)) draw(wrapped, 9);
    y -= 8;
  }
  draw("Prepared from the Roof Doctors Operations CRM.", 8);
  return await pdf.save();
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
  if (type === "proposal") {
    const { data, error } = await client.from("crm_proposals").select("id,division_id,customer_id,property_id,title,proposal_number,pricing_mode,line_items,lump_sum_amount,subtotal,tax_amount,total_amount,scope_of_work,existing_conditions,exclusions,payment_terms,warranty_summary,valid_until,crm_customers(display_name,email),crm_properties(address_line1,city,state,postal_code)").eq("id", id).single();
    if (error || !data) return json({ error: "Proposal not found or access denied." }, 404);
    division = data.division_id; customerId = data.customer_id; propertyId = data.property_id;
    recipient = clean(data.crm_customers?.email); customerName = clean(data.crm_customers?.display_name);
    address = [data.crm_properties?.address_line1,data.crm_properties?.city,data.crm_properties?.state,data.crm_properties?.postal_code].filter(Boolean).join(", ");
    title = data.title; brand = division === "TRD" ? "The ROOF Doctors" : "Commercial ROOF Doctors";
    sections.push({ heading: "Customer and property", body: [customerName, address, data.proposal_number ? "Proposal " + data.proposal_number : ""] });
    if (data.existing_conditions) sections.push({ heading: "Existing conditions", body: [data.existing_conditions] });
    if (data.scope_of_work) sections.push({ heading: "Scope of work", body: [data.scope_of_work] });
    if (Array.isArray(data.line_items) && data.line_items.length) sections.push({ heading: "Itemized pricing", body: data.line_items.map((item: any) => String(item.description) + " | Qty " + item.quantity + " | " + money(item.unit_price) + " each | " + money(item.amount)) });
    if (data.pricing_mode !== "lump_sum") sections.push({ heading: "Itemized total", body: ["Subtotal " + money(data.subtotal), "Tax " + money(data.tax_amount), "Total " + money(data.total_amount)] });
    if (data.lump_sum_amount != null) sections.push({ heading: "Lump sum option", body: [money(data.lump_sum_amount)] });
    if (data.exclusions) sections.push({ heading: "Exclusions", body: [data.exclusions] });
    if (data.payment_terms) sections.push({ heading: "Payment terms", body: [data.payment_terms] });
    if (data.warranty_summary) sections.push({ heading: "Warranty", body: [data.warranty_summary] });
    if (data.valid_until) sections.push({ heading: "Valid through", body: [data.valid_until] });
  } else if (type === "inspection") {
    const { data, error } = await client.from("crm_inspections").select("id,division_id,customer_id,property_id,inspection_type,inspected_at,weather_conditions,overall_condition,summary,recommendations,measurements,roof_sections,crm_customers(display_name,email),crm_properties(address_line1,city,state,postal_code)").eq("id", id).single();
    if (error || !data) return json({ error: "Inspection not found or access denied." }, 404);
    division = data.division_id; customerId = data.customer_id; propertyId = data.property_id;
    recipient = clean(data.crm_customers?.email); customerName = clean(data.crm_customers?.display_name);
    address = [data.crm_properties?.address_line1,data.crm_properties?.city,data.crm_properties?.state,data.crm_properties?.postal_code].filter(Boolean).join(", ");
    title = "Roof inspection report"; brand = division === "TRD" ? "The ROOF Doctors" : "Commercial ROOF Doctors";
    sections.push({ heading: "Customer and property", body: [customerName, address, "Inspection type: " + data.inspection_type, "Inspected: " + (data.inspected_at || "Not recorded"), "Overall condition: " + (data.overall_condition || "Not recorded"), "Weather: " + (data.weather_conditions || "Not recorded")] });
    const measurements = data.measurements || {};
    sections.push({ heading: "Measurements", body: ["Roof area: " + (measurements.roof_area_sq_ft ?? "Not recorded") + " sq ft", "Roof squares: " + (measurements.roof_squares ?? "Not recorded"), "Pitch / slope: " + (measurements.pitch ?? "Not recorded")] });
    const { data: items } = await client.from("crm_inspection_items").select("category,location,observation,severity,recommendation").eq("inspection_id", id).order("created_at");
    sections.push({ heading: "Checklist findings", body: (items || []).map((item: any) => item.category + (item.location ? " (" + item.location + ")" : "") + ": " + item.observation + (item.severity && item.severity !== "none" ? " | Severity: " + item.severity : "") + (item.recommendation ? " | Recommendation: " + item.recommendation : "")) });
    if (data.roof_sections?.length) sections.push({ heading: "Roof sections", body: data.roof_sections.map((s: any) => s.name || "Section") });
    if (data.summary) sections.push({ heading: "Summary", body: [data.summary] });
    if (data.recommendations) sections.push({ heading: "Recommendations", body: [data.recommendations] });
    const { data: photos } = await client.from("crm_inspection_photos").select("photo_label,caption,roof_section").eq("inspection_id", id).order("created_at");
    if (photos?.length) sections.push({ heading: "Attached inspection photos", body: photos.map((p: any) => [p.photo_label,p.roof_section,p.caption].filter(Boolean).join(" | ")) });
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
  if (!recipient || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(recipient)) return json({ error: "This customer does not have a valid email address on file." }, 400);
  const subject = brand + ": " + (type === "inspection" ? "Roof inspection report" : title);
  const pdfBytes = await makePdf(brand, title, sections);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(pdfBytes)));
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
  return json({ success: true, recipient, delivery_id: delivery.id, provider_message_id: responseBody.id || null });
});
