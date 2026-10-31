import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import Proposals from "./Proposals";
import Inspections from "./Inspections";
import Warranties from "./Warranties";
import DocumentDeliveries from "./DocumentDeliveries";

type DivisionId = "TRD" | "CRD";
type Role = "owner" | "division_admin" | "office_manager" | "sales_rep" | "project_manager" | "field_inspector" | "production_manager" | "accounting" | "read_only";
type Membership = { division_id: DivisionId; role: Role };
type View = "overview" | "leads" | "customers" | "contacts" | "properties" | "claims" | "roofs" | "documents" | "appointments" | "proposals" | "warranties" | "deliveries" | "inspections" | "projects" | "tasks" | "team";
type Lead = { id: string; service_interest: string | null; status: string; priority: string; source: string | null; description: string | null; created_at: string };
type Customer = { id: string; display_name: string; customer_type: string; email: string | null; phone: string | null; billing_address_line1?: string | null; billing_city?: string | null; billing_state?: string | null; billing_postal_code?: string | null; created_at: string };
type GenericRow = Record<string, string | number | null>;

const navigation: { id: View; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "▦" },
  { id: "leads", label: "Leads", icon: "◎" },
  { id: "customers", label: "Customers", icon: "♙" },
  { id: "contacts", label: "Contacts", icon: "♧" },
  { id: "properties", label: "Properties", icon: "⌂" },
  { id: "claims", label: "Insurance claims", icon: "▤" },
  { id: "roofs", label: "Roof systems", icon: "⌃" },
  { id: "documents", label: "Files and photos", icon: "▧" },
  { id: "appointments", label: "Schedule", icon: "▣" },
  { id: "inspections", label: "Inspections", icon: "⌕" },
  { id: "proposals", label: "Proposals", icon: "▧" },
  { id: "warranties", label: "Warranties", icon: "▤" },
  { id: "deliveries", label: "Delivery history", icon: "✉" },
  { id: "projects", label: "Projects", icon: "▤" },
  { id: "tasks", label: "Tasks", icon: "☷" },
  { id: "team", label: "Team access", icon: "♧" }
];

const divisionNames: Record<DivisionId, string> = {
  TRD: "The ROOF Doctors",
  CRD: "Commercial ROOF Doctors"
};

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [division, setDivision] = useState<DivisionId>("TRD");
  const [view, setView] = useState<View>("overview");
  const [loading, setLoading] = useState(true);
  const [workspaceError, setWorkspaceError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginMode, setLoginMode] = useState<"link" | "password">("link");
  const [authMessage, setAuthMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [profileName, setProfileName] = useState("");

  const loadMemberships = useCallback(async (activeSession: Session | null) => {
    if (!supabase || !activeSession) {
      setMemberships([]);
      setProfileName("");
      setLoading(false);
      return;
    }
    // Do not unmount the active workspace while refreshing membership metadata.
    // The initial app load already starts with loading=true.
    setWorkspaceError("");
    const [membershipResult, profileResult] = await Promise.all([
      supabase.from("crm_memberships").select("division_id,role").eq("user_id", activeSession.user.id).eq("active", true),
      supabase.from("crm_profiles").select("display_name").eq("user_id", activeSession.user.id).maybeSingle()
    ]);
    if (membershipResult.error) {
      setWorkspaceError(membershipResult.error.message);
      setMemberships([]);
    } else {
      const rows = (membershipResult.data ?? []) as Membership[];
      setMemberships(rows);
      setDivision((current) => rows.length && !rows.some((item) => item.division_id === current) ? rows[0].division_id : current);
    }
    setProfileName(profileResult.data?.display_name ?? activeSession.user.email ?? "");
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      void loadMemberships(data.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession);
      // Token refreshes occur when a background tab becomes active. They must not
      // reload the workspace or unmount forms containing unsaved user input.
      if (event === "TOKEN_REFRESHED") return;
      if (event === "SIGNED_OUT" || event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "USER_UPDATED" || event === "PASSWORD_RECOVERY") {
        void loadMemberships(nextSession);
      }
    });
    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, [loadMemberships]);

  const currentMembership = memberships.find((item) => item.division_id === division);
  const isOwner = memberships.some((item) => item.role === "owner");
  const canWriteLeads = currentMembership ? ["owner","division_admin","office_manager","sales_rep"].includes(currentMembership.role) : false;
  const canWriteCustomers = currentMembership ? ["owner","division_admin","office_manager","sales_rep","project_manager"].includes(currentMembership.role) : false;
  const canWriteMaintenance = currentMembership ? ["owner","division_admin","office_manager","project_manager","field_inspector","production_manager"].includes(currentMembership.role) : false;
  const canShareCustomerAcrossDivisions = (["TRD","CRD"] as DivisionId[]).every((id) => { const m = memberships.find((item) => item.division_id === id); return !!m && ["owner","division_admin","office_manager","sales_rep","project_manager"].includes(m.role); });
  const canWriteContacts = canWriteCustomers;
  const canWriteRoofs = currentMembership ? ["owner","division_admin","office_manager","project_manager","production_manager"].includes(currentMembership.role) : false;
  const canWriteClaims = currentMembership ? ["owner","division_admin","office_manager","sales_rep","project_manager","production_manager"].includes(currentMembership.role) : false;
  const canWriteFiles = currentMembership ? ["owner","division_admin","office_manager","sales_rep","project_manager","field_inspector","production_manager"].includes(currentMembership.role) : false;
  const canWriteAppointments = currentMembership ? ["owner","division_admin","office_manager","sales_rep","project_manager","field_inspector"].includes(currentMembership.role) : false;
  const canWriteInspections = currentMembership ? ["owner","division_admin","office_manager","project_manager","field_inspector","production_manager"].includes(currentMembership.role) : false;
  const canWriteProjects = currentMembership ? ["owner","division_admin","office_manager","project_manager"].includes(currentMembership.role) : false;
  const canWriteTasks = currentMembership ? ["owner","division_admin","office_manager","sales_rep","project_manager","production_manager"].includes(currentMembership.role) : false;

  async function sendSignInLink(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setAuthBusy(true);
    setAuthMessage("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: window.location.origin
      }
    });
    setAuthMessage(error ? error.message : "Check your email for your secure sign in link.");
    setAuthBusy(false);
  }

  async function signInWithPassword(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setAuthBusy(true);
    setAuthMessage("");
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    });
    setAuthMessage(error ? error.message : "Signing you in...");
    setAuthBusy(false);
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
  }

  if (!supabase) {
    return <div className="setup-screen"><div className="setup-card"><div className="brand-mark">RD</div><h1>Operations workspace</h1><p>Supabase environment settings are missing. Add the project URL and publishable key to the deployment environment.</p><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_PUBLISHABLE_KEY</code></div></div>;
  }

  if (!session) {
    return <div className="login-screen"><div className="login-card"><div className="brand-mark">RD</div><p className="eyebrow">PRIVATE EMPLOYEE PORTAL</p><h1>Roof Doctors Operations</h1><p className="muted">One secure workspace for residential and commercial roofing operations.</p><form onSubmit={loginMode === "link" ? sendSignInLink : signInWithPassword}><label htmlFor="email">Work email</label><input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" />{loginMode === "password" && <><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" /></>}<button className="primary-button" disabled={authBusy}>{authBusy ? "Signing in..." : loginMode === "link" ? "Email me a sign in link" : "Sign in"}</button></form>{authMessage && <p className="auth-message">{authMessage}</p>}<div className="login-methods"><button type="button" className={loginMode === "password" ? "login-method active" : "login-method"} onClick={() => { setLoginMode("password"); setAuthMessage(""); }}>Password Login</button><button type="button" className={loginMode === "link" ? "login-method active" : "login-method"} onClick={() => { setLoginMode("link"); setAuthMessage(""); }}>Email Sign In Link</button></div><p className="fine-print">Access is invitation only. New accounts cannot self register.</p></div></div>;
  }

  if (loading) return <div className="center-state">Loading your workspace...</div>;
  if (!memberships.length) return <div className="center-state"><div className="setup-card"><h2>Access has not been assigned</h2><p>Your account is signed in, but it does not yet have an active division membership. Ask the CRM owner to assign your role.</p><button className="secondary-button" onClick={signOut}>Sign out</button></div></div>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><div className="brand-mark small">RD</div><div><strong>ROOF DOCTORS</strong><span>OPERATIONS</span></div></div>
      <div className="division-picker"><label htmlFor="division">WORKSPACE</label><select id="division" value={division} onChange={(event) => { setDivision(event.target.value as DivisionId); setView("overview"); }}><option value="TRD" disabled={!memberships.some((item) => item.division_id === "TRD")}>Residential · TRD</option><option value="CRD" disabled={!memberships.some((item) => item.division_id === "CRD")}>Commercial · CRD</option></select></div>
      <nav className="main-nav">{navigation.filter((item) => item.id !== "team" || isOwner).map((item) => <button key={item.id} className={view === item.id ? "nav-item active" : "nav-item"} onClick={() => setView(item.id)}><span className="nav-icon">{item.icon}</span>{item.label}</button>)}</nav>
      <div className="sidebar-bottom"><div className="secure-note"><span className="status-dot"></span> Secure employee access</div><button className="signout-button" onClick={signOut}>Sign out</button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div><p className="eyebrow">{division} DIVISION</p><h1>{view === "overview" ? "Operations overview" : navigation.find((item) => item.id === view)?.label}</h1></div><div className="user-menu"><div className="avatar">{(profileName || "U").slice(0,1).toUpperCase()}</div><div><strong>{profileName || "Employee"}</strong><span>{currentMembership?.role?.replaceAll("_"," ")}</span></div></div></header>
      {workspaceError && <div className="error-banner">{workspaceError}</div>}
      {view === "overview" && <Overview division={division} onNavigate={setView} />}
      {view === "leads" && <Leads division={division} userId={session.user.id} canWrite={canWriteLeads} canImport={currentMembership?.role === "owner"} />}
      {view === "customers" && <Customers division={division} userId={session.user.id} canWrite={canWriteCustomers} canWriteMaintenance={canWriteMaintenance} canShareBoth={canShareCustomerAcrossDivisions} />}
      {view === "contacts" && <Contacts division={division} canWrite={canWriteContacts} />}
      {view === "properties" && <Properties division={division} canWrite={canWriteCustomers} />}
      {view === "claims" && <Claims division={division} userId={session.user.id} canWrite={canWriteClaims} />}
      {view === "roofs" && <Roofs division={division} canWrite={canWriteRoofs} />}
      {view === "documents" && <Documents division={division} userId={session.user.id} canWrite={canWriteFiles} />}
      {view === "appointments" && <DataList division={division} view="appointments" userId={session.user.id} canWrite={canWriteAppointments} />}
      {view === "inspections" && <Inspections division={division} userId={session.user.id} canWrite={canWriteInspections} />}
      {view === "proposals" && <Proposals division={division} userId={session.user.id} canWrite={canWriteLeads} />}
      {view === "warranties" && <Warranties division={division} userId={session.user.id} canWrite={canWriteProjects} />}
      {view === "deliveries" && <DocumentDeliveries division={division} />}
      {view === "projects" && <DataList division={division} view="projects" userId={session.user.id} canWrite={canWriteProjects} />}
      {view === "tasks" && <DataList division={division} view="tasks" userId={session.user.id} canWrite={canWriteTasks} />}
      {view === "team" && isOwner && <Team division={division} />}
    </main>
  </div>;
}

