import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";

type DivisionId = "TRD" | "CRD";
type Role = "owner" | "division_admin" | "office_manager" | "sales_rep" | "project_manager" | "field_inspector" | "production_manager" | "accounting" | "read_only";
type Membership = { division_id: DivisionId; role: Role };
type View = "overview" | "leads" | "customers" | "contacts" | "properties" | "roofs" | "appointments" | "inspections" | "projects" | "tasks" | "team";
type Lead = { id: string; service_interest: string | null; status: string; priority: string; source: string | null; description: string | null; created_at: string };
type Customer = { id: string; display_name: string; customer_type: string; email: string | null; phone: string | null; created_at: string };
type GenericRow = Record<string, string | number | null>;

const navigation: { id: View; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "▦" },
  { id: "leads", label: "Leads", icon: "◎" },
  { id: "customers", label: "Customers", icon: "♙" },
  { id: "contacts", label: "Contacts", icon: "♧" },
  { id: "properties", label: "Properties", icon: "⌂" },
  { id: "roofs", label: "Roof systems", icon: "⌃" },
  { id: "appointments", label: "Schedule", icon: "▣" },
  { id: "inspections", label: "Inspections", icon: "⌕" },
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
  const [authMessage, setAuthMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [profileName, setProfileName] = useState("");

  const loadMemberships = useCallback(async (activeSession: Session | null) => {
    if (!supabase || !activeSession) {
      setMemberships([]);
      setLoading(false);
      return;
    }
    setLoading(true);
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
      if (rows.length && !rows.some((item) => item.division_id === division)) {
        setDivision(rows[0].division_id);
      }
    }
    setProfileName(profileResult.data?.display_name ?? activeSession.user.email ?? "");
    setLoading(false);
  }, [division]);

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
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      void loadMemberships(nextSession);
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
  const canWriteContacts = canWriteCustomers;
  const canWriteRoofs = currentMembership ? ["owner","division_admin","office_manager","project_manager","production_manager"].includes(currentMembership.role) : false;
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

  async function signOut() {
    if (supabase) await supabase.auth.signOut();
  }

  if (!supabase) {
    return <div className="setup-screen"><div className="setup-card"><div className="brand-mark">RD</div><h1>Operations workspace</h1><p>Supabase environment settings are missing. Add the project URL and publishable key to the deployment environment.</p><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_PUBLISHABLE_KEY</code></div></div>;
  }

  if (!session) {
    return <div className="login-screen"><div className="login-card"><div className="brand-mark">RD</div><p className="eyebrow">PRIVATE EMPLOYEE PORTAL</p><h1>Roof Doctors Operations</h1><p className="muted">One secure workspace for residential and commercial roofing operations.</p><form onSubmit={sendSignInLink}><label htmlFor="email">Work email</label><input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /><button className="primary-button" disabled={authBusy}>{authBusy ? "Sending link..." : "Email me a sign in link"}</button></form>{authMessage && <p className="auth-message">{authMessage}</p>}<p className="fine-print">Access is invitation only. New accounts cannot self register.</p></div></div>;
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
      {view === "leads" && <Leads division={division} userId={session.user.id} canWrite={canWriteLeads} />}
      {view === "customers" && <Customers division={division} userId={session.user.id} canWrite={canWriteCustomers} />}
      {view === "contacts" && <Contacts division={division} canWrite={canWriteContacts} />}
      {view === "properties" && <Properties division={division} canWrite={canWriteCustomers} />}
      {view === "roofs" && <Roofs division={division} canWrite={canWriteRoofs} />}
      {view === "appointments" && <DataList division={division} view="appointments" userId={session.user.id} canWrite={canWriteAppointments} />}
      {view === "inspections" && <DataList division={division} view="inspections" userId={session.user.id} canWrite={canWriteInspections} />}
      {view === "projects" && <DataList division={division} view="projects" userId={session.user.id} canWrite={canWriteProjects} />}
      {view === "tasks" && <DataList division={division} view="tasks" userId={session.user.id} canWrite={canWriteTasks} />}
      {view === "team" && isOwner && <Team />}
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

function Leads({ division, userId, canWrite }: { division: DivisionId; userId: string; canWrite: boolean }) {
  const [rows, setRows] = useState<Lead[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [service, setService] = useState("");
  const [source, setSource] = useState("Phone");
  const [priority, setPriority] = useState("normal");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
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
  return <div className="content-stack"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">OPPORTUNITY MANAGEMENT</p><h2>Lead pipeline</h2><p className="muted">{rows.length} records in this division</p></div>{canWrite && <button className="primary-button compact" onClick={() => setShowForm(!showForm)}>{showForm ? "Close form" : "+ Add lead"}</button>}</div>
    {showForm && <form className="inline-form" onSubmit={createLead}><div className="form-grid"><label>Service requested<input value={service} onChange={(event) => setService(event.target.value)} placeholder="Roof replacement, repair, gutter cleaning..." /></label><label>Lead source<select value={source} onChange={(event) => setSource(event.target.value)}><option>Phone</option><option>Website</option><option>Referral</option><option>Google</option><option>Repeat customer</option><option>Other</option></select></label><label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label><label className="wide">Notes<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} placeholder="What does the customer need?" /></label></div><button className="primary-button" disabled={saving}>{saving ? "Saving..." : "Save lead"}</button></form>}
    {message && <p className="inline-message">{message}</p>}
    {loading ? <div className="empty-state">Loading leads...</div> : rows.length ? <div className="table-wrap"><table><thead><tr><th>Service</th><th>Source</th><th>Status</th><th>Priority</th><th>Created</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.service_interest || "Unspecified service"}</strong><span className="subline">{row.description || "No notes"}</span></td><td>{row.source || "—"}</td><td>{canWrite ? <select className="table-select" value={row.status} onChange={(event) => void updateStatus(row.id, event.target.value)}><option value="new">New</option><option value="contacted">Contacted</option><option value="qualified">Qualified</option><option value="appointment_set">Appointment set</option><option value="inspection_pending">Inspection pending</option><option value="estimate_in_progress">Estimate in progress</option><option value="proposal_sent">Proposal sent</option><option value="won">Won</option><option value="lost">Lost</option><option value="on_hold">On hold</option></select> : <span className={"pill " + row.status}>{row.status.replaceAll("_"," ")}</span>}</td><td><span className={"priority " + row.priority}>{row.priority}</span></td><td>{new Date(row.created_at).toLocaleDateString()}</td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>Your lead pipeline is ready</strong><span>There are no CRM leads in this division yet. Existing public website submissions have not been copied or changed.</span>{canWrite && <button className="secondary-button" onClick={() => setShowForm(true)}>Add your first lead</button>}</div>}
  </section></div>;
}

