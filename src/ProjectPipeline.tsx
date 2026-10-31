import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";

type Division = "TRD" | "CRD";
type Property = { id: string; customer_id: string; address_line1: string; city: string; state: string };
type Project = {
  id: string; project_name: string; project_type: string | null; pipeline_type: "retail" | "insurance" | null;
  workflow_stage: string | null; status: string; property_id: string; customer_id: string;
  contract_amount: number | null; original_estimate_amount: number | null; initial_approved_amount: number | null;
  supplements_approved_amount: number; invoiced_amount: number; collected_amount: number;
  next_action: string | null; next_action_due_at: string | null; created_at: string;
};
type Expense = { id: string; category: string; amount: number; paid_amount: number; payment_status: string; expense_date: string; vendor_payee: string | null; description: string | null };
type Supplement = { id: string; supplement_number: number; status: string; requested_amount: number; approved_amount: number; submitted_at: string | null; carrier_response: string | null };

const retailStages = [
  "new_lead", "contacted", "inspection_scheduled", "inspection_completed", "estimate_prepared",
  "bid_issued", "awaiting_customer", "contract_signed", "deposit_received", "materials_ordered",
  "materials_received", "scheduled", "in_progress", "final_inspection", "invoiced", "closed"
];
const insuranceStages = [
  "new_lead", "contacted", "inspection_scheduled", "inspection_completed", "scope_prepared",
  "claim_filed", "adjuster_meeting", "awaiting_carrier", "supplement_review", "contract_signed",
  "materials_ordered", "materials_received", "scheduled", "in_progress", "final_inspection",
  "invoiced", "closed"
];
const stageLabel = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
const money = (value: number | null | undefined) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
const cents = (value: string) => Math.round((Number(value) || 0) * 100) / 100;