function Overview({ division, onNavigate }: { division: DivisionId; onNavigate: (view: View) => void }) {
  const [counts, setCounts] = useState({ leads: 0, projects: 0, appointments: 0, tasks: 0 });
  const [recent, setRecent] = useState<Lead[]>([]);
  const [busy, setBusy] = useState(true);
  const load = useCallback(async () => {
    if (!supabase) return;
    setBusy(true);
    const [leads, projects, appointments, tasks, recentLeads] = await Promise.all([
      supabase.from("crm_leads").select("id", { count: "exact", head: true }).eq("division_id", division).not("status", "in", "(won,lost)"),
      supabase.from("crm_projects").select("id", { count: "exact", head: true }).eq("division_id", division).not("status", "in", "(completed,cancelled)"),
      supabase.from("crm_appointments").select("id", { count: "exact", head: true }).eq("division_id", division).in("status", ["scheduled","confirmed"]).gte("starts_at", new Date().toISOString()),
      supabase.from("crm_tasks").select("id", { count: "exact", head: true }).eq("division_id", division).not("status", "in", "(completed,cancelled)"),
      supabase.from("crm_leads").select("id,service_interest,status,priority,source,description,created_at").eq("division_id", division).order("created_at", { ascending: false }).limit(5)
    ]);
    setCounts({ leads: leads.count ?? 0, projects: projects.count ?? 0, appointments: appointments.count ?? 0, tasks: tasks.count ?? 0 });
    setRecent((recentLeads.data ?? []) as Lead[]);
    setBusy(false);
  }, [division]);
  useEffect(() => { void load(); }, [load]);
  const cards = [
    { label: "Open leads", value: counts.leads, target: "leads", tone: "orange" },
    { label: "Open projects", value: counts.projects, target: "projects", tone: "dark" },
    { label: "Upcoming appointments", value: counts.appointments, target: "appointments", tone: "blue" },
    { label: "Open tasks", value: counts.tasks, target: "tasks", tone: "green" }
  ] as const;
  return <div className="content-stack">
    <section className="welcome-panel"><div><p className="eyebrow">YOUR WORKSPACE</p><h2>{divisionNames[division]}</h2><p>Manage customers, opportunities, field work, and production in one place.</p></div><div className="welcome-art">RD<span>ROOFING OPERATIONS</span></div></section>
    <section className="stat-grid">{cards.map((card) => <button className="stat-card" key={card.label} onClick={() => onNavigate(card.target)}><span>{card.label}</span><strong className={card.tone}>{busy ? "…" : card.value}</strong><small>View records <span>↗</span></small></button>)}</section>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">PIPELINE</p><h2>Recently added leads</h2></div><button className="text-button" onClick={() => onNavigate("leads")}>View all leads ↗</button></div>{busy ? <div className="empty-state">Loading pipeline...</div> : recent.length ? <div className="table-wrap"><table><thead><tr><th>Opportunity</th><th>Status</th><th>Priority</th><th>Received</th></tr></thead><tbody>{recent.map((lead) => <tr key={lead.id}><td><strong>{lead.service_interest || "New roofing inquiry"}</strong><span className="subline">{lead.description || lead.source || "No additional details"}</span></td><td><span className={"pill " + lead.status}>{lead.status.replaceAll("_"," ")}</span></td><td><span className={"priority " + lead.priority}>{lead.priority}</span></td><td>{new Date(lead.created_at).toLocaleDateString()}</td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>No leads yet</strong><span>New opportunities will appear here when they are entered or connected from website intake.</span><button className="secondary-button" onClick={() => onNavigate("leads")}>Open leads</button></div>}</section>
  </div>;
}

function Leads({ division, userId, canWrite, canImport }: { division: DivisionId; userId: string; canWrite: boolean; canImport: boolean }) {
  const [rows, setRows] = useState<Lead[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [service, setService] = useState("");
  const [source, setSource] = useState("Phone");
  const [priority, setPriority] = useState("normal");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase.from("crm_leads").select("id,service_interest,status,priority,source,description,created_at").eq("division_id", division).order("created_at", { ascending: false });
    if (error) setMessage(error.message);
    setRows((data ?? []) as Lead[]);
    setLoading(false);
  }, [division]);
  useEffect(() => { void load(); }, [load]);
  async function updateStatus(id: string, status: string) {
    if (!supabase) return;
    const { error } = await supabase.from("crm_leads").update({ status }).eq("id", id);
    if (error) setMessage(error.message);
    else await load();
  }
  async function importWebsiteLeads() {
    if (!supabase || !canImport) return;
    const confirmed = window.confirm("Import website inquiries into this division's CRM? Existing website submissions will remain unchanged. Previously imported records will be skipped.");
    if (!confirmed) return;
    setImporting(true);
    setMessage("");
    const { data, error } = await supabase.functions.invoke("crm-import-website-intake", { body: { division_id: division } });
    if (error) setMessage(error.message);
    else if (data?.error) setMessage(data.error);
    else {
      setMessage("Website intake import finished. Imported: " + data.imported + ". Already imported: " + data.skipped + ". Failed: " + data.failed + ".");
      await load();
    }
    setImporting(false);
  }
  async function createLead(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setMessage("");
    const { error } = await supabase.from("crm_leads").insert({ division_id: division, service_interest: service.trim() || null, source, priority, description: description.trim() || null, created_by: userId });
    if (error) setMessage(error.message);
    else {
      setShowForm(false);
      setService("");
      setDescription("");
      setMessage("Lead created.");
      await load();
    }
    setSaving(false);
  }
  return <div className="content-stack"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">OPPORTUNITY MANAGEMENT</p><h2>Lead pipeline</h2><p className="muted">{rows.length} records in this division</p></div><div className="panel-actions">{canImport && <button className="secondary-button" disabled={importing} onClick={() => void importWebsiteLeads()}>{importing ? "Importing..." : "Import website leads"}</button>}{canWrite && <button className="primary-button compact" onClick={() => setShowForm(!showForm)}>{showForm ? "Close form" : "+ Add lead"}</button>}</div></div>
    {showForm && <form className="inline-form" onSubmit={createLead}><div className="form-grid"><label>Service requested<input value={service} onChange={(event) => setService(event.target.value)} placeholder="Roof replacement, repair, gutter cleaning..." /></label><label>Lead source<select value={source} onChange={(event) => setSource(event.target.value)}><option>Phone</option><option>Website</option><option>Referral</option><option>Google</option><option>Repeat customer</option><option>Other</option></select></label><label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label className="wide">Notes<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} placeholder="What does the customer need?" /></label></div><button className="primary-button" disabled={saving}>{saving ? "Saving..." : "Save lead"}</button></form>}
    {message && <p className="inline-message">{message}</p>}
    {loading ? <div className="empty-state">Loading leads...</div> : rows.length ? <div className="table-wrap"><table><thead><tr><th>Service</th><th>Source</th><th>Status</th><th>Priority</th><th>Created</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.service_interest || "Unspecified service"}</strong><span className="subline">{row.description || "No notes"}</span></td><td>{row.source || "—"}</td><td>{canWrite ? <select className="table-select" value={row.status} onChange={(event) => void updateStatus(row.id, event.target.value)}><option value="new">New</option><option value="contacted">Contacted</option><option value="qualified">Qualified</option><option value="appointment_set">Appointment set</option><option value="inspection_pending">Inspection pending</option><option value="estimate_in_progress">Estimate in progress</option><option value="proposal_sent">Proposal sent</option><option value="won">Won</option><option value="lost">Lost</option><option value="on_hold">On hold</option></select> : <span className={"pill " + row.status}>{row.status.replaceAll("_"," ")}</span>}</td><td><span className={"priority " + row.priority}>{row.priority}</span></td><td>{new Date(row.created_at).toLocaleDateString()}</td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>Your lead pipeline is ready</strong><span>There are no CRM leads in this division yet. Existing public website submissions have not been copied or changed.</span>{canWrite && <button className="secondary-button" onClick={() => setShowForm(true)}>Add your first lead</button>}</div>}
  </section></div>;
}