function Customers({ division, userId, canWrite }: { division: DivisionId; userId: string; canWrite: boolean }) {
  const [rows, setRows] = useState<Customer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("individual");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
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
      const { data, error } = await supabase.from("crm_customers").select("id,display_name,customer_type,email,phone,created_at").in("id", ids).order("created_at", { ascending: false });
      if (error) setMessage(error.message);
      setRows((data ?? []) as Customer[]);
    }
    setLoading(false);
  }, [division]);
  useEffect(() => { void load(); }, [load]);
  async function createCustomer(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setMessage("");
    const { data, error } = await supabase.from("crm_customers").insert({ display_name: name.trim(), customer_type: type, email: email.trim() || null, phone: phone.trim() || null, created_by: userId }).select("id").single();
    if (error) setMessage(error.message);
    else {
      const { error: linkError } = await supabase.from("crm_customer_divisions").insert({ customer_id: data.id, division_id: division });
      if (linkError) setMessage("Customer was created, but division linking failed: " + linkError.message);
      else {
        setName(""); setEmail(""); setPhone(""); setShowForm(false); setMessage("Customer created.");
      }
      await load();
    }
    setSaving(false);
  }
  return <div className="content-stack"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">CUSTOMER DIRECTORY</p><h2>Customers and accounts</h2><p className="muted">Shared customer identities can be linked to both divisions.</p></div>{canWrite && <button className="primary-button compact" onClick={() => setShowForm(!showForm)}>{showForm ? "Close form" : "+ Add customer"}</button>}</div>
    {showForm && <form className="inline-form" onSubmit={createCustomer}><div className="form-grid"><label>Customer or account name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Name or business" /></label><label>Customer type<select value={type} onChange={(event) => setType(event.target.value)}><option value="individual">Homeowner / Individual</option><option value="business">Business</option><option value="property_manager">Property manager</option><option value="organization">Organization</option></select></label><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label></div><button className="primary-button" disabled={saving}>{saving ? "Saving..." : "Save customer"}</button></form>}
    {message && <p className="inline-message">{message}</p>}
    {loading ? <div className="empty-state">Loading customers...</div> : rows.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>Email</th><th>Phone</th><th>Added</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.display_name}</strong></td><td>{row.customer_type.replaceAll("_"," ")}</td><td>{row.email || "—"}</td><td>{row.phone || "—"}</td><td>{new Date(row.created_at).toLocaleDateString()}</td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>No customer records yet</strong><span>Add a customer to start building the shared customer and property history.</span>{canWrite && <button className="secondary-button" onClick={() => setShowForm(true)}>Add first customer</button>}</div>}
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
        supabase.from("crm_properties").select("id,address_line1,city,state,postal_code,property_type,created_at").in("customer_id", ids).order("created_at", {ascending:false})
      ]);
      if (customerResult.error) setMessage(customerResult.error.message);
      if (propertyResult.error) setMessage(propertyResult.error.message);
      setCustomers(customerResult.data ?? []);
      setRows((propertyResult.data ?? []) as GenericRow[]);
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
      property_type: propertyType
    });
    if (error) setMessage(error.message);
    else {
      setAddress(""); setCity(""); setPostal(""); setShowForm(false); setMessage("Property created.");
      await load();
    }
    setSaving(false);
  }
  return <div className="content-stack"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">PROPERTY RECORDS</p><h2>Properties and locations</h2><p className="muted">Each property is linked to a customer account and can hold multiple roof records.</p></div>{canWrite && customers.length > 0 && <button className="primary-button compact" onClick={() => setShowForm(!showForm)}>{showForm ? "Close form" : "+ Add property"}</button>}</div>
    {showForm && <form className="inline-form" onSubmit={createProperty}><div className="form-grid"><label>Customer account<select required value={customerId} onChange={(event) => setCustomerId(event.target.value)}>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.display_name}</option>)}</select></label><label>Property type<select value={propertyType} onChange={(event) => setPropertyType(event.target.value)}><option value="residential">Residential</option><option value="commercial">Commercial</option><option value="multifamily">Multifamily</option><option value="industrial">Industrial</option><option value="institutional">Church / School / Institutional</option></select></label><label className="wide">Street address<input required value={address} onChange={(event) => setAddress(event.target.value)} /></label><label>City<input required value={city} onChange={(event) => setCity(event.target.value)} /></label><label>State<input required value={state} onChange={(event) => setState(event.target.value)} maxLength={2} /></label><label>ZIP code<input value={postal} onChange={(event) => setPostal(event.target.value)} /></label></div><button className="primary-button" disabled={saving || !customerId}>{saving ? "Saving..." : "Save property"}</button></form>}
    {message && <p className="inline-message">{message}</p>}
    {loading ? <div className="empty-state">Loading properties...</div> : rows.length ? <div className="table-wrap"><table><thead><tr><th>Street address</th><th>City</th><th>State</th><th>ZIP</th><th>Type</th><th>Added</th></tr></thead><tbody>{rows.map((row) => <tr key={String(row.id)}><td><strong>{String(row.address_line1 || "Property")}</strong></td><td>{String(row.city || "—")}</td><td>{String(row.state || "—")}</td><td>{String(row.postal_code || "—")}</td><td>{String(row.property_type || "—")}</td><td>{formatValue("created_at",row.created_at)}</td></tr>)}</tbody></table></div> : <div className="empty-state"><strong>No properties yet</strong><span>Add a customer first, then create the property record here.</span>{canWrite && customers.length > 0 && <button className="secondary-button" onClick={() => setShowForm(true)}>Add first property</button>}</div>}
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

