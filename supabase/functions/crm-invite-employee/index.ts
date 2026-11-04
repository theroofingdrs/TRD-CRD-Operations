import { createClient } from "npm:@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const allowedRoles = [
  "division_admin",
  "office_manager",
  "sales_rep",
  "project_manager",
  "field_inspector",
  "production_manager",
  "accounting",
  "read_only",
] as const;

type AllowedRole = (typeof allowedRoles)[number];

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Authentication required." }, 401);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const publishableKey = readKey("SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEYS") ||
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
  const secretKey = readKey("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEYS") ||
    Deno.env.get("SUPABASE_SECRET_KEY") || "";

  if (!url || !publishableKey || !secretKey) {
    return json({ error: "The server is missing required Supabase configuration." }, 500);
  }

  const token = authHeader.slice("Bearer ".length);
  const callerClient = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data: authData, error: authError } = await callerClient.auth.getUser(token);
  if (authError || !authData.user) return json({ error: "Your sign in has expired. Sign in again." }, 401);

  let body: { email?: string; division_id?: string; role?: string; display_name?: string };
  try {
    body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body) || (body.email !== undefined && typeof body.email !== "string") || (body.display_name !== undefined && typeof body.display_name !== "string")) return json({ error: "Invalid employee fields." }, 400);
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const divisionId = body.division_id;
  const role = body.role as AllowedRole;
  const displayName = (body.display_name ?? "").trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return json({ error: "Enter a valid employee email address." }, 400);
  }
  if (divisionId !== "TRD" && divisionId !== "CRD") {
    return json({ error: "Select TRD or CRD." }, 400);
  }
  if (!allowedRoles.includes(role)) {
    return json({ error: "Select a valid employee role. Owner access cannot be assigned through invitations." }, 400);
  }
  if (displayName.length > 120) return json({ error: "Name must be 120 characters or fewer." }, 400);

  // The caller must already be an active owner of the exact division being assigned.
  const { data: ownerMembership, error: membershipCheckError } = await callerClient
    .from("crm_memberships")
    .select("division_id")
    .eq("user_id", authData.user.id)
    .eq("division_id", divisionId)
    .eq("role", "owner")
    .eq("active", true)
    .maybeSingle();

  if (membershipCheckError || !ownerMembership) {
    return json({ error: "Only an active CRM owner for this division can invite or assign employees." }, 403);
  }

  const admin = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let employee: {id:string;email?:string}|undefined;
  // Search all pages. A bounded failure never falls through to a duplicate invite.
  for (let page=1;page<=100;page++) {
    const {data,error}=await admin.auth.admin.listUsers({page,perPage:1000});
    if(error)return json({error:"Unable to check existing employee accounts."},503);
    employee=data.users.find(user=>user.email?.toLowerCase()===email);
    if(employee||data.users.length<1000)break;
    if(page===100)return json({error:"Employee directory search requires administrative review."},503);
  }
  let invited = false;

  if (!employee) {
    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
      email,
      displayName ? { data: { display_name: displayName } } : undefined,
    );
    if (inviteError || !inviteData.user) {
      return json({ error: inviteError?.message ?? "Supabase did not return the invited account." }, 400);
    }
    employee = inviteData.user;
    invited = true;
  }

  const { error: upsertError } = await admin.rpc("crm_assign_employee_access", {
    p_actor: authData.user.id, p_employee: employee.id, p_division: divisionId, p_role: role,
  });

  if (upsertError) {
    return json({
      error: invited
        ? "The invitation was sent, but the CRM role could not be saved. Retry the assignment from Team Access."
        : "The account exists, but the CRM role could not be saved. Existing owner access cannot be changed through invitations.",
    }, 500);
  }

  return json({
    success: true,
    invited,
    existing_account: !invited,
    division_id: divisionId,
    role,
    message: invited
      ? "Invitation sent and division access assigned."
      : "Existing account assigned to this division. They can sign in with their work email.",
  });
});