function Customers({ division, userId, canWrite, canWriteMaintenance, canShareBoth }: { division: DivisionId; userId: string; canWrite: boolean; canWriteMaintenance: boolean; canShareBoth: boolean }) {
  const [rows, setRows] = useState<Customer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("individual");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [billingCity, setBillingCity] = useState("");
  const [billingState, setBillingState] = useState("TX");
  const [billingPostal, setBillingPostal] = useState("");
  const emptyProperty = () => ({ property_name: "", address_line1: "", address_line2: "", city: "", state: "TX", postal_code: "", county: "", property_type: "residential", year_built: "", square_footage: "", parcel_number: "", building_name: "", occupancy_type: "", property_notes: "" });
  const [newProperties, setNewProperties] = useState([emptyProperty()]);
  const [showAddProperty, setShowAddProperty] = useState(false);
  const [propertyDraft, setPropertyDraft] = useState(emptyProperty());
  const [shareWithBoth, setShareWithBoth] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [properties, setProperties] = useState<GenericRow[]>([]);
  const [contacts, setContacts] = useState<GenericRow[]>([]);
  const [projects, setProjects] = useState<GenericRow[]>([]);
  const [claims, setClaims] = useState<GenericRow[]>([]);
  const [roofs, setRoofs] = useState<GenericRow[]>([]);
  const [leads, setLeads] = useState<GenericRow[]>([]);
  const [appointments, setAppointments] = useState<GenericRow[]>([]);
  const [inspections, setInspections] = useState<GenericRow[]>([]);
  const [files, setFiles] = useState<GenericRow[]>([]);
  const [maintenanceRecords, setMaintenanceRecords] = useState<GenericRow[]>([]);  const [showMaintenanceForm, setShowMaintenanceForm] = useState(false);
  const [serviceType, setServiceType] = useState("preventive_maintenance");
  const [serviceStatus, setServiceStatus] = useState("scheduled");
  const [servicePriority, setServicePriority] = useState("normal");
  const [servicePropertyId, setServicePropertyId] = useState("");
  const [serviceRoofId, setServiceRoofId] = useState("");
  const [serviceProjectId, setServiceProjectId] = useState("");
  const [serviceScheduledFor, setServiceScheduledFor] = useState("");
  const [serviceCompletedAt, setServiceCompletedAt] = useState("");
  const [nextServiceDue, setNextServiceDue] = useState("");
  const [serviceDescription, setServiceDescription] = useState("");
  const [serviceFindings, setServiceFindings] = useState("");
  const [serviceWork, setServiceWork] = useState("");
  const [serviceRecommendations, setServiceRecommendations] = useState("");
  const [serviceMaterials, setServiceMaterials] = useState("");
  const [serviceCost, setServiceCost] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data: links, error: linkError } = await supabase.from("crm_customer_divisions").select("customer_id").eq("division_id", division);
    if (linkError) setMessage(linkError.message);
    const ids = (links ?? []).map((item: { customer_id: string }) => item.customer_id);
    if (!ids.length) setRows([]);
    else {
      const { data, error } = await supabase.from("crm_customers")
        .select("id,display_name,customer_type,email,phone,billing_address_line1,billing_city,billing_state,billing_postal_code,created_at")
        .in("id", ids).order("created_at", { ascending: false });
      if (error) setMessage(error.message);
      setRows((data ?? []) as Customer[]);
    }
    setLoading(false);
  }, [division]);

  useEffect(() => { void load(); }, [load]);

  async function loadCustomerDetails(customerId: string) {
    if (!supabase) return;
    setSelectedId(customerId);
    setDetailLoading(true);
    setMessage("");
    const [propertyResult, contactResult, projectResult, claimResult, leadResult, appointmentResult, inspectionResult, maintenanceResult] = await Promise.all([
      supabase.from("crm_properties").select("id,address_line1,city,state,postal_code,property_type,county,parcel_number,building_name").eq("customer_id", customerId).order("created_at", { ascending: false }),
      supabase.from("crm_contacts").select("id,full_name,title,email,phone,is_primary").eq("customer_id", customerId).order("is_primary", { ascending: false }),
      supabase.from("crm_projects").select("id,project_name,project_type,status,contract_amount,property_id").eq("customer_id", customerId).order("created_at", { ascending: false }),
      supabase.from("crm_claims").select("id,claim_number,policy_number,insurance_carrier,date_of_loss,claim_status,adjuster_name,adjuster_email,adjuster_phone,deductible,approved_amount,replacement_cost_value,actual_cash_value,supplement_amount,property_id").eq("customer_id", customerId).order("created_at", { ascending: false }),
      supabase.from("crm_leads").select("id,service_interest,status,priority,created_at,property_id").eq("customer_id", customerId).order("created_at", { ascending: false }),
      supabase.from("crm_appointments").select("id,appointment_type,status,starts_at,location_notes,property_id").eq("customer_id", customerId).order("starts_at", { ascending: false }),
      supabase.from("crm_inspections").select("id,status,inspected_at,overall_condition,summary,property_id").eq("customer_id", customerId).order("inspected_at", { ascending: false }),
      supabase.from("crm_maintenance_records").select("id,property_id,roof_id,project_id,service_type,status,priority,scheduled_for,completed_at,description,findings,work_performed,recommendations,materials_used,service_cost,next_service_due,warranty_until,created_at").eq("customer_id", customerId).eq("division_id", division).order("created_at", { ascending: false })
    ]);
    if (propertyResult.error) setMessage(propertyResult.error.message);
    if (contactResult.error) setMessage(contactResult.error.message);
    if (projectResult.error) setMessage(projectResult.error.message);
    if (claimResult.error) setMessage(claimResult.error.message);
    if (leadResult.error) setMessage(leadResult.error.message);
    if (appointmentResult.error) setMessage(appointmentResult.error.message);
    if (inspectionResult.error) setMessage(inspectionResult.error.message);
    if (maintenanceResult.error) setMessage(maintenanceResult.error.message);
    const propertyRows = (propertyResult.data ?? []) as GenericRow[];
    setProperties(propertyRows);
    setContacts((contactResult.data ?? []) as GenericRow[]);
    setProjects((projectResult.data ?? []) as GenericRow[]);
    setClaims((claimResult.data ?? []) as GenericRow[]);
    setLeads((leadResult.data ?? []) as GenericRow[]);
    setAppointments((appointmentResult.data ?? []) as GenericRow[]);
    setInspections((inspectionResult.data ?? []) as GenericRow[]);
    setMaintenanceRecords((maintenanceResult.data ?? []) as GenericRow[]);
    const propertyIds = propertyRows.map((p) => String(p.id));
    if (propertyIds.length) {
      const { data, error } = await supabase.from("crm_roofs")
        .select("id,property_id,roof_section,roof_type,covering_material,installation_year,approximate_area_sqft,condition_summary,warranty_notes")
        .in("property_id", propertyIds).order("created_at", { ascending: false });
      if (error) setMessage(error.message);
      setRoofs((data ?? []) as GenericRow[]);
    } else setRoofs([]);
    if (propertyIds.length) {
      const { data, error } = await supabase.from("crm_files").select("id,related_id,related_type,original_filename,content_type,created_at").eq("division_id", division).in("related_id", propertyIds).order("created_at", { ascending: false });
      if (error) setMessage(error.message);
      setFiles((data ?? []) as GenericRow[]);
    } else setFiles([]);
    setDetailLoading(false);
  }

  async function createMaintenanceRecord(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !selected || !servicePropertyId) return;
    setSaving(true);
    setMessage("");
    const { error } = await supabase.from("crm_maintenance_records").insert({
      division_id: division,
      customer_id: selected.id,
      property_id: servicePropertyId,
      roof_id: serviceRoofId || null,
      project_id: serviceProjectId || null,
      service_type: serviceType,
      status: serviceStatus,
      priority: servicePriority,
      scheduled_for: serviceScheduledFor ? new Date(serviceScheduledFor).toISOString() : null,
      completed_at: serviceCompletedAt ? new Date(serviceCompletedAt).toISOString() : null,
      next_service_due: nextServiceDue || null,
      description: serviceDescription.trim() || null,
      findings: serviceFindings.trim() || null,
      work_performed: serviceWork.trim() || null,
      recommendations: serviceRecommendations.trim() || null,
      materials_used: serviceMaterials.trim() || null,
      service_cost: serviceCost ? Number(serviceCost) : null,
      created_by: userId
    });
    if (error) setMessage(error.message);
    else {
      setServiceType("preventive_maintenance"); setServiceStatus("scheduled"); setServicePriority("normal");
      setServicePropertyId(""); setServiceRoofId(""); setServiceProjectId("");
      setServiceScheduledFor(""); setServiceCompletedAt(""); setNextServiceDue("");
      setServiceDescription(""); setServiceFindings(""); setServiceWork("");
      setServiceRecommendations(""); setServiceMaterials(""); setServiceCost("");
      setShowMaintenanceForm(false); setMessage("Maintenance service record saved.");
      await loadCustomerDetails(selected.id);
    }
    setSaving(false);
  }

  function beginEditCustomer() {
    if (!selected) return;
    setEditingId(selected.id);
    setName(selected.display_name);
    setType(selected.customer_type);
    setEmail(selected.email || "");
    setPhone(selected.phone || "");
    setBillingAddress(selected.billing_address_line1 || "");
    setBillingCity(selected.billing_city || "");
    setBillingState(selected.billing_state || "TX");
    setBillingPostal(selected.billing_postal_code || "");
    setShowForm(true);
  }

  function updateNewProperty(index: number, patch: Partial<ReturnType<typeof emptyProperty>>) {
    setNewProperties(current => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  function propertyInsertValues(customerId: string, items: typeof newProperties) {
    return items.filter(item => item.address_line1.trim() && item.city.trim()).map(item => ({
      customer_id: customerId,
      property_name: item.property_name.trim() || null,
      address_line1: item.address_line1.trim(),
      address_line2: item.address_line2.trim() || null,
      city: item.city.trim(),
      state: item.state.trim().toUpperCase() || "TX",
      postal_code: item.postal_code.trim() || null,
      county: item.county.trim() || null,
      property_type: item.property_type || null,
      year_built: item.year_built ? Number(item.year_built) : null,
      square_footage: item.square_footage ? Number(item.square_footage) : null,
      parcel_number: item.parcel_number.trim() || null,
      building_name: item.building_name.trim() || null,
      occupancy_type: item.occupancy_type.trim() || null,
      property_notes: item.property_notes.trim() || null
    }));
  }

  async function addPropertyToSelected(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !selected || !propertyDraft.address_line1.trim() || !propertyDraft.city.trim()) return;
    setSaving(true); setMessage("");
    const values = propertyInsertValues(selected.id, [propertyDraft]);
    const { error } = await supabase.from("crm_properties").insert(values);
    if (error) setMessage("Property could not be saved: " + error.message);
    else {
      setPropertyDraft(emptyProperty()); setShowAddProperty(false);
      setMessage("Property added to customer.");
      await loadCustomerDetails(selected.id);
    }
    setSaving(false);
  }

  async function createCustomer(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setMessage("");
    const customerValues = {
      display_name: name.trim(), customer_type: type, email: email.trim() || null,
      phone: phone.trim() || null, billing_address_line1: billingAddress.trim() || null,
      billing_city: billingCity.trim() || null, billing_state: billingState.trim().toUpperCase() || null,
      billing_postal_code: billingPostal.trim() || null
    };
    if (editingId) {
      const { error } = await supabase.from("crm_customers").update(customerValues).eq("id", editingId);
      if (error) setMessage(error.message);
      else {
        const id = editingId;
        setEditingId(""); setShowForm(false); setMessage("Customer record updated.");
        await load();
        await loadCustomerDetails(id);
      }
    } else {
      const { data, error } = await supabase.from("crm_customers").insert({ ...customerValues, created_by: userId }).select("id").single();
      if (error) setMessage(error.message);
      else {
        const divisionLinks = shareWithBoth ? [{ customer_id: data.id, division_id: "TRD" }, { customer_id: data.id, division_id: "CRD" }] : [{ customer_id: data.id, division_id: division }];
        const { error: linkError } = await supabase.from("crm_customer_divisions").insert(divisionLinks);
        if (linkError) setMessage("Customer was created, but division linking failed: " + linkError.message);
        else {
          const propertyValues = propertyInsertValues(data.id, newProperties);
          let propertyErrorMessage = "";
          if (propertyValues.length) {
            const { error: propertyError } = await supabase.from("crm_properties").insert(propertyValues);
            if (propertyError) propertyErrorMessage = propertyError.message;
          }
          setName(""); setEmail(""); setPhone(""); setBillingAddress(""); setBillingCity(""); setBillingPostal("");
          setNewProperties([emptyProperty()]); setShareWithBoth(false); setShowForm(false);
          setMessage(propertyErrorMessage ? "Customer created, but property saving failed: " + propertyErrorMessage : "Customer and property records created.");
        }
        await load();
        if (!linkError) await loadCustomerDetails(data.id);
      }
    }
    setSaving(false);
  }

  const selected = rows.find((row) => row.id === selectedId);
  const propertyAddress = (id: unknown) => {
    const p = properties.find((item) => item.id === id);
    return p ? [p.address_line1, p.city, p.state].filter(Boolean).join(", ") : "Property not selected";
  };

  return <div className="content-stack">
    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">CUSTOMER DIRECTORY</p><h2>Customer and organization records</h2><p className="muted">One customer record connects every property, roof system, claim, project, contact, and document.</p></div>{canWrite && <button className="primary-button compact" onClick={() => setShowForm(!showForm)}>{showForm ? "Close form" : "+ Add customer"}</button>}</div>
      {showForm && <form className="inline-form" onSubmit={createCustomer}><div className="form-grid">
        <label>Customer or organization name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Name or business" /></label>
        <label>Customer type<select value={type} onChange={(event) => setType(event.target.value)}><option value="individual">Homeowner / Individual</option><option value="business">Business</option><option value="property_manager">Property manager</option><option value="organization">Organization</option></select></label>
        <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
        <label className="wide">Billing or mailing street address<input value={billingAddress} onChange={(event) => setBillingAddress(event.target.value)} /></label>
        <label>City<input value={billingCity} onChange={(event) => setBillingCity(event.target.value)} /></label>
        <label>State<input value={billingState} onChange={(event) => setBillingState(event.target.value)} maxLength={2} /></label>
        <label>ZIP code<input value={billingPostal} onChange={(event) => setBillingPostal(event.target.value)} /></label>
        <div className="wide"><h3>Property details</h3><p className="muted">Add the first service property now. You can attach more properties to this customer.</p>
          {newProperties.map((property, index) => <div className="form-grid" key={index}>
            <label>Property name<input value={property.property_name} onChange={e => updateNewProperty(index,{property_name:e.target.value})} placeholder="Primary residence, Building A..." /></label>
            <label>Property type<select value={property.property_type} onChange={e => updateNewProperty(index,{property_type:e.target.value})}><option value="residential">Residential</option><option value="commercial">Commercial</option><option value="multifamily">Multifamily</option><option value="industrial">Industrial</option><option value="institutional">Institutional</option><option value="other">Other</option></select></label>
            <label className="wide">Street address<input value={property.address_line1} onChange={e => updateNewProperty(index,{address_line1:e.target.value})} /></label>
            <label>Address line 2<input value={property.address_line2} onChange={e => updateNewProperty(index,{address_line2:e.target.value})} /></label>
            <label>City<input value={property.city} onChange={e => updateNewProperty(index,{city:e.target.value})} /></label>
            <label>State<input maxLength={2} value={property.state} onChange={e => updateNewProperty(index,{state:e.target.value})} /></label>
            <label>ZIP code<input value={property.postal_code} onChange={e => updateNewProperty(index,{postal_code:e.target.value})} /></label>
            <label>County<input value={property.county} onChange={e => updateNewProperty(index,{county:e.target.value})} /></label>
            <label>Year built<input type="number" min="1800" max="2100" value={property.year_built} onChange={e => updateNewProperty(index,{year_built:e.target.value})} /></label>
            <label>Square footage<input type="number" min="0" step="1" value={property.square_footage} onChange={e => updateNewProperty(index,{square_footage:e.target.value})} /></label>
            <label>Parcel number<input value={property.parcel_number} onChange={e => updateNewProperty(index,{parcel_number:e.target.value})} /></label>
            <label>Building name<input value={property.building_name} onChange={e => updateNewProperty(index,{building_name:e.target.value})} /></label>
            <label>Occupancy type<input value={property.occupancy_type} onChange={e => updateNewProperty(index,{occupancy_type:e.target.value})} /></label>
            <label className="wide">Property notes<textarea rows={2} value={property.property_notes} onChange={e => updateNewProperty(index,{property_notes:e.target.value})} /></label>
            {newProperties.length > 1 && <button type="button" className="text-button" onClick={() => setNewProperties(current => current.filter((_,i)=>i!==index))}>Remove this property</button>}
          </div>)}
          <button type="button" className="secondary-button" onClick={() => setNewProperties(current => [...current,emptyProperty()])}>+ Add another property</button>
        </div>
        {canShareBoth && <label className="check-field"><span><input type="checkbox" checked={shareWithBoth} onChange={(event) => setShareWithBoth(event.target.checked)} /> Share this customer across both TRD and CRD</span></label>}
      </div><div className="button-row"><button className="primary-button" disabled={saving}>{saving ? "Saving..." : editingId ? "Save customer changes" : "Save customer"}</button>{editingId && <button type="button" className="secondary-button" onClick={() => { setEditingId(""); setShowForm(false); }}>Cancel</button>}</div></form>}
      {message && <p className="inline-message">{message}</p>}
      {loading ? <div className="empty-state">Loading customers...</div> : rows.length ? <div className="table-wrap"><table><thead><tr><th>Customer / organization</th><th>Type</th><th>Email</th><th>Phone</th><th>Billing address</th><th>Added</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><button className="text-button" onClick={() => void loadCustomerDetails(row.id)}><strong>{row.display_name}</strong></button></td><td>{row.customer_type.replaceAll("_"," ")}</td><td>{row.email || "—"}</td><td>{row.phone || "—"}</td><td>{[row.billing_address_line1,row.billing_city,row.billing_state,row.billing_postal_code].filter(Boolean).join(", ") || "—"}</td><td>{new Date(row.created_at).toLocaleDateString()}</td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>No customer records yet</strong><span>Add a customer to start building the shared customer and property history.</span>{canWrite && <button className="secondary-button" onClick={() => setShowForm(true)}>Add first customer</button>}</div>}
    </section>
    {selected && <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">CENTRAL CUSTOMER RECORD</p><h2>{selected.display_name}</h2><p className="muted">{selected.customer_type.replaceAll("_"," ")} · {selected.email || "No email"} · {selected.phone || "No phone"}</p></div><div className="button-row">{canWrite && <button className="secondary-button compact" onClick={beginEditCustomer}>Edit customer</button>}<button className="secondary-button compact" onClick={() => setSelectedId("")}>Close details</button></div></div>
      {detailLoading ? <div className="empty-state">Loading linked customer history...</div> : <div className="content-stack">
        <div className="form-grid"><div><strong>Billing / mailing address</strong><p>{[selected.billing_address_line1,selected.billing_city,selected.billing_state,selected.billing_postal_code].filter(Boolean).join(", ") || "Not entered"}</p></div><div><strong>Linked records</strong><p>{properties.length} properties · {contacts.length} contacts · {leads.length} leads · {projects.length} projects · {claims.length} claims · {roofs.length} roof systems · {appointments.length} appointments · {inspections.length} inspections · {maintenanceRecords.length} service records · {files.length} files</p></div></div>
        <div><div className="panel-heading"><div><h3>Properties</h3><p className="muted">All service locations associated with this customer.</p></div>{canWrite && <button type="button" className="secondary-button compact" onClick={() => setShowAddProperty(!showAddProperty)}>{showAddProperty ? "Close form" : "+ Add property"}</button>}</div>
          {showAddProperty && <form className="inline-form" onSubmit={addPropertyToSelected}><div className="form-grid">
            <label>Property name<input value={propertyDraft.property_name} onChange={e=>setPropertyDraft(current=>({...current,property_name:e.target.value}))} placeholder="Primary residence, Building A..." /></label>
            <label>Property type<select value={propertyDraft.property_type} onChange={e=>setPropertyDraft(current=>({...current,property_type:e.target.value}))}><option value="residential">Residential</option><option value="commercial">Commercial</option><option value="multifamily">Multifamily</option><option value="industrial">Industrial</option><option value="institutional">Institutional</option><option value="other">Other</option></select></label>
            <label className="wide">Street address<input required value={propertyDraft.address_line1} onChange={e=>setPropertyDraft(current=>({...current,address_line1:e.target.value}))} /></label>
            <label>Address line 2<input value={propertyDraft.address_line2} onChange={e=>setPropertyDraft(current=>({...current,address_line2:e.target.value}))} /></label>
            <label>City<input required value={propertyDraft.city} onChange={e=>setPropertyDraft(current=>({...current,city:e.target.value}))} /></label>
            <label>State<input required maxLength={2} value={propertyDraft.state} onChange={e=>setPropertyDraft(current=>({...current,state:e.target.value}))} /></label>
            <label>ZIP code<input value={propertyDraft.postal_code} onChange={e=>setPropertyDraft(current=>({...current,postal_code:e.target.value}))} /></label>
            <label>County<input value={propertyDraft.county} onChange={e=>setPropertyDraft(current=>({...current,county:e.target.value}))} /></label>
            <label>Year built<input type="number" min="1800" max="2100" value={propertyDraft.year_built} onChange={e=>setPropertyDraft(current=>({...current,year_built:e.target.value}))} /></label>
            <label>Square footage<input type="number" min="0" step="1" value={propertyDraft.square_footage} onChange={e=>setPropertyDraft(current=>({...current,square_footage:e.target.value}))} /></label>
            <label>Parcel number<input value={propertyDraft.parcel_number} onChange={e=>setPropertyDraft(current=>({...current,parcel_number:e.target.value}))} /></label>
            <label>Building name<input value={propertyDraft.building_name} onChange={e=>setPropertyDraft(current=>({...current,building_name:e.target.value}))} /></label>
            <label>Occupancy type<input value={propertyDraft.occupancy_type} onChange={e=>setPropertyDraft(current=>({...current,occupancy_type:e.target.value}))} /></label>
            <label className="wide">Property notes<textarea rows={2} value={propertyDraft.property_notes} onChange={e=>setPropertyDraft(current=>({...current,property_notes:e.target.value}))} /></label>
          </div><button className="primary-button" disabled={saving}>{saving ? "Saving..." : "Save property"}</button></form>}
          {properties.length ? <div className="table-wrap"><table><thead><tr><th>Property</th><th>Type</th><th>County</th><th>Parcel / building</th></tr></thead><tbody>{properties.map((p) => <tr key={String(p.id)}><td><strong>{[p.address_line1,p.city,p.state,p.postal_code].filter(Boolean).join(", ")}</strong></td><td>{String(p.property_type || "—")}</td><td>{String(p.county || "—")}</td><td>{[p.parcel_number,p.building_name].filter(Boolean).join(" · ") || "—"}</td></tr>)}</tbody></table></div> : <p className="muted">No properties linked yet.</p>}</div>
        <div><h3>Roof systems</h3>{roofs.length ? <div className="table-wrap"><table><thead><tr><th>Property</th><th>Roof section</th><th>System / material</th><th>Installed</th><th>Condition</th></tr></thead><tbody>{roofs.map((roof) => <tr key={String(roof.id)}><td>{propertyAddress(roof.property_id)}</td><td>{String(roof.roof_section || "—")}</td><td>{[roof.roof_type,roof.covering_material].filter(Boolean).join(" · ") || "—"}</td><td>{String(roof.installation_year || "—")}</td><td>{String(roof.condition_summary || "—")}</td></tr>)}</tbody></table></div> : <p className="muted">No roof systems linked yet.</p>}</div>
        <div>
          <div className="panel-heading"><div><h3>Maintenance and service history</h3><p className="muted">Permanent service visits linked to this customer, property, roof, and project.</p></div>{canWriteMaintenance && properties.length > 0 && <button className="secondary-button compact" onClick={() => setShowMaintenanceForm(!showMaintenanceForm)}>{showMaintenanceForm ? "Close form" : "+ Add service record"}</button>}</div>
          {showMaintenanceForm && <form className="inline-form" onSubmit={createMaintenanceRecord}>
            <div className="form-grid">
              <label>Property<select required value={servicePropertyId} onChange={event => { setServicePropertyId(event.target.value); setServiceRoofId(""); setServiceProjectId(""); }}><option value="">Select property</option>{properties.map(property => <option key={String(property.id)} value={String(property.id)}>{propertyAddress(property.id)}</option>)}</select></label>
              <label>Roof system (optional)<select value={serviceRoofId} onChange={event => setServiceRoofId(event.target.value)}><option value="">Not specified</option>{roofs.filter(roof => String(roof.property_id) === servicePropertyId).map(roof => <option key={String(roof.id)} value={String(roof.id)}>{[roof.roof_section,roof.roof_type,roof.covering_material].filter(Boolean).join(" · ") || "Roof system"}</option>)}</select></label>
              <label>Related project (optional)<select value={serviceProjectId} onChange={event => setServiceProjectId(event.target.value)}><option value="">No project linked</option>{projects.filter(project => String(project.property_id) === servicePropertyId).map(project => <option key={String(project.id)} value={String(project.id)}>{String(project.project_name)}</option>)}</select></label>
              <label>Service type<select value={serviceType} onChange={event => setServiceType(event.target.value)}><option value="preventive_maintenance">Preventive maintenance</option><option value="roof_inspection">Roof inspection</option><option value="leak_repair">Leak repair</option><option value="storm_damage">Storm damage service</option><option value="gutter_cleaning">Gutter cleaning</option><option value="roof_cleaning">Roof cleaning</option><option value="warranty_service">Warranty service</option><option value="emergency_service">Emergency service</option><option value="other">Other</option></select></label>
              <label>Status<select value={serviceStatus} onChange={event => setServiceStatus(event.target.value)}><option value="scheduled">Scheduled</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="deferred">Deferred</option><option value="cancelled">Cancelled</option></select></label>
              <label>Priority<select value={servicePriority} onChange={event => setServicePriority(event.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
              <label>Scheduled date and time<input type="datetime-local" value={serviceScheduledFor} onChange={event => setServiceScheduledFor(event.target.value)} /></label>
              <label>Completed date and time<input type="datetime-local" value={serviceCompletedAt} onChange={event => setServiceCompletedAt(event.target.value)} /></label>
              <label>Next service due<input type="date" value={nextServiceDue} onChange={event => setNextServiceDue(event.target.value)} /></label>
              <label>Service cost ($)<input type="number" min="0" step="0.01" value={serviceCost} onChange={event => setServiceCost(event.target.value)} /></label>
              <label className="wide">Service request / description<textarea rows={2} value={serviceDescription} onChange={event => setServiceDescription(event.target.value)} /></label>
              <label className="wide">Inspection findings<textarea rows={2} value={serviceFindings} onChange={event => setServiceFindings(event.target.value)} /></label>
              <label className="wide">Work performed<textarea rows={2} value={serviceWork} onChange={event => setServiceWork(event.target.value)} /></label>
              <label className="wide">Recommendations<textarea rows={2} value={serviceRecommendations} onChange={event => setServiceRecommendations(event.target.value)} /></label>
              <label className="wide">Materials used<textarea rows={2} value={serviceMaterials} onChange={event => setServiceMaterials(event.target.value)} /></label>
            </div>
            <div className="button-row"><button className="primary-button" disabled={saving || !servicePropertyId}>{saving ? "Saving..." : "Save service record"}</button><button type="button" className="secondary-button" onClick={() => setShowMaintenanceForm(false)}>Cancel</button></div>
          </form>}
          {maintenanceRecords.length ? <div className="table-wrap"><table><thead><tr><th>Service</th><th>Property / roof</th><th>Scheduled</th><th>Status</th><th>Priority</th><th>Cost</th><th>Next due</th><th>Work and findings</th></tr></thead><tbody>{maintenanceRecords.map(record => <tr key={String(record.id)}><td>{String(record.service_type || "Service").replaceAll("_"," ")}</td><td>{propertyAddress(record.property_id)}</td><td>{record.scheduled_for ? new Date(String(record.scheduled_for)).toLocaleString() : record.completed_at ? new Date(String(record.completed_at)).toLocaleDateString() : "—"}</td><td>{String(record.status || "—").replaceAll("_"," ")}</td><td>{String(record.priority || "—")}</td><td>{record.service_cost == null ? "—" : "$"+Number(record.service_cost).toLocaleString()}</td><td>{String(record.next_service_due || "—")}</td><td>{[record.work_performed,record.findings,record.recommendations].filter(Boolean).join(" | ") || String(record.description || "—")}</td></tr>)}</tbody></table></div> : <p className="muted">No maintenance or service visits recorded yet.</p>}
        </div>
        <div><h3>Insurance claims</h3>{claims.length ? <div className="table-wrap"><table><thead><tr><th>Claim number</th><th>Policy</th><th>Property</th><th>Carrier</th><th>Date of loss</th><th>Status</th><th>Adjuster</th><th>Deductible</th><th>Approved</th></tr></thead><tbody>{claims.map((claim) => <tr key={String(claim.id)}><td>{String(claim.claim_number || "Not entered")}</td><td>{String(claim.policy_number || "—")}</td><td>{propertyAddress(claim.property_id)}</td><td>{String(claim.insurance_carrier || "—")}</td><td>{String(claim.date_of_loss || "—")}</td><td>{String(claim.claim_status || "—")}</td><td>{String(claim.adjuster_name || "—")}</td><td>{claim.deductible == null ? "—" : "$"+Number(claim.deductible).toLocaleString()}</td><td>{claim.approved_amount == null ? "—" : "$"+Number(claim.approved_amount).toLocaleString()}</td></tr>)}</tbody></table></div> : <p className="muted">No insurance claims linked yet.</p>}</div>
        <div><h3>Projects</h3>{projects.length ? <div className="table-wrap"><table><thead><tr><th>Project</th><th>Property</th><th>Type</th><th>Status</th><th>Contract</th></tr></thead><tbody>{projects.map((project) => <tr key={String(project.id)}><td>{String(project.project_name)}</td><td>{propertyAddress(project.property_id)}</td><td>{String(project.project_type || "—")}</td><td>{String(project.status || "—")}</td><td>{project.contract_amount == null ? "—" : "$"+Number(project.contract_amount).toLocaleString()}</td></tr>)}</tbody></table></div> : <p className="muted">No projects linked yet.</p>}</div>
        <div><h3>Contacts</h3>{contacts.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Phone</th><th>Primary</th></tr></thead><tbody>{contacts.map((contact) => <tr key={String(contact.id)}><td>{String(contact.full_name)}</td><td>{String(contact.title || "—")}</td><td>{String(contact.email || "—")}</td><td>{String(contact.phone || "—")}</td><td>{contact.is_primary ? "Yes" : "No"}</td></tr>)}</tbody></table></div> : <p className="muted">No contacts linked yet.</p>}</div>
        <div><h3>Leads and opportunities</h3>{leads.length ? <div className="table-wrap"><table><thead><tr><th>Service</th><th>Property</th><th>Status</th><th>Priority</th><th>Created</th></tr></thead><tbody>{leads.map((lead) => <tr key={String(lead.id)}><td>{String(lead.service_interest || "General inquiry")}</td><td>{propertyAddress(lead.property_id)}</td><td>{String(lead.status || "—")}</td><td>{String(lead.priority || "—")}</td><td>{String(lead.created_at || "—")}</td></tr>)}</tbody></table></div> : <p className="muted">No leads linked yet.</p>}</div>
        <div><h3>Appointments</h3>{appointments.length ? <div className="table-wrap"><table><thead><tr><th>Type</th><th>Property</th><th>Date and time</th><th>Status</th><th>Notes</th></tr></thead><tbody>{appointments.map((appointment) => <tr key={String(appointment.id)}><td>{String(appointment.appointment_type || "Appointment")}</td><td>{propertyAddress(appointment.property_id)}</td><td>{appointment.starts_at ? new Date(String(appointment.starts_at)).toLocaleString() : "—"}</td><td>{String(appointment.status || "—")}</td><td>{String(appointment.location_notes || "—")}</td></tr>)}</tbody></table></div> : <p className="muted">No appointments linked yet.</p>}</div>
        <div><h3>Inspections</h3>{inspections.length ? <div className="table-wrap"><table><thead><tr><th>Property</th><th>Inspection date</th><th>Status</th><th>Condition</th><th>Summary</th></tr></thead><tbody>{inspections.map((inspection) => <tr key={String(inspection.id)}><td>{propertyAddress(inspection.property_id)}</td><td>{inspection.inspected_at ? new Date(String(inspection.inspected_at)).toLocaleDateString() : "Not completed"}</td><td>{String(inspection.status || "—")}</td><td>{String(inspection.overall_condition || "—")}</td><td>{String(inspection.summary || "—")}</td></tr>)}</tbody></table></div> : <p className="muted">No inspections linked yet.</p>}</div>
        <div><h3>Property files and photos</h3>{files.length ? <div className="table-wrap"><table><thead><tr><th>Property</th><th>File</th><th>Type</th><th>Added</th></tr></thead><tbody>{files.map((file) => <tr key={String(file.id)}><td>{propertyAddress(file.related_id)}</td><td>{String(file.original_filename || "File")}</td><td>{String(file.content_type || "—")}</td><td>{file.created_at ? new Date(String(file.created_at)).toLocaleDateString() : "—"}</td></tr>)}</tbody></table></div> : <p className="muted">No files or photos linked yet.</p>}</div>
      </div>}
    </section>}
  </div>;
}


function Claims({ division, userId, canWrite }: { division: DivisionId; userId: string; canWrite: boolean }) {
  const [rows,setRows]=useState<GenericRow[]>([]);
  const [customers,setCustomers]=useState<{id:string;display_name:string}[]>([]);
  const [properties,setProperties]=useState<{id:string;customer_id:string;address_line1:string;city:string;state:string}[]>([]);
  const [projects,setProjects]=useState<{id:string;customer_id:string;property_id:string;project_name:string}[]>([]);
  const [customerId,setCustomerId]=useState("");
  const [propertyId,setPropertyId]=useState("");
  const [projectId,setProjectId]=useState("");
  const [claimNumber,setClaimNumber]=useState("");
  const [policyNumber,setPolicyNumber]=useState("");
  const [carrier,setCarrier]=useState("");
  const [dateOfLoss,setDateOfLoss]=useState("");
  const [adjuster,setAdjuster]=useState("");
  const [adjusterEmail,setAdjusterEmail]=useState("");
  const [adjusterPhone,setAdjusterPhone]=useState("");
  const [dateReported,setDateReported]=useState("");
  const [deductible,setDeductible]=useState("");
  const [approvedAmount,setApprovedAmount]=useState("");
  const [replacementCost,setReplacementCost]=useState("");
  const [actualCash,setActualCash]=useState("");
  const [supplement,setSupplement]=useState("");
  const [claimNotes,setClaimNotes]=useState("");
  const [status,setStatus]=useState("open");
  const [message,setMessage]=useState("");
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);

  const load=useCallback(async()=>{
    if(!supabase)return;
    setLoading(true);
    const {data:links,error:linkError}=await supabase.from("crm_customer_divisions").select("customer_id").eq("division_id",division);
    if(linkError)setMessage(linkError.message);
    const ids=(links??[]).map((x:{customer_id:string})=>x.customer_id);
    if(!ids.length){setCustomers([]);setProperties([]);setProjects([]);setRows([]);setLoading(false);return;}
    const [customerResult,propertyResult,projectResult,claimResult]=await Promise.all([
      supabase.from("crm_customers").select("id,display_name").in("id",ids).order("display_name"),
      supabase.from("crm_properties").select("id,customer_id,address_line1,city,state").in("customer_id",ids).order("address_line1"),
      supabase.from("crm_projects").select("id,customer_id,property_id,project_name").in("customer_id",ids).order("created_at",{ascending:false}),
      supabase.from("crm_claims").select("id,customer_id,property_id,project_id,claim_number,policy_number,insurance_carrier,date_of_loss,claim_status,adjuster_name,approved_amount").eq("division_id",division).order("created_at",{ascending:false})
    ]);
    if(customerResult.error)setMessage(customerResult.error.message);
    if(propertyResult.error)setMessage(propertyResult.error.message);
    if(projectResult.error)setMessage(projectResult.error.message);
    if(claimResult.error)setMessage(claimResult.error.message);
    setCustomers(customerResult.data??[]);
    setProperties(propertyResult.data??[]);
    setProjects(projectResult.data??[]);
    setRows((claimResult.data??[]) as GenericRow[]);
    if(!customerId&&customerResult.data?.length)setCustomerId(customerResult.data[0].id);
    setLoading(false);
  },[division,customerId]);
  useEffect(()=>{void load();},[load]);

  async function createClaim(event:FormEvent){
    event.preventDefault();
    if(!supabase)return;    setSaving(true);setMessage("");
    const {error}=await supabase.from("crm_claims").insert({
      division_id:division,customer_id:customerId,property_id:propertyId,project_id:projectId||null,
      claim_number:claimNumber.trim()||null,policy_number:policyNumber.trim()||null,
      insurance_carrier:carrier.trim()||null,date_of_loss:dateOfLoss||null,
      adjuster_name:adjuster.trim()||null,adjuster_email:adjusterEmail.trim()||null,adjuster_phone:adjusterPhone.trim()||null,
      date_reported:dateReported||null,deductible:deductible?Number(deductible):null,approved_amount:approvedAmount?Number(approvedAmount):null,
      replacement_cost_value:replacementCost?Number(replacementCost):null,actual_cash_value:actualCash?Number(actualCash):null,
      supplement_amount:supplement?Number(supplement):null,notes:claimNotes.trim()||null,claim_status:status,created_by:userId
    });
    if(error)setMessage(error.message);
    else{setClaimNumber("");setPolicyNumber("");setCarrier("");setDateOfLoss("");setAdjuster("");setAdjusterEmail("");setAdjusterPhone("");setDateReported("");setDeductible("");setApprovedAmount("");setReplacementCost("");setActualCash("");setSupplement("");setClaimNotes("");setMessage("Insurance claim saved.");await load();}
    setSaving(false);
  }
  const customerName=(id:unknown)=>customers.find(c=>c.id===id)?.display_name||"Customer";
  const propertyName=(id:unknown)=>{const p=properties.find(x=>x.id===id);return p?[p.address_line1,p.city,p.state].filter(Boolean).join(", "):"Property";};
  return <div className="content-stack"><section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">CLAIM REGISTER</p><h2>Insurance claims</h2><p className="muted">Every claim is attached to the customer and the specific property. Projects can be linked to a claim.</p></div></div>
    {canWrite&&customers.length>0&&<form className="inline-form" onSubmit={createClaim}><div className="form-grid">
      <label>Customer / organization<select required value={customerId} onChange={e=>{setCustomerId(e.target.value);setPropertyId("");}}>{customers.map(c=><option key={c.id} value={c.id}>{c.display_name}</option>)}</select></label>
      <label>Property<select required value={propertyId} onChange={e=>{setPropertyId(e.target.value);setProjectId("");}}><option value="">Select property</option>{properties.filter(p=>p.customer_id===customerId).map(p=><option key={p.id} value={p.id}>{[p.address_line1,p.city,p.state].filter(Boolean).join(", ")}</option>)}</select></label>
      <label>Related project (optional)<select value={projectId} onChange={e=>setProjectId(e.target.value)}><option value="">No project linked yet</option>{projects.filter(p=>p.customer_id===customerId&&p.property_id===propertyId).map(p=><option key={p.id} value={p.id}>{p.project_name}</option>)}</select></label>
      <label>Insurance carrier<input value={carrier} onChange={e=>setCarrier(e.target.value)} placeholder="Carrier name"/></label>
      <label>Claim number<input value={claimNumber} onChange={e=>setClaimNumber(e.target.value)}/></label>
      <label>Policy number<input value={policyNumber} onChange={e=>setPolicyNumber(e.target.value)}/></label>
      <label>Date of loss<input type="date" value={dateOfLoss} onChange={e=>setDateOfLoss(e.target.value)}/></label>
      <label>Adjuster name<input value={adjuster} onChange={e=>setAdjuster(e.target.value)}/></label>
      <label>Adjuster email<input type="email" value={adjusterEmail} onChange={e=>setAdjusterEmail(e.target.value)}/></label>
      <label>Adjuster phone<input value={adjusterPhone} onChange={e=>setAdjusterPhone(e.target.value)}/></label>
      <label>Date reported<input type="date" value={dateReported} onChange={e=>setDateReported(e.target.value)}/></label>
      <label>Deductible ($)<input type="number" min="0" step="0.01" value={deductible} onChange={e=>setDeductible(e.target.value)}/></label>
      <label>Approved amount ($)<input type="number" min="0" step="0.01" value={approvedAmount} onChange={e=>setApprovedAmount(e.target.value)}/></label>
      <label>Replacement cost value ($)<input type="number" min="0" step="0.01" value={replacementCost} onChange={e=>setReplacementCost(e.target.value)}/></label>
      <label>Actual cash value ($)<input type="number" min="0" step="0.01" value={actualCash} onChange={e=>setActualCash(e.target.value)}/></label>
      <label>Supplement amount ($)<input type="number" min="0" step="0.01" value={supplement} onChange={e=>setSupplement(e.target.value)}/></label>
      <label className="wide">Claim notes<textarea rows={3} value={claimNotes} onChange={e=>setClaimNotes(e.target.value)}/></label>
      <label>Claim status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="open">Open</option><option value="filed">Filed</option><option value="inspection_scheduled">Inspection scheduled</option><option value="under_review">Under review</option><option value="approved">Approved</option><option value="partially_approved">Partially approved</option><option value="denied">Denied</option><option value="supplement_pending">Supplement pending</option><option value="closed">Closed</option></select></label>
    </div><button className="primary-button" disabled={saving||!customerId||!propertyId}>{saving?"Saving...":"Save claim"}</button></form>}
    {message&&<p className="inline-message">{message}</p>}
    {loading?<div className="empty-state">Loading claims...</div>:rows.length?<div className="table-wrap"><table><thead><tr><th>Customer</th><th>Property</th><th>Carrier</th><th>Claim number</th><th>Policy</th><th>Date of loss</th><th>Status</th><th>Adjuster</th></tr></thead><tbody>{rows.map(row=><tr key={String(row.id)}><td><strong>{customerName(row.customer_id)}</strong></td><td>{propertyName(row.property_id)}</td><td>{String(row.insurance_carrier||"—")}</td><td>{String(row.claim_number||"—")}</td><td>{String(row.policy_number||"—")}</td><td>{String(row.date_of_loss||"—")}</td><td>{String(row.claim_status||"—").replaceAll("_"," ")}</td><td>{String(row.adjuster_name||"—")}</td></tr>)}</tbody></table></div>:<div className="empty-state"><strong>No insurance claims yet</strong><span>Add a customer and property first, then attach the claim to that property.</span></div>}
  </section></div>;
}

function Documents({ division, userId, canWrite }: { division: DivisionId; userId: string; canWrite: boolean }) {
  const [rows,setRows]=useState<{id:string;related_id:string;object_path:string;original_filename:string;content_type:string|null;file_size_bytes:number|null;created_at:string;bucket_id:string}[]>([]);
  const [properties,setProperties]=useState<{id:string;address_line1:string;city:string;state:string}[]>([]);
  const [propertyId,setPropertyId]=useState("");
  const [file,setFile]=useState<File|null>(null);
  const [message,setMessage]=useState("");
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const load=useCallback(async()=>{
    if(!supabase)return;setLoading(true);
    const [linksResult,filesResult]=await Promise.all([
      supabase.from("crm_customer_divisions").select("customer_id").eq("division_id",division),
      supabase.from("crm_files").select("id,related_id,object_path,original_filename,content_type,file_size_bytes,created_at,bucket_id").eq("division_id",division).order("created_at",{ascending:false}).limit(100)
    ]);
    if(linksResult.error)setMessage(linksResult.error.message);
    if(filesResult.error)setMessage(filesResult.error.message);
    const customerIds=(linksResult.data??[]).map(x=>x.customer_id);
    if(customerIds.length){
      const {data:propertyRows,error}=await supabase.from("crm_properties").select("id,address_line1,city,state").in("customer_id",customerIds).order("address_line1");
      if(error)setMessage(error.message);
      const options=propertyRows??[];setProperties(options);
      setPropertyId(current=>options.some(p=>p.id===current)?current:(options[0]?.id??""));
    }else{setProperties([]);setPropertyId("");}
    setRows((filesResult.data??[]) as unknown as typeof rows);
    setLoading(false);
  },[division]);
  useEffect(()=>{void load();},[load]);
  async function uploadFile(event:FormEvent){
    event.preventDefault();if(!supabase||!file)return;
    setMessage("");
    if(!propertyId){setMessage("Add a customer and property before uploading files.");return;}
    const allowed=["image/jpeg","image/png","image/webp","application/pdf"];
    if(!allowed.includes(file.type)){setMessage("Only JPG, PNG, WebP, and PDF files are accepted.");return;}
    if(file.size>15*1024*1024){setMessage("File exceeds the 15 MB limit.");return;}
    setSaving(true);
    const safeName=file.name.replace(/[^a-zA-Z0-9._-]/g,"_").slice(-120)||"file";
    const path=division+"/"+crypto.randomUUID()+"-"+safeName;
    const {error:uploadError}=await supabase.storage.from("roof-doctors-private").upload(path,file,{contentType:file.type,upsert:false});
    if(uploadError){setMessage(uploadError.message);setSaving(false);return;}
    const {error:metadataError}=await supabase.from("crm_files").insert({
      division_id:division,related_type:"property",related_id:propertyId,bucket_id:"roof-doctors-private",
      object_path:path,original_filename:file.name,content_type:file.type,file_size_bytes:file.size,uploaded_by:userId
    });
    if(metadataError){
      await supabase.storage.from("roof-doctors-private").remove([path]);
      setMessage("File upload could not be registered. The uploaded object was rolled back. "+metadataError.message);
    }else{setMessage("File uploaded.");setFile(null);const picker=document.getElementById("crm-file-picker") as HTMLInputElement|null;if(picker)picker.value="";await load();}
    setSaving(false);
  }
  async function openFile(row:typeof rows[number]){
    if(!supabase)return;
    const {data,error}=await supabase.storage.from(row.bucket_id).createSignedUrl(row.object_path,60);
    if(error){setMessage(error.message);return;}
    if(data?.signedUrl)window.open(data.signedUrl,"_blank","noopener,noreferrer");
  }
  return <div className="content-stack"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">PRIVATE DOCUMENT STORAGE</p><h2>Files and property photos</h2><p className="muted">Private files are attached to a property and remain scoped to this division.</p></div></div>
    {canWrite&&<form className="inline-form" onSubmit={uploadFile}><div className="form-grid"><label className="wide">Property<select required value={propertyId} onChange={e=>setPropertyId(e.target.value)}><option value="">Select a property</option>{properties.map(p=><option key={p.id} value={p.id}>{p.address_line1}, {p.city}, {p.state}</option>)}</select></label><label className="wide">Choose file<input id="crm-file-picker" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" onChange={e=>setFile(e.target.files?.[0]??null)}/></label></div><button className="primary-button" disabled={saving||!file||!propertyId}>{saving?"Uploading...":"Upload file"}</button><p className="fine-print">JPG, PNG, WebP, or PDF. Maximum 15 MB per file.</p></form>}
    {message&&<p className="inline-message">{message}</p>}
    {loading?<div className="empty-state">Loading files...</div>:rows.length?<div className="table-wrap"><table><thead><tr><th>File</th><th>Type</th><th>Size</th><th>Uploaded</th><th>Action</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td><strong>{row.original_filename}</strong></td><td>{row.content_type||"—"}</td><td>{row.file_size_bytes?Math.max(1,Math.round(row.file_size_bytes/1024))+" KB":"—"}</td><td>{new Date(row.created_at).toLocaleString()}</td><td><button className="text-button" onClick={()=>void openFile(row)}>Open securely ↗</button></td></tr>)}</tbody></table></div>:<div className="empty-state"><strong>No files uploaded</strong><span>Property photos, inspection images, proposals, and supporting documents will appear here.</span></div>}
  </section></div>;
}

