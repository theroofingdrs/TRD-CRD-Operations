import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function readKey(singleName: string, mapName: string): string {
  const direct = Deno.env.get(singleName);
  if (direct) return direct;
  try {
    const values = JSON.parse(Deno.env.get(mapName) ?? "{}") as Record<string, string>;
    return values.default ?? Object.values(values)[0] ?? "";
  } catch {
    return "";
  }
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedStatus(value: string): string {
  const status = value.toLowerCase().replaceAll(" ", "_");
  const allowed = ["new", "contacted", "qualified", "appointment_set", "inspection_pending", "estimate_in_progress", "proposal_sent", "won", "lost", "on_hold"];
  return allowed.includes(status) ? status : "new";
}

function normalizedPriority(value: string): string {
  const priority = value.toLowerCase();
  return ["low", "normal", "high", "urgent"].includes(priority) ? priority : "normal";
}

function normalizedContactMethod(value: string, email: string, phone: string): string {
  const method = value.toLowerCase();
  if (method.includes("text")) return "text";
  if (method.includes("email")) return "email";
  if (method.includes("phone") || method.includes("call")) return "phone";
  if (email) return "email";
  if (phone) return "phone";
  return "other";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Authentication required." }, 401);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const publishableKey = readKey("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEYS") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
  const secretKey = readKey("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS") || Deno.env.get("SUPABASE_SECRET_KEY") || "";
  if (!url || !publishableKey || !secretKey) return json({ error: "The server is missing required Supabase configuration." }, 500);

  const token = authHeader.slice("Bearer ".length);
  const caller = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data: authData, error: authError } = await caller.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "Your sign in has expired. Sign in again." }, 401);

  let body: { division_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }
  const divisionId = body.division_id;
  if (divisionId !== "TRD" && divisionId !== "CRD") return json({ error: "Select TRD or CRD." }, 400);

  const { data: ownerMembership, error: membershipError } = await caller
    .from("crm_memberships")
    .select("division_id")
    .eq("user_id", authData.user.id)
    .eq("division_id", divisionId)
    .eq("role", "owner")
    .eq("active", true)
    .maybeSingle();

  if (membershipError || !ownerMembership) return json({ error: "Only an active CRM owner for this division can import website leads." }, 403);

  const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: records, error: intakeError } = await admin
    .from("trd_records")
    .select("id,record_type,payload,created_at")
    .eq("record_type", "lead")
    .order("created_at", { ascending: true });

  if (intakeError) return json({ error: "Unable to read website intake records." }, 500);

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const record of records ?? []) {
    const payload = (record.payload ?? {}) as Record<string, unknown>;
    const rawDivision = clean(payload.division).toUpperCase();
    const recordDivision = rawDivision.includes("COMMERCIAL") ? "CRD" : rawDivision.includes("RESIDENTIAL") ? "TRD" : "";
    if (recordDivision !== divisionId) continue;

    const { data: existingLead, error: duplicateCheckError } = await admin
      .from("crm_leads")
      .select("id")
      .eq("source_record_id", record.id)
      .maybeSingle();

    if (duplicateCheckError) {
      failed++;
      failures.push("Could not check duplicate status for " + record.id);
      continue;
    }
    if (existingLead) {
      skipped++;
      continue;
    }

    try {
      const contactRecord = (payload.contactRecord && typeof payload.contactRecord === "object" ? payload.contactRecord : {}) as Record<string, unknown>;
      const organizationRecord = (payload.organizationRecord && typeof payload.organizationRecord === "object" ? payload.organizationRecord : {}) as Record<string, unknown>;
      const propertyRecord = (payload.propertyRecord && typeof payload.propertyRecord === "object" ? payload.propertyRecord : {}) as Record<string, unknown>;

      const firstName = clean(contactRecord.firstName);
      const lastName = clean(contactRecord.lastName);
      const contactName = [firstName, lastName].filter(Boolean).join(" ") || clean(payload.name);
      const companyName = clean(organizationRecord.companyName);
      const displayName = companyName || contactName || clean(payload.email) || "Website inquiry";
      const email = clean(contactRecord.email) || clean(payload.email);
      const phone = clean(contactRecord.phone) || clean(payload.phone);
      const preferredMethod = normalizedContactMethod(clean(payload.preferredContactMethod), email, phone);
      const customerType = companyName ? "business" : "individual";

      let customerId: string | null = null;
      if (email) {
        const { data } = await admin.from("crm_customers").select("id").ilike("email", email).limit(1).maybeSingle();
        customerId = data?.id ?? null;
      }
      if (!customerId && displayName) {
        const { data } = await admin.from("crm_customers").select("id").eq("display_name", displayName).limit(1).maybeSingle();
        customerId = data?.id ?? null;
      }

      if (!customerId) {
        const { data, error } = await admin.from("crm_customers").insert({
          display_name: displayName,
          legal_name: companyName || null,
          customer_type: customerType,
          email: email || null,
          phone: phone || null,
          preferred_contact_method: preferredMethod,
          created_by: authData.user.id,
        }).select("id").single();
        if (error || !data) throw new Error("Customer creation failed.");
        customerId = data.id;
      }

      const { error: divisionLinkError } = await admin
        .from("crm_customer_divisions")
        .upsert({ customer_id: customerId, division_id: divisionId }, { onConflict: "customer_id,division_id", ignoreDuplicates: true });
      if (divisionLinkError) throw new Error("Customer division link failed.");

      let contactId: string | null = null;
      const fullName = contactName || displayName;
      if (fullName) {
        let contactQuery = admin.from("crm_contacts").select("id").eq("customer_id", customerId).limit(1);
        if (email) contactQuery = contactQuery.ilike("email", email);
        else contactQuery = contactQuery.eq("full_name", fullName);
        const { data: existingContact } = await contactQuery.maybeSingle();
        contactId = existingContact?.id ?? null;

        if (!contactId) {
          const { data, error } = await admin.from("crm_contacts").insert({
            customer_id: customerId,
            full_name: fullName,
            title: clean(contactRecord.role) || null,
            email: email || null,
            phone: phone || null,
            is_primary: true,
            notes: clean(organizationRecord.notes) || null,
          }).select("id").single();
          if (error || !data) throw new Error("Contact creation failed.");
          contactId = data.id;
        }
      }

      const address = clean(propertyRecord.address) || clean(payload.address);
      const city = clean(propertyRecord.city) || clean(payload.city);
      const state = clean(propertyRecord.state) || clean(payload.state);
      const postalCode = clean(propertyRecord.zip) || clean(payload.zip);
      let propertyId: string | null = null;

      if (address && city && state) {
        const { data: existingProperty } = await admin.from("crm_properties")
          .select("id")
          .eq("customer_id", customerId)
          .ilike("address_line1", address)
          .ilike("city", city)
          .ilike("state", state)
          .limit(1)
          .maybeSingle();
        propertyId = existingProperty?.id ?? null;

        if (!propertyId) {
          const rawPropertyType = (clean(propertyRecord.propertyType) || clean(payload.propertyType) || (divisionId === "CRD" ? "commercial" : "residential")).toLowerCase();
          const propertyType = rawPropertyType.includes("multi") ? "multifamily" : rawPropertyType.includes("industrial") ? "industrial" : rawPropertyType.includes("commercial") ? "commercial" : rawPropertyType.includes("church") || rawPropertyType.includes("school") ? "institutional" : "residential";
          const { data, error } = await admin.from("crm_properties").insert({
            customer_id: customerId,
            property_name: clean(propertyRecord.propertyName) || null,
            address_line1: address,
            city,
            state,
            postal_code: postalCode || null,
            property_type: propertyType,
          }).select("id").single();
          if (error || !data) throw new Error("Property creation failed.");
          propertyId = data.id;
        }
      }

      let estimateDetails: Record<string, unknown> = {};
      if (payload.estimateDetails && typeof payload.estimateDetails === "object") {
        estimateDetails = payload.estimateDetails as Record<string, unknown>;
      } else if (typeof payload.estimateDetails === "string" && payload.estimateDetails.trim()) {
        try { estimateDetails = JSON.parse(payload.estimateDetails) as Record<string, unknown>; } catch { /* preserve original text below */ }
      }

      const roofSystem = clean(propertyRecord.roofSystem) || clean(payload.roofSystem) || clean(estimateDetails.requestedMaterial);
      const rawArea = clean(propertyRecord.approximateRoofArea) || clean(estimateDetails.approximateRoofSize);
      const parsedArea = rawArea ? Number(rawArea.replace(/,/g, "")) : NaN;
      if (propertyId && roofSystem && roofSystem.toLowerCase() !== "unknown") {
        const { data: existingRoof } = await admin.from("crm_roofs").select("id")
          .eq("property_id", propertyId).ilike("covering_material", roofSystem).limit(1).maybeSingle();
        if (!existingRoof) {
          const { error: roofError } = await admin.from("crm_roofs").insert({
            property_id: propertyId,
            covering_material: roofSystem,
            pitch: clean(propertyRecord.pitch) || clean(estimateDetails.pitch) || null,
            approximate_area_sqft: Number.isFinite(parsedArea) && parsedArea > 0 ? parsedArea : null,
          });
          if (roofError) throw new Error("Roof system details could not be imported.");
        }
      }

      const service = clean(payload.serviceRequested) || clean(payload.service_interest) ||
        (clean(payload.leadType) ? clean(payload.leadType) + " request" : "Roofing inquiry");
      const descriptionParts = [clean(payload.message), clean(payload.notes), clean(organizationRecord.notes)].filter(Boolean);
      const detailLines: string[] = [];
      const estimateSummary = Object.entries(estimateDetails)
        .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
        .map(([key, value]) => key.replace(/([A-Z])/g, " $1") + ": " + String(value));
      if (estimateSummary.length) detailLines.push("Estimate details: " + estimateSummary.join("; "));
      for (const [label, key] of [["Storm details", "stormMetadata"], ["Emergency details", "emergencyMetadata"]] as const) {
        const value = payload[key];
        if (value && typeof value === "object") {
          const summary = Object.entries(value as Record<string, unknown>)
            .filter(([, entry]) => entry !== null && entry !== undefined && String(entry).trim() !== "")
            .map(([field, entry]) => field.replace(/([A-Z])/g, " $1") + ": " + String(entry));
          if (summary.length) detailLines.push(label + ": " + summary.join("; "));
        }
      }
      const flags = [
        payload.stormRelatedFlag ? "Storm related" : "",
        payload.insuranceRelatedFlag ? "Insurance related" : "",
        payload.emergencyFlag ? "Emergency request" : "",
      ].filter(Boolean);
      if (flags.length) detailLines.push("Lead flags: " + flags.join(", "));
      if (payload.score !== undefined && payload.score !== null) detailLines.push("Website lead score: " + String(payload.score));
      if (Array.isArray(payload.scoreReasons) && payload.scoreReasons.length) detailLines.push("Website score reasons: " + payload.scoreReasons.map(String).join("; "));
      const description = [...new Set([...descriptionParts, ...detailLines])].join("\n\n") || null;
      const createdAt = record.created_at ? new Date(record.created_at).toISOString() : new Date().toISOString();

      const { error: leadError } = await admin.from("crm_leads").insert({
        division_id: divisionId,
        customer_id: customerId,
        property_id: propertyId,
        contact_id: contactId,
        source: "Website",
        source_record_id: record.id,
        service_interest: service,
        status: normalizedStatus(clean(payload.status)),
        priority: normalizedPriority(clean(payload.priority)),
        description,
        created_by: authData.user.id,
        created_at: createdAt,
      });
      if (leadError) throw new Error("Lead creation failed.");

      imported++;
    } catch (error) {
      failed++;
      failures.push("Import failed for " + record.id + ": " + (error instanceof Error ? error.message : "Unknown error"));
    }
  }

  return json({ success: failed === 0, division_id: divisionId, imported, skipped, failed, failures });
});