export default function ProjectPipeline({ division, userId, canWrite }: { division: Division; userId: string; canWrite: boolean }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Project | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [supplements, setSupplements] = useState<Supplement[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [showSupplement, setShowSupplement] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectType, setProjectType] = useState("roof_replacement");
  const [pipelineType, setPipelineType] = useState<"retail" | "insurance">("retail");
  const [propertyId, setPropertyId] = useState("");
  const [stage, setStage] = useState("new_lead");
  const [contract, setContract] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [nextDue, setNextDue] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("materials");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().slice(0, 10));
  const [vendor, setVendor] = useState("");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [supplementAmount, setSupplementAmount] = useState("");
  const [supplementStatus, setSupplementStatus] = useState("draft");
  const [supplementNotes, setSupplementNotes] = useState("");
  const [filter, setFilter] = useState<"all" | "retail" | "insurance">("all");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    setError(""); setBusy(true);
    const [projectResult, linkResult] = await Promise.all([
      supabase.from("crm_projects").select("id,project_name,project_type,pipeline_type,workflow_stage,status,property_id,customer_id,contract_amount,original_estimate_amount,initial_approved_amount,supplements_approved_amount,invoiced_amount,collected_amount,next_action,next_action_due_at,created_at").eq("division_id", division).order("created_at", { ascending: false }),
      supabase.from("crm_customer_divisions").select("customer_id").eq("division_id", division)
    ]);
    if (projectResult.error) setError(projectResult.error.message);
    setProjects((projectResult.data ?? []) as Project[]);
    const ids = (linkResult.data ?? []).map((x: { customer_id: string }) => x.customer_id);
    if (ids.length) {
      const [p, c] = await Promise.all([
        supabase.from("crm_properties").select("id,customer_id,address_line1,city,state").in("customer_id", ids).order("address_line1"),
        supabase.from("crm_customers").select("id,display_name").in("id", ids)
      ]);
      setProperties((p.data ?? []) as Property[]);
      const names: Record<string, string> = {};
      (c.data ?? []).forEach((x: any) => { names[x.id] = x.display_name; });
      setCustomerNames(names);
      if (!propertyId && p.data?.length) setPropertyId(p.data[0].id);
    } else { setProperties([]); setCustomerNames({}); }
    setBusy(false);
  }, [division, propertyId]);

  useEffect(() => { void load(); }, [load]);

  async function openProject(project: Project) {
    setSelected(project); setMessage(""); setError("");
    if (!supabase) return;
    const [e, s, h] = await Promise.all([
      supabase.from("crm_project_expenses").select("id,category,amount,paid_amount,payment_status,expense_date,vendor_payee,description").eq("project_id", project.id).order("expense_date", { ascending: false }),
      supabase.from("crm_project_supplements").select("id,supplement_number,status,requested_amount,approved_amount,submitted_at,carrier_response").eq("project_id", project.id).order("supplement_number"),
      supabase.from("crm_project_stage_history").select("id,from_stage,to_stage,changed_at,note").eq("project_id", project.id).order("changed_at", { ascending: false }).limit(30)
    ]);
    if (e.error) setError(e.error.message);
    if (s.error) setError(s.error.message);
    if (h.error) setError(h.error.message);
    setExpenses((e.data ?? []) as Expense[]);
    setSupplements((s.data ?? []) as Supplement[]);
    setHistory(h.data ?? []);
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const property = properties.find(p => p.id === propertyId);
    if (!property) { setError("Select a property linked to this division."); return; }
    setBusy(true); setError("");
    const { error: insertError } = await supabase.from("crm_projects").insert({
      division_id: division, customer_id: property.customer_id, property_id: property.id,
      project_name: projectName.trim(), project_type: projectType, pipeline_type: pipelineType,
      workflow_stage: stage, status: "planning", contract_amount: contract ? cents(contract) : null,
      original_estimate_amount: contract ? cents(contract) : null,
      created_by: userId
    });
    if (insertError) setError(insertError.message);
    else { setShowCreate(false); setProjectName(""); setContract(""); setMessage("Project created."); await load(); }
    setBusy(false);
  }

  async function moveProject(project: Project, nextStage: string) {
    if (!supabase || !canWrite || nextStage === (project.workflow_stage || "new_lead")) return;
    setBusy(true); setError("");
    const previous = project.workflow_stage || null;
    const { error: historyError } = await supabase.from("crm_project_stage_history").insert({
      division_id: division, project_id: project.id, from_stage: previous, to_stage: nextStage, changed_by: userId
    });
    if (historyError) { setError(historyError.message); setBusy(false); return; }
    const { error: updateError } = await supabase.from("crm_projects").update({ workflow_stage: nextStage, updated_at: new Date().toISOString() }).eq("id", project.id).eq("division_id", division);
    if (updateError) setError(updateError.message);
    else { setMessage("Project stage updated."); await load(); if (selected?.id === project.id) await openProject({ ...project, workflow_stage: nextStage }); }
    setBusy(false);
  }

  async function addExpense(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !selected) return;
    setBusy(true); setError("");
    const { error: insertError } = await supabase.from("crm_project_expenses").insert({
      division_id: division, project_id: selected.id, category: expenseCategory,
      amount: cents(expenseAmount), paid_amount: 0, payment_status: "unpaid",
      expense_date: expenseDate, vendor_payee: vendor.trim() || null,
      description: expenseDescription.trim() || null, entered_by: userId
    });
    if (insertError) setError(insertError.message);
    else { setShowExpense(false); setExpenseAmount(""); setVendor(""); setExpenseDescription(""); await openProject(selected); }
    setBusy(false);
  }

  async function addSupplement(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !selected || selected.pipeline_type !== "insurance") return;
    setBusy(true); setError("");
    const nextNumber = Math.max(0, ...supplements.map(s => s.supplement_number)) + 1;
    const { error: insertError } = await supabase.from("crm_project_supplements").insert({
      division_id: division, project_id: selected.id, supplement_number: nextNumber,
      requested_amount: cents(supplementAmount), status: supplementStatus,
      notes: supplementNotes.trim() || null, created_by: userId
    });
    if (insertError) setError(insertError.message);
    else { setShowSupplement(false); setSupplementAmount(""); setSupplementNotes(""); await openProject(selected); }
    setBusy(false);
  }

  const filtered = useMemo(() => projects.filter(p => filter === "all" || p.pipeline_type === filter), [projects, filter]);
  const totalExpenses = expenses.reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0) / 100;
  const directExpenses = expenses.filter(x => x.category !== "overhead" && x.category !== "sales_commission").reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0) / 100;
  const contractValue = Number(selected?.contract_amount || selected?.initial_approved_amount || 0) + Number(selected?.supplements_approved_amount || 0);
  const gross = contractValue - directExpenses;
  const addressFor = (id: string) => { const p = properties.find(x => x.id === id); return p ? [p.address_line1,p.city,p.state].filter(Boolean).join(", ") : "Property"; };

  return <div className="content-stack project-pipeline">
    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">{division} PROJECT OPERATIONS</p><h2>Project pipeline</h2><p className="muted">Track each job from lead through completion. Customers and properties remain in the existing CRM records.</p></div><div className="panel-actions"><span className="record-count">{filtered.length} projects</span>{canWrite && <button className="primary-button compact" onClick={() => setShowCreate(v => !v)}>+ New project</button>}</div></div>
      <div className="pipeline-toolbar"><div className="segmented-filter"><button className={filter==="all"?"active":""} onClick={()=>setFilter("all")}>All</button><button className={filter==="retail"?"active":""} onClick={()=>setFilter("retail")}>Retail</button><button className={filter==="insurance"?"active":""} onClick={()=>setFilter("insurance")}>Insurance</button></div></div>
      {showCreate && <form className="inline-form" onSubmit={createProject}><div className="form-grid">
        <label>Project name<input required value={projectName} onChange={e=>setProjectName(e.target.value)} placeholder="Customer or property project name" /></label>
        <label>Project category<select value={projectType} onChange={e=>setProjectType(e.target.value)}><option value="roof_replacement">Roof replacement</option><option value="repair">Repair</option><option value="restoration">Restoration</option><option value="coating">Roof coating</option><option value="maintenance">Maintenance</option><option value="other">Other</option></select></label>
        <label>Workflow<select value={pipelineType} onChange={e=>{const v=e.target.value as "retail"|"insurance";setPipelineType(v);setStage("new_lead");}}><option value="retail">Retail</option><option value="insurance">Insurance</option></select></label>
        <label>Starting stage<select value={stage} onChange={e=>setStage(e.target.value)}>{(pipelineType==="retail"?retailStages:insuranceStages).map(x=><option key={x} value={x}>{stageLabel(x)}</option>)}</select></label>
        <label className="wide">Property<select required value={propertyId} onChange={e=>setPropertyId(e.target.value)}><option value="">Select property</option>{properties.map(p=><option key={p.id} value={p.id}>{p.address_line1}, {p.city}, {p.state} · {customerNames[p.customer_id] || "Customer"}</option>)}</select></label>
        <label>Initial estimate ($)<input type="number" min="0" step="0.01" value={contract} onChange={e=>setContract(e.target.value)} /></label>
      </div><button className="primary-button" disabled={busy || !properties.length}>Create project</button></form>}
      {message && <p className="inline-message">{message}</p>}
      {error && <p className="inline-message error-text">{error}</p>}
      {busy && <p className="muted">Working...</p>}
      {busy && !projects.length ? <div className="empty-state">Loading projects...</div> : filtered.length ? <div className="pipeline-grid">{filtered.map(project => {
        const stages = project.pipeline_type === "insurance" ? insuranceStages : retailStages;
        return <article className="pipeline-card" key={project.id}>
          <button className="pipeline-card-main" onClick={()=>void openProject(project)}>
            <span className="pipeline-card-type">{project.pipeline_type ? stageLabel(project.pipeline_type) : "Workflow not assigned"}</span>
            <strong>{project.project_name}</strong><span className="muted">{addressFor(project.property_id)}</span>
            <span className="pipeline-card-stage">{stageLabel(project.workflow_stage || project.status || "planning")}</span>
            <span className="pipeline-card-value">{money(project.contract_amount || project.original_estimate_amount)}</span>
            {project.next_action && <span className="muted">Next: {project.next_action}</span>}
            {project.next_action_due_at && <span className="muted">Due {new Date(project.next_action_due_at).toLocaleDateString()}</span>}
          </button>
          {canWrite && <label className="stage-quick-edit">Move to<select value={project.workflow_stage || stages[0]} onChange={e=>void moveProject(project,e.target.value)} disabled={busy}>{stages.map(s=><option key={s} value={s}>{stageLabel(s)}</option>)}</select></label>}
        </article>;
      })}</div> : <div className="empty-state"><strong>No projects in this view</strong><span>Create a project using an existing customer property.</span></div>}
    </section>

    {selected && <section className="panel project-detail">
      <div className="panel-heading"><div><p className="eyebrow">PROJECT DETAIL</p><h2>{selected.project_name}</h2><p className="muted">{addressFor(selected.property_id)} · {customerNames[selected.customer_id] || "Customer"}</p></div><button className="secondary-button compact" onClick={()=>setSelected(null)}>Close</button></div>
      <div className="financial-summary">
        <div><span>Contract / approved value</span><strong>{money(contractValue)}</strong></div>
        <div><span>Invoiced</span><strong>{money(selected.invoiced_amount)}</strong></div>
        <div><span>Collected</span><strong>{money(selected.collected_amount)}</strong></div>
        <div><span>Recorded expenses</span><strong>{money(totalExpenses)}</strong></div>
        <div><span>Direct costs</span><strong>{money(directExpenses)}</strong></div>
        <div><span>Preliminary gross profit</span><strong>{money(gross)}</strong></div>
      </div>
      <div className="panel-heading subheading"><div><h3>Job costs</h3><p className="muted">Record actual expenses. Ordered materials are not counted until an expense is entered.</p></div>{canWrite&&<button className="primary-button compact" onClick={()=>setShowExpense(v=>!v)}>+ Add expense</button>}</div>
      {showExpense&&<form className="inline-form" onSubmit={addExpense}><div className="form-grid"><label>Category<select value={expenseCategory} onChange={e=>setExpenseCategory(e.target.value)}><option value="materials">Materials</option><option value="labor">Labor</option><option value="equipment">Equipment</option><option value="permits">Permits</option><option value="sales_commission">Sales commission</option><option value="overhead">Overhead allocation</option><option value="other">Other</option></select></label><label>Amount ($)<input type="number" min="0.01" step="0.01" required value={expenseAmount} onChange={e=>setExpenseAmount(e.target.value)} /></label><label>Date<input type="date" required value={expenseDate} onChange={e=>setExpenseDate(e.target.value)} /></label><label>Vendor / payee<input value={vendor} onChange={e=>setVendor(e.target.value)} /></label><label className="wide">Description<input value={expenseDescription} onChange={e=>setExpenseDescription(e.target.value)} /></label></div><button className="primary-button" disabled={busy}>Save expense</button></form>}
      {expenses.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Vendor</th><th>Description</th><th>Amount</th><th>Payment</th></tr></thead><tbody>{expenses.map(x=><tr key={x.id}><td>{new Date(x.expense_date+"T12:00:00").toLocaleDateString()}</td><td>{stageLabel(x.category)}</td><td>{x.vendor_payee||"—"}</td><td>{x.description||"—"}</td><td>{money(x.amount)}</td><td>{stageLabel(x.payment_status)}</td></tr>)}</tbody></table></div>:<div className="empty-state">No expenses recorded for this project.</div>}
      {selected.pipeline_type==="insurance" && <><div className="panel-heading subheading"><div><h3>Supplements</h3><p className="muted">Each submission is tracked separately with its own response history.</p></div>{canWrite&&<button className="primary-button compact" onClick={()=>setShowSupplement(v=>!v)}>+ Add supplement</button>}</div>
        {showSupplement&&<form className="inline-form" onSubmit={addSupplement}><div className="form-grid"><label>Requested amount ($)<input type="number" min="0" step="0.01" required value={supplementAmount} onChange={e=>setSupplementAmount(e.target.value)} /></label><label>Status<select value={supplementStatus} onChange={e=>setSupplementStatus(e.target.value)}><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="under_review">Under review</option><option value="approved">Approved</option><option value="partially_approved">Partially approved</option><option value="denied">Denied</option><option value="resubmitted">Resubmitted</option></select></label><label className="wide">Notes<textarea rows={2} value={supplementNotes} onChange={e=>setSupplementNotes(e.target.value)} /></label></div><button className="primary-button" disabled={busy}>Save supplement</button></form>}
        {supplements.length?<div className="table-wrap"><table><thead><tr><th>#</th><th>Status</th><th>Requested</th><th>Approved</th><th>Submitted</th></tr></thead><tbody>{supplements.map(s=><tr key={s.id}><td>{s.supplement_number}</td><td>{stageLabel(s.status)}</td><td>{money(s.requested_amount)}</td><td>{money(s.approved_amount)}</td><td>{s.submitted_at?new Date(s.submitted_at).toLocaleDateString():"—"}</td></tr>)}</tbody></table></div>:<div className="empty-state">No supplements recorded.</div>}</>}
      <div className="panel-heading subheading"><div><h3>Stage history</h3></div></div>
      {history.length?<div className="history-list">{history.map(item=><div key={item.id}><strong>{stageLabel(item.from_stage||"Project created")} → {stageLabel(item.to_stage)}</strong><span>{new Date(item.changed_at).toLocaleString()}</span>{item.note&&<p>{item.note}</p>}</div>)}</div>:<div className="empty-state">No stage changes recorded yet.</div>}
    </section>}
  </div>;
}