function Contacts({ division, canWrite }: { division: DivisionId; canWrite: boolean }) {
  const [rows, setRows] = useState<{id:string;customer_id:string;full_name:string;title:string|null;email:string|null;phone:string|null;is_primary:boolean;customer_name:string}[]>([]);
  const [customers, setCustomers] = useState<{id:string;display_name:string}[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [primary, setPrimary] = useState(false);
  const [notes, setNotes] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const {data: links,error: linkError}=await supabase.from("crm_customer_divisions").select("customer_id").eq("division_id",division);
    if(linkError) setMessage(linkError.message);
    const ids=(links??[]).map((item:{customer_id:string})=>item.customer_id);
    if(!ids.length){setCustomers([]);setRows([]);setLoading(false);return;}
    const [customerResult,contactResult]=await Promise.all([
      supabase.from("crm_customers").select("id,display_name").in("id",ids).order("display_name"),
      supabase.from("crm_contacts").select("id,customer_id,full_name,title,email,phone,is_primary").in("customer_id",ids).order("full_name")
    ]);
    if(customerResult.error) setMessage(customerResult.error.message);
    if(contactResult.error) setMessage(contactResult.error.message);
    const customerRows=customerResult.data??[];
    setCustomers(customerRows);
    const names:Record<string,string>={};customerRows.forEach(item=>{names[item.id]=item.display_name;});
    setRows((contactResult.data??[]).map(item=>({...item,customer_name:names[item.customer_id]??"Customer"})));
    if(!customerId&&customerRows.length)setCustomerId(customerRows[0].id);
    setLoading(false);
  },[division,customerId]);
  useEffect(()=>{void load();},[load]);
  async function createContact(event:FormEvent){
    event.preventDefault();if(!supabase)return;setSaving(true);setMessage("");
    const {error}=await supabase.from("crm_contacts").insert({customer_id:customerId,full_name:name.trim(),title:title.trim()||null,email:email.trim()||null,phone:phone.trim()||null,is_primary:primary,notes:notes.trim()||null});
    if(error)setMessage(error.message);else{setName("");setTitle("");setEmail("");setPhone("");setNotes("");setPrimary(false);setShowForm(false);setMessage("Contact created.");await load();}
    setSaving(false);
  }
  return <div className="content-stack"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">PEOPLE AND DECISION MAKERS</p><h2>Customer contacts</h2><p className="muted">Contacts are attached to customer accounts within the selected division.</p></div>{canWrite&&customers.length>0&&<button className="primary-button compact" onClick={()=>setShowForm(!showForm)}>{showForm?"Close form":"+ Add contact"}</button>}</div>
    {showForm&&<form className="inline-form" onSubmit={createContact}><div className="form-grid"><label>Customer account<select required value={customerId} onChange={e=>setCustomerId(e.target.value)}>{customers.map(c=><option key={c.id} value={c.id}>{c.display_name}</option>)}</select></label><label>Full name<input required value={name} onChange={e=>setName(e.target.value)}/></label><label>Title or role<input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Owner, property manager, adjuster..."/></label><label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Phone<input value={phone} onChange={e=>setPhone(e.target.value)}/></label><label className="check-field"><span><input type="checkbox" checked={primary} onChange={e=>setPrimary(e.target.checked)}/> Primary contact</span></label><label className="wide">Notes<textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)}/></label></div><button className="primary-button" disabled={saving||!customerId}>{saving?"Saving...":"Save contact"}</button></form>}
    {message&&<p className="inline-message">{message}</p>}
    {loading?<div className="empty-state">Loading contacts...</div>:rows.length?<div className="table-wrap"><table><thead><tr><th>Name</th><th>Customer</th><th>Title</th><th>Email</th><th>Phone</th><th>Primary</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><strong>{r.full_name}</strong></td><td>{r.customer_name}</td><td>{r.title||"—"}</td><td>{r.email||"—"}</td><td>{r.phone||"—"}</td><td>{r.is_primary?"Yes":"No"}</td></tr>)}</tbody></table></div>:<div className="empty-state"><strong>No contacts yet</strong><span>Create a customer first, then add the people associated with that account.</span>{canWrite&&customers.length>0&&<button className="secondary-button" onClick={()=>setShowForm(true)}>Add first contact</button>}</div>}
  </section></div>;
}