const listConfig: Record<Exclude<View,"overview"|"leads"|"customers"|"team">, { table: string; columns: string; order: string; title: string; labels: string[] }> = {
  properties: { table: "crm_properties", columns: "id,address_line1,city,state,postal_code,property_type,created_at", order: "created_at", title: "Property records", labels: ["Address","City","State","Type","Added"] },
  appointments: { table: "crm_appointments", columns: "id,appointment_type,status,starts_at,assigned_to,location_notes", order: "starts_at", title: "Appointments", labels: ["Appointment","Status","Scheduled","Assigned employee"] },
  inspections: { table: "crm_inspections", columns: "id,status,inspected_at,overall_condition,summary,property_id", order: "created_at", title: "Inspection records", labels: ["Inspection","Status","Date","Condition","Summary"] },
  projects: { table: "crm_projects", columns: "id,project_name,project_type,status,target_completion_date,project_manager_id", order: "created_at", title: "Production projects", labels: ["Project","Type","Status","Target completion","Manager"] },
  tasks: { table: "crm_tasks", columns: "id,title,status,priority,due_at,assigned_to", order: "created_at", title: "Team tasks", labels: ["Task","Status","Priority","Due date","Assigned employee"] }
};

function DataList({ division, view, userId, canWrite }: { division: DivisionId; view: Exclude<View,"overview"|"leads"|"customers"|"team"|"properties">; userId: string; canWrite: boolean }) {
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
    const data = (result.data ?? []) as GenericRow[];
    const errorMessage = result.error?.message ?? "";
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

function Team() {
  const [rows, setRows] = useState<{ user_id: string; division_id: string; role: string; active: boolean }[]>([]);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  useEffect(() => {
    async function load() {
      if (!supabase) return;
      const { data, error: queryError } = await supabase.from("crm_memberships").select("user_id,division_id,role,active").order("division_id");
      if (queryError) setError(queryError.message);
      const membershipRows = data ?? [];
      setRows(membershipRows);
      const ids = [...new Set(membershipRows.map((item) => item.user_id))];
      if (ids.length) {
        const { data: profileRows } = await supabase.from("crm_profiles").select("user_id,display_name,email").in("user_id", ids);
        const map: Record<string,string> = {};
        (profileRows ?? []).forEach((item) => { map[item.user_id] = item.display_name || item.email || item.user_id; });
        setProfiles(map);
      }
    }
    void load();
  }, []);
  return <div className="content-stack"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">ACCESS CONTROL</p><h2>Employee memberships</h2><p className="muted">Employee accounts are invitation only. Division roles control what each employee can read and change.</p></div></div>{error && <p className="inline-message">{error}</p>}<div className="table-wrap"><table><thead><tr><th>Employee</th><th>Division</th><th>Role</th><th>Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.user_id + row.division_id}><td><strong>{profiles[row.user_id] || row.user_id}</strong></td><td>{row.division_id}</td><td>{row.role.replaceAll("_"," ")}</td><td><span className={row.active ? "pill active" : "pill inactive"}>{row.active ? "Active" : "Inactive"}</span></td></tr>)}</tbody></table></div><p className="fine-print">Employee invitations and role changes are reserved for a later admin workflow. No one can self assign a role.</p></section></div>;
}

export default App;