function Properties({ division, canWrite }: { division: DivisionId; canWrite: boolean }) {
  const [rows, setRows] = useState<GenericRow[]>([]);
  const [customers, setCustomers] = useState<{id:string;display_name:string}[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("TX");
  const [postal, setPostal] = useState("");
  const [propertyType, setPropertyType] = useState("residential");
  const [county, setCounty] = useState("");
  const [parcelNumber, setParcelNumber] = useState("");
  const [buildingName, setBuildingName] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data: links, error: linkError } = await supabase.from("crm_customer_divisions").select("customer_id").eq("division_id", division);
    if (linkError) setMessage(linkError.message);
    const ids = (links ?? []).map((item: {customer_id:string}) => item.customer_id);
    if (!ids.length) {
      setRows([]);
      setCustomers([]);
    } else {
      const [customerResult, propertyResult] = await Promise.all([
        supabase.from("crm_customers").select("id,display_name").in("id", ids).order("display_name"),
        supabase.from("crm_properties").select("id,address_line1,city,state,postal_code,property_type,county,parcel_number,building_name,created_at").in("customer_id", ids).order("created_at", {ascending:false})
      ]);
      if (customerResult.error) setMessage(customerResult.error.message);
      if (propertyResult.error) setMessage(propertyResult.error.message);
      setCustomers(customerResult.data ?? []);
      setRows((propertyResult.data ?? []) as unknown as GenericRow[]);
      if (!customerId && customerResult.data?.length) setCustomerId(customerResult.data[0].id);
    }
    setLoading(false);
  }, [division, customerId]);
  useEffect(() => { void load(); }, [load]);
  async function createProperty(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setMessage("");
    const { error } = await supabase.from("crm_properties").insert({
      customer_id: customerId,
      address_line1: address.trim(),
      city: city.trim(),
      state: state.trim().toUpperCase(),
      postal_code: postal.trim() || null,
      property_type: propertyType,
      county: county.trim() || null,
      parcel_number: parcelNumber.trim() || null,
      building_name: buildingName.trim() || null
    });
    if (error) setMessage(error.message);
    else {
      setAddress(""); setCity(""); setPostal(""); setCounty(""); setParcelNumber(""); setBuildingName(""); setShowForm(false); setMessage("Property created.");
      await load();
    }
    setSaving(false);
  }
  return <div className="content-stack"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">PROPERTY RECORDS</p><h2>Properties and locations</h2><p className="muted">Each property is linked to a customer account and can hold multiple roof records.</p></div>{canWrite && customers.length > 0 && <button className="primary-button compact" onClick={() => setShowForm(!showForm)}>{showForm ? "Close form" : "+ Add property"}</button>}</div>
    {showForm && <form className="inline-form" onSubmit={createProperty}><div className="form-grid"><label>Customer account<select required value={customerId} onChange={(event) => setCustomerId(event.target.value)}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.display_name}</option>)}</select></label><label>Property type<select value={propertyType} onChange={(event) => setPropertyType(event.target.value)}><option value="residential">Residential</option><option value="commercial">Commercial</option><option value="multifamily">Multifamily</option><option value="industrial">Industrial</option><option value="institutional">Church / School / Institutional</option></select></label><label className="wide">Street address<input required value={address} onChange={(event) => setAddress(event.target.value)} /></label><label>City<input required value={city} onChange={(event) => setCity(event.target.value)} /></label><label>State<input required value={state} onChange={(event) => setState(event.target.value)} maxLength={2} /></label><label>ZIP code<input value={postal} onChange={(event) => setPostal(event.target.value)} /></label><label>County<input value={county} onChange={(event) => setCounty(event.target.value)} /></label><label>Parcel / account number<input value={parcelNumber} onChange={(event) => setParcelNumber(event.target.value)} /></label><label className="wide">Building or property name<input value={buildingName} onChange={(event) => setBuildingName(event.target.value)} placeholder="Building, campus, or property name" /></label></div><button className="primary-button" disabled={saving || !customerId}>{saving ? "Saving..." : "Save property"}</button></form>}
    {message && <p className="inline-message">{message}</p>}
    {loading ? <div className="empty-state">Loading properties...</div> : rows.length ? <div className="table-wrap"><table><thead><tr><th>Street address</th><th>City</th><th>State</th><th>ZIP</th><th>Type</th><th>County</th><th>Parcel / building</th><th>Added</th></tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td><strong>{String(row.address_line1 || "Property")}</strong></td><td>{String(row.city || "—")}</td><td>{String(row.state || "—")}</td><td>{String(row.postal_code || "—")}</td><td>{String(row.property_type || "—")}</td><td>{String(row.county || "—")}</td><td>{[row.parcel_number,row.building_name].filter(Boolean).join(" · ") || "—"}</td><td>{formatValue("created_at",row.created_at)}</td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>No properties yet</strong><span>Add a customer first, then create the property record here.</span>{canWrite && customers.length > 0 && <button className="secondary-button" onClick={() => setShowForm(true)}>Add first property</button>}</div>}
  </section></div>;
}

function Roofs({ division, canWrite }: { division: DivisionId; canWrite: boolean }) {
  const [rows,setRows]=useState<any[]>([]);
  const [properties,setProperties]=useState<{id:string;address_line1:string;city:string;state:string}[]>([]);
  const [propertyId,setPropertyId]=useState("");
  const [section,setSection]=useState("");
  const [roofType,setRoofType]=useState("sloped");
  const [material,setMaterial]=useState("asphalt_shingle");
  const [year,setYear]=useState("");
  const [area,setArea]=useState("");
  const [pitch,setPitch]=useState("");
  const [layers,setLayers]=useState("");
  const [condition,setCondition]=useState("");
  const [warranty,setWarranty]=useState("");
  const [showForm,setShowForm]=useState(false);
  const [message,setMessage]=useState("");
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const load=useCallback(async()=>{
    if(!supabase)return;setLoading(true);
    const {data:links,error:linkError}=await supabase.from("crm_customer_divisions").select("customer_id").eq("division_id",division);
    if(linkError)setMessage(linkError.message);
    const ids=(links??[]).map((x:{customer_id:string})=>x.customer_id);
    if(!ids.length){setProperties([]);setRows([]);setLoading(false);return;}
    const {data:propertyRows,error:propertyError}=await supabase.from("crm_properties").select("id,address_line1,city,state").in("customer_id",ids).order("address_line1");
    if(propertyError)setMessage(propertyError.message);
    const options=propertyRows??[];setProperties(options);
    if(!options.length){setRows([]);setLoading(false);return;}
    const {data:roofRows,error:roofError}=await supabase.from("crm_roofs").select("id,property_id,roof_section,roof_type,covering_material,installation_year,approximate_area_sqft,pitch,layers_count,condition_summary,warranty_notes").in("property_id",options.map(x=>x.id)).order("created_at",{ascending:false});
    if(roofError)setMessage(roofError.message);
    const addresses:Record<string,string>={};options.forEach(p=>{addresses[p.id]=[p.address_line1,p.city,p.state].filter(Boolean).join(", ");});
    setRows((roofRows??[]).map(r=>({...r,address:addresses[r.property_id]??"Property"})));
    setLoading(false);
  },[division]);
  useEffect(()=>{void load();},[load]);
  async function createRoof(event:FormEvent){
    event.preventDefault();if(!supabase)return;setSaving(true);setMessage("");
    const {error}=await supabase.from("crm_roofs").insert({property_id:propertyId,roof_section:section.trim()||null,roof_type:roofType,covering_material:material,installation_year:year?Number(year):null,approximate_area_sqft:area?Number(area):null,pitch:pitch.trim()||null,layers_count:layers?Number(layers):null,condition_summary:condition.trim()||null,warranty_notes:warranty.trim()||null});
    if(error)setMessage(error.message);else{setSection("");setYear("");setArea("");setPitch("");setLayers("");setCondition("");setWarranty("");setShowForm(false);setMessage("Roof system created.");await load();}
    setSaving(false);
  }
  return <div className="content-stack"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">ROOF ASSET REGISTER</p><h2>Roof systems</h2><p className="muted">Track roof assemblies, materials, age, area, condition, and warranty notes by property.</p></div>{canWrite&&properties.length>0&&<button className="primary-button compact" onClick={()=>setShowForm(!showForm)}>{showForm?"Close form":"+ Add roof system"}</button>}</div>
    {showForm&&<form className="inline-form" onSubmit={createRoof}><div className="form-grid"><label className="wide">Property<select required value={propertyId} onChange={e=>setPropertyId(e.target.value)}>{properties.map(p=><option key={p.id} value={p.id}>{p.address_line1}, {p.city}, {p.state}</option>)}</select></label><label>Roof section<input value={section} onChange={e=>setSection(e.target.value)} placeholder="Main building, north wing, garage..."/></label><label>Roof type<select value={roofType} onChange={e=>setRoofType(e.target.value)}><option value="sloped">Sloped</option><option value="low_slope">Low slope</option><option value="flat">Flat</option><option value="metal">Metal system</option><option value="other">Other</option></select></label><label>Covering material<select value={material} onChange={e=>setMaterial(e.target.value)}><option value="asphalt_shingle">Asphalt shingle</option><option value="standing_seam_metal">Standing seam metal</option><option value="metal_panel">Metal panel</option><option value="tpo">TPO</option><option value="epdm">EPDM</option><option value="pvc">PVC</option><option value="modified_bitumen">Modified bitumen</option><option value="built_up">Built up</option><option value="tile">Tile</option><option value="other">Other</option></select></label><label>Installation year<input type="number" min="1900" max="2100" value={year} onChange={e=>setYear(e.target.value)}/></label><label>Approximate area (sq ft)<input type="number" min="0" step="1" value={area} onChange={e=>setArea(e.target.value)}/></label><label>Pitch<input value={pitch} onChange={e=>setPitch(e.target.value)} placeholder="6/12, 1/12, flat..."/></label><label>Layers<input type="number" min="1" max="10" value={layers} onChange={e=>setLayers(e.target.value)}/></label><label className="wide">Condition summary<textarea rows={2} value={condition} onChange={e=>setCondition(e.target.value)}/></label><label className="wide">Warranty notes<textarea rows={2} value={warranty} onChange={e=>setWarranty(e.target.value)}/></label></div><button className="primary-button" disabled={saving||!propertyId}>{saving?"Saving...":"Save roof system"}</button></form>}
    {message&&<p className="inline-message">{message}</p>}
    {loading?<div className="empty-state">Loading roof systems...</div>:rows.length?<div className="table-wrap"><table><thead><tr><th>Property</th><th>Section</th><th>Type</th><th>Material</th><th>Year</th><th>Area sq ft</th><th>Condition</th></tr></thead><tbody>{rows.map(r=><tr key={r.id}><td><strong>{r.address}</strong></td><td>{r.roof_section||"—"}</td><td>{String(r.roof_type||"—").replaceAll("_"," ")}</td><td>{String(r.covering_material||"—").replaceAll("_"," ")}</td><td>{r.installation_year||"—"}</td><td>{r.approximate_area_sqft??"—"}</td><td>{r.condition_summary||"—"}</td></tr>)}</tbody></table></div>:<div className="empty-state"><strong>No roof systems recorded</strong><span>Add a property first, then document each roof section or system.</span>{canWrite&&properties.length>0&&<button className="secondary-button" onClick={()=>setShowForm(true)}>Add first roof system</button>}</div>}
  </section></div>;
}

type DataListView = "appointments" | "inspections" | "projects" | "tasks";

const listConfig: Record<DataListView, { table: string; columns: string; order: string; title: string; labels: string[] }> = {
  appointments: { table: "crm_appointments", columns: "id,appointment_type,status,starts_at,assigned_to,location_notes", order: "starts_at", title: "Appointments", labels: ["Appointment","Status","Scheduled","Assigned employee"] },
  inspections: { table: "crm_inspections", columns: "id,status,inspected_at,overall_condition,summary,property_id", order: "created_at", title: "Inspection records", labels: ["Inspection","Status","Date","Condition","Summary"] },
  projects: { table: "crm_projects", columns: "id,project_name,project_type,status,target_completion_date,project_manager_id", order: "created_at", title: "Production projects", labels: ["Project","Type","Status","Target completion","Manager"] },
  tasks: { table: "crm_tasks", columns: "id,title,status,priority,due_at,assigned_to", order: "created_at", title: "Team tasks", labels: ["Task","Status","Priority","Due date","Assigned employee"] }
};

function DataList({ division, view, userId, canWrite }: { division: DivisionId; view: DataListView; userId: string; canWrite: boolean }) {
  const config = listConfig[view];
  const [rows, setRows] = useState<GenericRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [dueAt, setDueAt] = useState("");
  const [appointmentType, setAppointmentType] = useState("inspection");
  const [startsAt, setStartsAt] = useState("");
  const [projectType, setProjectType] = useState("roof_replacement");
  const [targetDate, setTargetDate] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [propertyOptions, setPropertyOptions] = useState<{id:string;customer_id:string;address_line1:string;city:string;state:string}[]>([]);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const result = await supabase.from(config.table).select(config.columns).eq("division_id", division).order(config.order, { ascending: view === "appointments" }).limit(100);
    const data = (result.data ?? []) as unknown as GenericRow[];    const errorMessage = result.error?.message ?? "";
    setError(errorMessage);
    setRows(data);
    if (view === "projects" || view === "inspections") {
      const { data: links } = await supabase.from("crm_customer_divisions").select("customer_id").eq("division_id", division);
      const customerIds = (links ?? []).map((item: {customer_id:string}) => item.customer_id);
      if (customerIds.length) {
        const { data: properties } = await supabase.from("crm_properties").select("id,customer_id,address_line1,city,state").in("customer_id", customerIds).order("address_line1");
        const options = properties ?? [];
        setPropertyOptions(options);
        if (!propertyId && options.length) setPropertyId(options[0].id);
      } else setPropertyOptions([]);
    }
    setLoading(false);
  }, [config, division, view, propertyId]);
  useEffect(() => { void load(); }, [load]);
  const fields = useMemo(() => config.columns.split(",").filter((column) => !["id","division_id","property_id","assigned_to","project_manager_id"].includes(column)), [config.columns]);
  async function createRecord(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setError("");
    let payload: Record<string, unknown>;
    const table = config.table;
    if (view === "appointments") {
      payload = { division_id: division, appointment_type: appointmentType, starts_at: new Date(startsAt).toISOString(), internal_notes: description || null, created_by: userId };
    } else if (view === "tasks") {
      payload = { division_id: division, title: title.trim(), description: description || null, priority, due_at: dueAt ? new Date(dueAt).toISOString() : null, created_by: userId };
    } else if (view === "projects") {
      const property = propertyOptions.find((item) => item.id === propertyId);
      if (!property) { setError("Add a property before creating a project."); setSaving(false); return; }
      payload = { division_id: division, project_name: title.trim(), project_type: projectType, property_id: property.id, customer_id: property.customer_id, target_completion_date: targetDate || null, scope_of_work: description || null, created_by: userId };
    } else {
      if (!propertyId) { setError("Add a property before creating an inspection."); setSaving(false); return; }
      payload = { division_id: division, property_id: propertyId, inspector_id: userId, summary: description || null, status: "draft" };
    }
    const { error: insertError } = await supabase.from(table).insert(payload);
    if (insertError) setError(insertError.message);
    else {
      setShowForm(false); setTitle(""); setDescription(""); setDueAt(""); setStartsAt(""); setTargetDate("");
      await load();
    }
    setSaving(false);
  }
  return <div className="content-stack"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">{division} OPERATIONS</p><h2>{config.title}</h2></div><div className="panel-actions"><span className="record-count">{rows.length} records</span>{canWrite && <button className="primary-button compact" onClick={() => setShowForm(!showForm)}>{showForm ? "Close form" : "+ Add record"}</button>}</div></div>
    {showForm && <form className="inline-form" onSubmit={createRecord}><div className="form-grid">
      {view === "appointments" && <><label>Appointment type<select value={appointmentType} onChange={(event) => setAppointmentType(event.target.value)}><option value="inspection">Roof inspection</option><option value="estimate">Estimate appointment</option><option value="repair">Repair service</option><option value="maintenance">Maintenance visit</option><option value="project_meeting">Project meeting</option></select></label><label>Date and time<input required type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label className="wide">Notes<textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} /></label></>}
      {view === "tasks" && <><label>Task title<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label>Due date<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label><label className="wide">Details<textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} /></label></>}
      {view === "projects" && <><label>Project name<input required value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>Project type<select value={projectType} onChange={(event) => setProjectType(event.target.value)}><option value="roof_replacement">Roof replacement</option><option value="repair">Repair</option><option value="restoration">Roof restoration</option><option value="coating">Roof coating</option><option value="maintenance">Maintenance</option><option value="other">Other</option></select></label><label className="wide">Property<select required value={propertyId} onChange={(event) => setPropertyId(event.target.value)}><option value="">Select a property</option>{propertyOptions.map((item) => <option key={item.id} value={item.id}>{item.address_line1}, {item.city}, {item.state}</option>)}</select></label><label>Target completion<input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} /></label><label className="wide">Scope of work<textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} /></label></>}
      {view === "inspections" && <><label className="wide">Property<select required value={propertyId} onChange={(event) => setPropertyId(event.target.value)}><option value="">Select a property</option>{propertyOptions.map((item) => <option key={item.id} value={item.id}>{item.address_line1}, {item.city}, {item.state}</option>)}</select></label><label className="wide">Initial inspection notes<textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Add observations after field review. AI generated notes must be human verified." /></label></>}
    </div><button className="primary-button" disabled={saving}>{saving ? "Saving..." : "Save record"}</button></form>}
    {error && <p className="inline-message">{error}</p>}{loading ? <div className="empty-state">Loading records...</div> : rows.length ? <div className="table-wrap"><table><thead><tr>{fields.map((field) => <th key={field}>{field.replaceAll("_"," ")}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}>{fields.map((field) => <td key={field}>{formatValue(field, row[field])}</td>)}</tr>)}</tbody></table></div> : <div className="empty-state"><strong>This workspace is ready</strong><span>No {config.title.toLowerCase()} have been entered for this division yet.</span>{canWrite && <button className="secondary-button" onClick={() => setShowForm(true)}>Add first record</button>}</div>}</section></div>;
}

function formatValue(field: string, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  if (field.endsWith("_at") || field.endsWith("_date")) return new Date(String(value)).toLocaleString();
  return String(value).replaceAll("_"," ");
}

function Team({ division }: { division: DivisionId }) {
  const [rows, setRows] = useState<{ user_id: string; division_id: string; role: string; active: boolean }[]>([]);
  const [profiles, setProfiles] = useState<Record<string, { name: string; email: string }>>({});
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [inviteDivision, setInviteDivision] = useState<DivisionId>(division);
  const [role, setRole] = useState("sales_rep");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data, error: queryError } = await supabase.from("crm_memberships").select("user_id,division_id,role,active").order("division_id");
    if (queryError) setError(queryError.message);
    const membershipRows = data ?? [];
    setRows(membershipRows);
    const ids = [...new Set(membershipRows.map((item) => item.user_id))];
    if (ids.length) {
      const { data: profileRows } = await supabase.from("crm_profiles").select("user_id,display_name,email").in("user_id", ids);
      const map: Record<string,{name:string;email:string}> = {};
      (profileRows ?? []).forEach((item) => { map[item.user_id] = { name: item.display_name || item.email || item.user_id, email: item.email || "" }; });
      setProfiles(map);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setInviteDivision(division); }, [division]);

  async function saveEmployee(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setMessage("");
    setError("");
    const { data, error: invokeError } = await supabase.functions.invoke("crm-invite-employee", {
      body: { email: email.trim(), display_name: displayName.trim(), division_id: inviteDivision, role },
    });
    if (invokeError) {
      setError(invokeError.message);
    } else if (data?.error) {
      setError(data.error);
    } else {
      setMessage(data?.message || "Employee access updated.");
      setEmail("");
      setDisplayName("");
      setShowForm(false);
      await load();
    }
    setSaving(false);
  }

  return <div className="content-stack"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">ACCESS CONTROL</p><h2>Employee memberships</h2><p className="muted">Invite new employees or assign an existing account to a division and role.</p></div><button className="primary-button compact" onClick={() => setShowForm(!showForm)}>{showForm ? "Close form" : "+ Add employee"}</button></div>
    {showForm && <form className="inline-form" onSubmit={saveEmployee}><div className="form-grid"><label>Employee name<input value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder="Full name"/></label><label>Work email<input required type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="employee@company.com"/></label><label>Division<select value={inviteDivision} onChange={event => setInviteDivision(event.target.value as DivisionId)}><option value="TRD">The ROOF Doctors</option><option value="CRD">Commercial ROOF Doctors</option></select></label><label>Role<select value={role} onChange={event => setRole(event.target.value)}><option value="division_admin">Division Admin</option><option value="office_manager">Office Manager</option><option value="sales_rep">Sales Rep</option><option value="project_manager">Project Manager</option><option value="field_inspector">Field Inspector</option><option value="production_manager">Production Manager</option><option value="accounting">Accounting</option><option value="read_only">Read Only</option></select></label></div><button className="primary-button" disabled={saving}>{saving ? "Saving access..." : "Send invitation or assign access"}</button><p className="fine-print">New accounts receive a Supabase invitation. Existing accounts are assigned the selected division role. Owner access is not assignable here.</p></form>}
    {message && <p className="inline-message">{message}</p>}
    {error && <p className="inline-message">{error}</p>}
    <div className="table-wrap"><table><thead><tr><th>Employee</th><th>Email</th><th>Division</th><th>Role</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.user_id + row.division_id}><td><strong>{profiles[row.user_id]?.name || row.user_id}</strong></td><td>{profiles[row.user_id]?.email || "—"}</td><td>{row.division_id}</td><td>{row.role.replaceAll("_"," ")}</td><td><span className={row.active ? "pill active" : "pill inactive"}>{row.active ? "Active" : "Inactive"}</span></td></tr>)}</tbody></table></div>
  </section></div>;
}
export default App;