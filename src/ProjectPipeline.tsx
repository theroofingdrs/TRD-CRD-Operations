import { DragEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./lib/supabase";

type Division = "TRD" | "CRD";
type Property = { id: string; customer_id: string; address_line1: string; city: string; state: string };
type Project = {
  id: string; division_id: Division; project_manager_id: string | null; project_name: string; project_type: string | null; pipeline_type: "retail" | "insurance" | null;
  workflow_stage: string | null; status: string; property_id: string; customer_id: string;
  contract_amount: number | null; original_estimate_amount: number | null; initial_approved_amount: number | null;
  supplements_approved_amount: number; invoiced_amount: number; collected_amount: number;
  next_action: string | null; next_action_due_at: string | null; updated_at: string; commission_method: string | null; commission_rate: number | null; commission_fixed_amount: number | null; commission_earned_amount: number; commission_paid_amount: number; commission_salesperson_name: string | null; overhead_method: string | null; overhead_rate: number | null; overhead_fixed_amount: number | null; overhead_allocated_amount: number; created_at: string;
};
type Expense = { id: string; category: string; amount: number; paid_amount: number; payment_status: string; expense_date: string; vendor_payee: string | null; description: string | null; receipt_file_id: string | null };
type AuditEvent = { id: string; kind: string; changed_at: string; before_values: Record<string, unknown>; after_values: Record<string, unknown> };
type Attachment = { id: string; related_id: string; bucket_id: string; object_path: string; original_filename: string };
type Transaction = { id: string; transaction_type: "invoice" | "payment"; amount: number; transaction_date: string; reference_number: string | null; payment_method: string | null; notes: string | null; status: string };
type Supplement = { id: string; supplement_number: number; status: string; requested_amount: number; approved_amount: number; submitted_at: string | null; response_at: string | null; carrier_response: string | null; notes: string | null };

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

export default function ProjectPipeline({ division, userId, canWrite, canWriteFinancials, availableDivisions }: { division: Division; userId: string; canWrite: boolean; canWriteFinancials: boolean; availableDivisions: Division[] }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [customerNames, setCustomerNames] = useState<Record<string, string>>({});
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Project | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [supplements, setSupplements] = useState<Supplement[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [supplementAttachments, setSupplementAttachments] = useState<Record<string, Attachment[]>>({});
  const [costEstimates, setCostEstimates] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<any[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [showSupplement, setShowSupplement] = useState(false);
  const [divisionExpenseTotal, setDivisionExpenseTotal] = useState(0);
  const [monthlyCollected, setMonthlyCollected] = useState(0);
  const [staleDays, setStaleDays] = useState(7);
  const [stageLastChanged, setStageLastChanged] = useState<Record<string, string>>({});
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
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [supplementFile, setSupplementFile] = useState<File | null>(null);
  const [supplementEditing, setSupplementEditing] = useState<string | null>(null);
  const [supplementApproved, setSupplementApproved] = useState("");
  const [supplementResponse, setSupplementResponse] = useState("");
  const [supplementResponseDate, setSupplementResponseDate] = useState("");
  const [supplementStatusEdit, setSupplementStatusEdit] = useState("under_review");
  const [financeContract, setFinanceContract] = useState("");
  const [financeApproved, setFinanceApproved] = useState("");
  const [transactionType, setTransactionType] = useState<"invoice" | "payment">("invoice");
  const [transactionAmount, setTransactionAmount] = useState("");
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().slice(0,10));
  const [transactionReference, setTransactionReference] = useState("");
  const [transactionMethod, setTransactionMethod] = useState("");
  const [transactionNotes, setTransactionNotes] = useState("");

  const [commissionMethod, setCommissionMethod] = useState("manual");
  const [commissionRate, setCommissionRate] = useState("");
  const [commissionFixed, setCommissionFixed] = useState("");
  const [commissionEarned, setCommissionEarned] = useState("");
  const [commissionPaid, setCommissionPaid] = useState("");
  const [commissionSalesperson, setCommissionSalesperson] = useState("");
  const [overheadMethod, setOverheadMethod] = useState("manual");
  const [overheadRate, setOverheadRate] = useState("");
  const [overheadFixed, setOverheadFixed] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [supplementAmount, setSupplementAmount] = useState("");
  const [supplementStatus, setSupplementStatus] = useState("draft");
  const [supplementNotes, setSupplementNotes] = useState("");
  const [filter, setFilter] = useState<"all" | "retail" | "insurance">("all");
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [scope, setScope] = useState<"division" | "combined">("division");
  const availableDivisionKey = availableDivisions.join("|");
  const visibleDivisions = useMemo(() => scope === "combined" ? availableDivisions : [division], [scope, division, availableDivisionKey]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    setError(""); setBusy(true);
    const [projectResult, linkResult, expenseResult, settingsResult, transactionResult] = await Promise.all([
      supabase.from("crm_projects").select("id,division_id,project_manager_id,project_name,project_type,pipeline_type,workflow_stage,status,property_id,customer_id,contract_amount,original_estimate_amount,initial_approved_amount,supplements_approved_amount,invoiced_amount,collected_amount,next_action,next_action_due_at,commission_method,commission_rate,commission_fixed_amount,commission_earned_amount,commission_paid_amount,commission_salesperson_name,overhead_method,overhead_rate,overhead_fixed_amount,overhead_allocated_amount,created_at,updated_at").in("division_id", visibleDivisions).order("created_at", { ascending: false }),
      supabase.from("crm_customer_divisions").select("customer_id").in("division_id", visibleDivisions),
      supabase.from("crm_project_expenses").select("amount,category").in("division_id", visibleDivisions),
      supabase.from("crm_division_financial_settings").select("stale_stage_days").eq("division_id", division).maybeSingle(),
      supabase.from("crm_project_transactions").select("amount,transaction_date").in("division_id", visibleDivisions).eq("transaction_type", "payment").eq("status", "recorded").gte("transaction_date", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10))
    ]);
    if (projectResult.error) setError(projectResult.error.message);
    setProjects((projectResult.data ?? []) as Project[]);
    if (expenseResult.error) setError(expenseResult.error.message);
    setDivisionExpenseTotal((expenseResult.data ?? []).reduce((sum: number, item: { amount: number }) => sum + Math.round(Number(item.amount || 0) * 100), 0) / 100);
    setMonthlyCollected((transactionResult.data ?? []).reduce((sum: number, item: { amount: number }) => sum + Math.round(Number(item.amount || 0) * 100), 0) / 100);
    if (settingsResult.data?.stale_stage_days) setStaleDays(settingsResult.data.stale_stage_days);
    const projectIds = (projectResult.data ?? []).map((p: any) => p.id);
    if (projectIds.length) {
      const { data: stageRows, error: stageError } = await supabase.from("crm_project_stage_history").select("project_id,changed_at").in("project_id", projectIds).order("changed_at", { ascending: false });
      if (stageError) setError(stageError.message);
      const latest: Record<string, string> = {};
      (stageRows ?? []).forEach((row: { project_id: string; changed_at: string }) => { if (!latest[row.project_id]) latest[row.project_id] = row.changed_at; });
      setStageLastChanged(latest);
    } else setStageLastChanged({});
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
      const managerIds = [...new Set((projectResult.data ?? []).map((project: any) => project.project_manager_id).filter(Boolean))] as string[];
      if (managerIds.length) {
        const { data: profiles } = await supabase.from("crm_profiles").select("user_id,display_name").in("user_id", managerIds);
        const staff: Record<string,string> = {};
        (profiles ?? []).forEach((profile: {user_id:string;display_name:string}) => { staff[profile.user_id] = profile.display_name; });
        setStaffNames(staff);
      } else setStaffNames({});
      if (!propertyId && p.data?.length) setPropertyId(p.data[0].id);
    } else { setProperties([]); setCustomerNames({}); setStaffNames({}); }
    setBusy(false);
  }, [division, propertyId, visibleDivisions]);

  useEffect(() => { void load(); }, [load]);

  async function openProject(project: Project) {
    setSelected(project); setMessage(""); setError("");
    setFinanceContract(String(project.contract_amount ?? ""));
    setFinanceApproved(String(project.initial_approved_amount ?? ""));
    setCommissionMethod(project.commission_method || "manual");
    setCommissionRate(String(project.commission_rate ?? ""));
    setCommissionFixed(String(project.commission_fixed_amount ?? ""));
    setCommissionEarned(String(project.commission_earned_amount ?? ""));
    setCommissionPaid(String(project.commission_paid_amount ?? ""));
    setCommissionSalesperson(project.commission_salesperson_name || "");
    setOverheadMethod(project.overhead_method || "manual");
    setOverheadRate(String(project.overhead_rate ?? ""));
    setOverheadFixed(String(project.overhead_fixed_amount ?? ""));
    if (!supabase) return;
    const [e, s, h, t, fh, eh, sh, th] = await Promise.all([
      supabase.from("crm_project_expenses").select("id,category,amount,paid_amount,payment_status,expense_date,vendor_payee,description,receipt_file_id").eq("project_id", project.id).order("expense_date", { ascending: false }),
      supabase.from("crm_project_supplements").select("id,supplement_number,status,requested_amount,approved_amount,submitted_at,response_at,carrier_response,notes").eq("project_id", project.id).order("supplement_number"),
      supabase.from("crm_project_stage_history").select("id,from_stage,to_stage,changed_at,note").eq("project_id", project.id).order("changed_at", { ascending: false }).limit(30),
      supabase.from("crm_project_transactions").select("id,transaction_type,amount,transaction_date,reference_number,payment_method,notes,status").eq("project_id", project.id).order("transaction_date", { ascending: false }),
      supabase.from("crm_project_financial_history").select("id,changed_at,before_values,after_values").eq("project_id", project.id).order("changed_at", { ascending: false }).limit(20),
      supabase.from("crm_project_expense_history").select("id,changed_at,before_values,after_values").eq("project_id", project.id).order("changed_at", { ascending: false }).limit(20),
      supabase.from("crm_project_supplement_history").select("id,changed_at,before_values,after_values").eq("project_id", project.id).order("changed_at", { ascending: false }).limit(20),
      supabase.from("crm_project_transaction_history").select("id,changed_at,before_values,after_values").eq("project_id", project.id).order("changed_at", { ascending: false }).limit(20)
    ]);
    for (const result of [e,s,h,t,fh,eh,sh,th]) if (result.error) setError(result.error.message);
    setExpenses((e.data ?? []) as Expense[]);
    setSupplements((s.data ?? []) as Supplement[]);
    setTransactions((t.data ?? []) as Transaction[]);
    setHistory(h.data ?? []);
    const audit: AuditEvent[] = [
      ...(fh.data ?? []).map((x: any) => ({ ...x, kind: "Financial change" })),
      ...(eh.data ?? []).map((x: any) => ({ ...x, kind: "Expense change" })),
      ...(sh.data ?? []).map((x: any) => ({ ...x, kind: "Supplement change" })),
      ...(th.data ?? []).map((x: any) => ({ ...x, kind: "Invoice or payment change" }))
    ].sort((a,b)=>new Date(b.changed_at).getTime()-new Date(a.changed_at).getTime());
    setAuditEvents(audit);
    const supplementIds = (s.data ?? []).map((item: Supplement) => item.id);
    if (supplementIds.length) {
      const { data: files, error: fileError } = await supabase.from("crm_files").select("id,related_id,bucket_id,object_path,original_filename").eq("division_id", project.division_id).eq("related_type", "supplement").in("related_id", supplementIds);
      if (fileError) setError(fileError.message);
      const grouped: Record<string, Attachment[]> = {};
      (files ?? []).forEach((file: Attachment) => { (grouped[file.related_id] ||= []).push(file); });
      setSupplementAttachments(grouped);
    } else setSupplementAttachments({});
    const { data: budgets, error: budgetError } = await supabase.from("crm_project_cost_estimates").select("category,estimated_amount").eq("project_id", project.id);
    if (budgetError) setError(budgetError.message);
    const budgetMap: Record<string, number> = {};
    (budgets ?? []).forEach((item: {category:string;estimated_amount:number}) => { budgetMap[item.category] = Number(item.estimated_amount || 0); });
    setCostEstimates(budgetMap);
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
      workflow_stage: stage, status: "planning", contract_amount: null,
      original_estimate_amount: contract ? cents(contract) : null,
      next_action: nextAction.trim() || null,
      next_action_due_at: nextDue ? new Date(nextDue).toISOString() : null,
      created_by: userId
    });
    if (insertError) setError(insertError.message);
    else { setShowCreate(false); setProjectName(""); setContract(""); setNextAction(""); setNextDue(""); setMessage("Project created."); await load(); }
    setBusy(false);
  }

  async function assignWorkflow(project: Project, value: "retail" | "insurance") {
    if (!supabase || !canWrite) return;
    setBusy(true); setError("");
    const { error: updateError } = await supabase.from("crm_projects").update({
      pipeline_type: value, workflow_stage: "new_lead", updated_at: new Date().toISOString()
    }).eq("id", project.id).eq("division_id", project.division_id);
    if (updateError) setError(updateError.message);
    else { setMessage("Project workflow assigned."); await load(); }
    setBusy(false);
  }

  async function moveProject(project: Project, nextStage: string) {
    if (!supabase || !canWrite || !project.pipeline_type || nextStage === (project.workflow_stage || "new_lead")) return;
    setBusy(true); setError("");
    const { error: updateError } = await supabase.from("crm_projects").update({ workflow_stage: nextStage, updated_at: new Date().toISOString() }).eq("id", project.id).eq("division_id", project.division_id);
    if (updateError) setError(updateError.message);
    else { setMessage("Project stage updated."); await load(); if (selected?.id === project.id) await openProject({ ...project, workflow_stage: nextStage }); }
    setBusy(false);
  }

  async function addExpense(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !canWriteFinancials || !selected) return;
    setBusy(true); setError("");
    if (receiptFile && (!["image/jpeg","image/png","image/webp","application/pdf"].includes(receiptFile.type) || receiptFile.size > 15 * 1024 * 1024)) {
      setError("Receipt must be JPG, PNG, WebP, or PDF and no larger than 15 MB."); setBusy(false); return;
    }
    const amount = cents(expenseAmount);
    const duplicate = expenses.some(x => x.category === expenseCategory && Math.round(Number(x.amount)*100) === Math.round(amount*100) && x.expense_date === expenseDate && (x.vendor_payee || "").trim().toLowerCase() === vendor.trim().toLowerCase());
    if (duplicate && !window.confirm("A similar expense already exists for this project. Add another anyway?")) { setBusy(false); return; }
    const { data: expenseRow, error: insertError } = await supabase.from("crm_project_expenses").insert({
      division_id: selected.division_id, project_id: selected.id, category: expenseCategory,
      amount, paid_amount: 0, payment_status: "unpaid", expense_date: expenseDate,
      vendor_payee: vendor.trim() || null, description: expenseDescription.trim() || null, entered_by: userId
    }).select("id").single();
    if (insertError) setError(insertError.message);
    else {
      if (receiptFile) {
        const safeName = receiptFile.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "receipt";
        const path = selected.division_id + "/" + selected.id + "/" + crypto.randomUUID() + "-" + safeName;
        const { error: uploadError } = await supabase.storage.from("roof-doctors-private").upload(path, receiptFile, { contentType: receiptFile.type, upsert: false });
        if (uploadError) setError("Expense saved, but receipt upload failed: " + uploadError.message);
        else {
          const { data: fileRow, error: fileError } = await supabase.from("crm_files").insert({
            division_id: selected.division_id, related_type: "project", related_id: selected.id,
            bucket_id: "roof-doctors-private", object_path: path, original_filename: receiptFile.name,
            content_type: receiptFile.type, file_size_bytes: receiptFile.size, uploaded_by: userId,
            metadata: { document_category: "expense_receipt", expense_id: expenseRow.id }
          }).select("id").single();
          if (fileError) {
            await supabase.storage.from("roof-doctors-private").remove([path]);
            setError("Expense saved, but receipt registration failed: " + fileError.message);
          } else {
            const { error: linkError } = await supabase.from("crm_project_expenses").update({ receipt_file_id: fileRow.id }).eq("id", expenseRow.id).eq("division_id", division);
            if (linkError) setError("Expense saved, but receipt linking failed: " + linkError.message);
          }
        }
      }
      setShowExpense(false); setExpenseAmount(""); setVendor(""); setExpenseDescription(""); setReceiptFile(null);
      await openProject(selected);
    }
    setBusy(false);
  }

  async function openReceipt(expense: Expense) {
    if (!supabase || !expense.receipt_file_id) return;
    const { data: fileRow, error: fileError } = await supabase.from("crm_files").select("bucket_id,object_path").eq("id", expense.receipt_file_id).single();
    if (fileError || !fileRow) { setError(fileError?.message || "Receipt not found."); return; }
    const { data, error: signedError } = await supabase.storage.from(fileRow.bucket_id).createSignedUrl(fileRow.object_path, 60);
    if (signedError) setError(signedError.message);
    else if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function addSupplement(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !selected || selected.pipeline_type !== "insurance" || !canWrite) return;
    setBusy(true); setError("");
    if (supplementFile && (!["image/jpeg","image/png","image/webp","application/pdf"].includes(supplementFile.type) || supplementFile.size > 15 * 1024 * 1024)) {
      setError("Supplement attachment must be JPG, PNG, WebP, or PDF and no larger than 15 MB."); setBusy(false); return;
    }
    const nextNumber = Math.max(0, ...supplements.map(s => s.supplement_number)) + 1;
    const { data: supplementRow, error: insertError } = await supabase.from("crm_project_supplements").insert({
      division_id: selected.division_id, project_id: selected.id, supplement_number: nextNumber,
      requested_amount: cents(supplementAmount), status: supplementStatus,
      submitted_at: ["submitted","resubmitted","under_review"].includes(supplementStatus) ? new Date().toISOString() : null,
      notes: supplementNotes.trim() || null, created_by: userId
    }).select("id").single();
    if (insertError) setError(insertError.message);
    else {
      if (supplementFile) {
        const safeName = supplementFile.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "supplement";
        const path = division + "/" + selected.id + "/" + crypto.randomUUID() + "-" + safeName;
        const { error: uploadError } = await supabase.storage.from("roof-doctors-private").upload(path, supplementFile, { contentType: supplementFile.type, upsert: false });
        if (uploadError) setError("Supplement saved, but attachment upload failed: " + uploadError.message);
        else {
          const { error: fileError } = await supabase.from("crm_files").insert({
            division_id: selected.division_id, related_type: "supplement", related_id: supplementRow.id,
            bucket_id: "roof-doctors-private", object_path: path, original_filename: supplementFile.name,
            content_type: supplementFile.type, file_size_bytes: supplementFile.size, uploaded_by: userId,
            metadata: { document_category: "supplement_attachment", project_id: selected.id }
          });
          if (fileError) {
            await supabase.storage.from("roof-doctors-private").remove([path]);
            setError("Supplement saved, but attachment registration failed: " + fileError.message);
          }
        }
      }
      setShowSupplement(false); setSupplementAmount(""); setSupplementNotes(""); setSupplementFile(null); await openProject(selected);
    }
    setBusy(false);
  }

  async function updateExpense(expense: Expense, changes: Partial<Expense>) {
    if (!supabase || !canWriteFinancials || !selected) return;
    setBusy(true); setError("");
    const nextStatus = changes.payment_status ?? expense.payment_status;
    const nextPaid = changes.paid_amount ?? (nextStatus === "paid" ? expense.amount : nextStatus === "unpaid" ? 0 : expense.paid_amount);
    if (nextPaid > expense.amount) { setError("Paid amount cannot exceed the expense amount."); setBusy(false); return; }
    const { error: updateError } = await supabase.from("crm_project_expenses").update({ ...changes, paid_amount: nextPaid, payment_status: nextStatus, updated_at: new Date().toISOString() }).eq("id", expense.id).eq("division_id", selected.division_id);
    if (updateError) setError(updateError.message);
    else await openProject(selected);
    setBusy(false);
  }

  async function updateSupplement(supplement: Supplement, changes: Partial<Supplement>) {
    if (!supabase || !canWrite || !selected) return;
    setBusy(true); setError("");
    const { error: updateError } = await supabase.from("crm_project_supplements").update({
      ...changes,
      submitted_at: changes.status && ["submitted","resubmitted","under_review"].includes(changes.status) ? new Date().toISOString() : supplement.submitted_at,
      status: changes.status ?? supplementStatusEdit,
      response_at: changes.status && ["approved","partially_approved","denied"].includes(changes.status) || ["approved","partially_approved","denied"].includes(supplementStatusEdit) ? (supplementResponseDate ? new Date(supplementResponseDate).toISOString() : new Date().toISOString()) : supplement.response_at,
      carrier_response: supplementResponse.trim() || supplement.carrier_response,
      updated_at: new Date().toISOString()
    }).eq("id", supplement.id).eq("division_id", selected.division_id);
    if (updateError) setError(updateError.message);
    else {
      setSupplementEditing(null); setSupplementApproved(""); setSupplementResponse(""); setSupplementResponseDate("");
      await load();
      const { data: fresh } = await supabase.from("crm_projects").select("*").eq("id", selected.id).single();
      await openProject((fresh || selected) as Project);
    }
    setBusy(false);
  }

  async function openSupplementAttachment(file: Attachment) {
    if (!supabase) return;
    const { data, error: signedError } = await supabase.storage.from(file.bucket_id).createSignedUrl(file.object_path, 60);
    if (signedError) setError(signedError.message);
    else if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function saveCostEstimate(category: string, value: string) {
    if (!supabase || !selected || !canWriteFinancials) return;
    const amount = cents(value);
    setBusy(true); setError("");
    const { error: saveError } = await supabase.from("crm_project_cost_estimates").upsert({
      division_id: selected.division_id, project_id: selected.id, category, estimated_amount: amount,
      updated_by: userId, updated_at: new Date().toISOString()
    }, { onConflict: "project_id,category" });
    if (saveError) setError(saveError.message);
    else { setCostEstimates(current => ({ ...current, [category]: amount })); setMessage("Cost estimate saved."); }
    setBusy(false);
  }

  async function addTransaction(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !selected || !canWriteFinancials) return;
    const amount = cents(transactionAmount);
    if (amount <= 0) { setError("Enter an amount greater than zero."); return; }
    setBusy(true); setError("");
    const { error: insertError } = await supabase.from("crm_project_transactions").insert({
      division_id: selected.division_id, project_id: selected.id, transaction_type: transactionType,
      amount, transaction_date: transactionDate, reference_number: transactionReference.trim() || null,
      payment_method: transactionType === "payment" ? transactionMethod || null : null,
      notes: transactionNotes.trim() || null, entered_by: userId
    });
    if (insertError) setError(insertError.message);
    else {
      setTransactionAmount(""); setTransactionReference(""); setTransactionMethod(""); setTransactionNotes("");
      await load();
      const { data: fresh } = await supabase.from("crm_projects").select("*").eq("id", selected.id).single();
      await openProject((fresh || selected) as Project);
      setMessage(transactionType === "invoice" ? "Invoice recorded." : "Payment recorded.");
    }
    setBusy(false);
  }

  async function saveFinancials(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !selected || !canWriteFinancials) return;
    const direct = expenses.filter(x => x.category !== "overhead" && x.category !== "sales_commission").reduce((sum, x) => sum + Math.round(Number(x.amount) * 100), 0) / 100;
    const approved = cents(financeApproved);
    const contractAmount = cents(financeContract);
    const collected = Number(selected.collected_amount || 0);
    const contractValueNow = (contractAmount || approved) + Number(selected.supplements_approved_amount || 0);
    const grossNow = contractValueNow - direct;
    const rate = cents(commissionRate);
    const fixed = cents(commissionFixed);
    const earned = commissionMethod === "fixed" ? fixed
      : commissionMethod === "contract_percent" ? contractValueNow * rate / 100
      : commissionMethod === "collected_percent" ? collected * rate / 100
      : commissionMethod === "gross_profit_percent" ? grossNow * rate / 100
      : cents(commissionEarned);
    const overheadRateValue = cents(overheadRate);
    const overheadFixedValue = cents(overheadFixed);
    const overheadAllocated = overheadMethod === "flat" ? overheadFixedValue
      : overheadMethod === "contract_percent" ? contractValueNow * overheadRateValue / 100
      : overheadMethod === "direct_cost_percent" ? direct * overheadRateValue / 100
      : overheadFixedValue;
    if (cents(commissionPaid) > earned) { setError("Commission paid cannot exceed commission earned."); return; }
    
    setBusy(true); setError("");
    const { error: updateError } = await supabase.rpc("crm_update_project_financials", {
      p_project_id: selected.id,
      p_contract_amount: contractAmount || null,
      p_initial_approved_amount: approved || null,
      p_commission_method: commissionMethod,
      p_commission_rate: rate || null,
      p_commission_fixed_amount: fixed || null,
      p_commission_salesperson_name: commissionSalesperson.trim() || null,
      p_commission_earned_amount: Math.round(earned * 100) / 100,
      p_commission_paid_amount: cents(commissionPaid),
      p_overhead_method: overheadMethod,
      p_overhead_rate: overheadRateValue || null,
      p_overhead_fixed_amount: overheadFixedValue || null,
      p_overhead_allocated_amount: Math.round(overheadAllocated * 100) / 100
    });
    if (updateError) setError(updateError.message);
    else {
      setMessage("Project financials saved.");
      await load();
      const { data: fresh } = await supabase.from("crm_projects").select("*").eq("id", selected.id).single();
      await openProject((fresh || { ...selected, contract_amount: contractAmount || null, initial_approved_amount: approved || null, commission_method: commissionMethod, commission_rate: rate, commission_fixed_amount: fixed, commission_earned_amount: earned, commission_paid_amount: cents(commissionPaid), commission_salesperson_name: commissionSalesperson, overhead_method: overheadMethod, overhead_rate: overheadRateValue, overhead_fixed_amount: overheadFixedValue, overhead_allocated_amount: overheadAllocated }) as Project);
    }
    setBusy(false);
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !canWrite) return;
    setBusy(true); setError("");
    const { error: settingsError } = await supabase.from("crm_division_financial_settings").upsert({
      division_id: division, stale_stage_days: staleDays, updated_by: userId, updated_at: new Date().toISOString()
    }, { onConflict: "division_id" });
    if (settingsError) setError(settingsError.message);
    else { setMessage("Pipeline settings saved."); setSettingsOpen(false); }
    setBusy(false);
  }

  const filtered = useMemo(() => projects.filter(p => filter === "all" || p.pipeline_type === filter), [projects, filter]);
  const kanbanStages = useMemo(() => {
    const base = filter === "retail" ? retailStages : filter === "insurance" ? insuranceStages : [...new Set([...retailStages, ...insuranceStages])];
    return filtered.some(p => !p.pipeline_type) ? ["unassigned", ...base] : base;
  }, [filter, filtered]);
  const stageFor = (project: Project) => project.pipeline_type ? (project.workflow_stage || "new_lead") : "unassigned";
  const daysInStage = (project: Project) => Math.max(0, Math.floor((Date.now() - new Date(stageLastChanged[project.id] || project.created_at).getTime()) / 86400000));
  const addressFor = (id: string) => { const p = properties.find(x => x.id === id); return p ? [p.address_line1,p.city,p.state].filter(Boolean).join(", ") : "Property"; };
  const renderProjectCard = (project: Project) => {
    const stages = project.pipeline_type === "insurance" ? insuranceStages : retailStages;
    return <article className="pipeline-card" key={project.id} draggable={scope !== "combined" && canWrite && !!project.pipeline_type} onDragStart={(event: DragEvent<HTMLElement>) => { setDraggedProjectId(project.id); event.dataTransfer.setData("text/project", project.id); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => setDraggedProjectId(null)}>
      <button className="pipeline-card-main" onClick={()=>void openProject(project)}>
        <span className="pipeline-card-type">{project.division_id} · {project.pipeline_type ? stageLabel(project.pipeline_type) : "Workflow not assigned"}</span>
        <strong>{project.project_name}</strong><span className="muted">{addressFor(project.property_id)}</span>
        <span className="pipeline-card-stage">{stageLabel(project.workflow_stage || project.status || "planning")}</span>
        <span className="pipeline-card-value">{money(project.contract_amount || project.initial_approved_amount || project.original_estimate_amount)}</span>
        <span className="muted">Manager: {project.project_manager_id ? staffNames[project.project_manager_id] || "Assigned" : "Unassigned"}</span>
        <span className="muted">{daysInStage(project)} days in stage</span>
        {project.next_action && <span className="muted">Next: {project.next_action}</span>}
        {project.next_action_due_at && <span className={new Date(project.next_action_due_at).getTime()<Date.now()?"error-text":"muted"}>Due {new Date(project.next_action_due_at).toLocaleDateString()}</span>}
      </button>
      {scope !== "combined" && canWrite && <label className="stage-quick-edit">{project.pipeline_type ? "Move to" : "Assign workflow"}<select value={project.pipeline_type ? (project.workflow_stage || stages[0]) : ""} onChange={e=>project.pipeline_type ? void moveProject(project,e.target.value) : e.target.value && void assignWorkflow(project,e.target.value as "retail"|"insurance")} disabled={busy}><option value="" disabled>{project.pipeline_type ? "Select stage" : "Choose workflow"}</option>{!project.pipeline_type && <><option value="retail">Retail</option><option value="insurance">Insurance</option></>}{project.pipeline_type && stages.map(s=><option key={s} value={s}>{stageLabel(s)}</option>)}</select></label>}
    </article>;
  };
  const totalExpenses = expenses.reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0) / 100;
  const directExpenses = expenses.filter(x => x.category !== "overhead" && x.category !== "sales_commission").reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0) / 100;
  const contractValue = Number(selected?.contract_amount || selected?.initial_approved_amount || 0) + Number(selected?.supplements_approved_amount || 0);
  const gross = contractValue - directExpenses;
  const netProfit = gross - Number(selected?.commission_earned_amount || 0) - Number(selected?.overhead_allocated_amount || 0);
  const attention = filtered.filter(p => p.workflow_stage !== "closed" && ((p.next_action_due_at && new Date(p.next_action_due_at).getTime() < Date.now()) || Math.floor((Date.now() - new Date(stageLastChanged[p.id] || p.created_at).getTime()) / 86400000) >= staleDays));
  const activeContractValue = filtered.filter(p => p.workflow_stage !== "closed").reduce((sum,p)=>sum+Number(p.contract_amount || p.initial_approved_amount || 0)+Number(p.supplements_approved_amount || 0),0);
  const collectedTotal = filtered.reduce((sum,p)=>sum+Number(p.collected_amount || 0),0);
  const addressFor = (id: string) => { const p = properties.find(x => x.id === id); return p ? [p.address_line1,p.city,p.state].filter(Boolean).join(", ") : "Property"; };

  return <div className="content-stack project-pipeline">
    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">{scope === "combined" ? "TRD + CRD" : division} PROJECT OPERATIONS</p><h2>Project pipeline</h2><p className="muted">Track each job from lead through completion. Customers and properties remain in the existing CRM records.</p></div><div className="panel-actions"><span className="record-count">{filtered.length} projects</span>{scope !== "combined" && canWrite && <button className="primary-button compact" onClick={() => setShowCreate(v => !v)}>+ New project</button>}</div></div>
      <div className="financial-summary pipeline-overview">
        <div><span>Active contract value</span><strong>{money(activeContractValue)}</strong></div>
        <div><span>Collected revenue</span><strong>{money(collectedTotal)}</strong></div>
        <div><span>Collected this month</span><strong>{money(monthlyCollected)}</strong></div>
        <div><span>Recorded expenses</span><strong>{money(divisionExpenseTotal)}</strong></div>
        <div><span>Needs attention</span><strong>{attention.length}</strong></div>
      </div>
      <div className="panel-heading subheading"><div><h3>Needs attention</h3><p className="muted">Overdue next actions and projects unchanged for {staleDays} days or more.</p></div>{scope !== "combined" && <button className="secondary-button compact" onClick={()=>setSettingsOpen(v=>!v)}>Pipeline settings</button>}</div>
      {scope !== "combined" && settingsOpen && <form className="inline-form" onSubmit={saveSettings}><div className="form-grid"><label>Stale stage threshold (days)<input type="number" min="1" max="365" value={staleDays} onChange={e=>setStaleDays(Math.max(1,Math.min(365,Number(e.target.value)||1)))} /></label></div><button className="primary-button" disabled={busy}>Save settings</button></form>}
      {attention.length ? <div className="attention-list">{attention.slice(0,10).map(p=><button key={p.id} className="attention-item" onClick={()=>void openProject(p)}><strong>{p.project_name}</strong><span>{p.next_action_due_at && new Date(p.next_action_due_at).getTime()<Date.now() ? "Overdue next action" : "Stale project"} · {stageLabel(p.workflow_stage || "unassigned")}</span><small>{p.next_action || "Review project and set a next action"}</small></button>)}</div> : <p className="muted">No projects currently need attention.</p>}
      <div className="pipeline-toolbar"><div className="segmented-filter">{availableDivisions.length > 1 && <><button className={scope==="division"?"active":""} onClick={()=>setScope("division")}>Current division</button><button className={scope==="combined"?"active":""} onClick={()=>{setScope("combined");setSelected(null);setShowCreate(false);setShowExpense(false);setShowSupplement(false);setSettingsOpen(false);}}>Combined TRD + CRD</button></>}</div><div className="segmented-filter"><button className={filter==="all"?"active":""} onClick={()=>setFilter("all")}>All</button><button className={filter==="retail"?"active":""} onClick={()=>setFilter("retail")}>Retail</button><button className={filter==="insurance"?"active":""} onClick={()=>setFilter("insurance")}>Insurance</button></div></div>
      {scope !== "combined" && showCreate && <form className="inline-form" onSubmit={createProject}><div className="form-grid">
        <label>Project name<input required value={projectName} onChange={e=>setProjectName(e.target.value)} placeholder="Customer or property project name" /></label>
        <label>Project category<select value={projectType} onChange={e=>setProjectType(e.target.value)}><option value="roof_replacement">Roof replacement</option><option value="repair">Repair</option><option value="restoration">Restoration</option><option value="coating">Roof coating</option><option value="maintenance">Maintenance</option><option value="other">Other</option></select></label>
        <label>Workflow<select value={pipelineType} onChange={e=>{const v=e.target.value as "retail"|"insurance";setPipelineType(v);setStage("new_lead");}}><option value="retail">Retail</option><option value="insurance">Insurance</option></select></label>
        <label>Starting stage<select value={stage} onChange={e=>setStage(e.target.value)}>{(pipelineType==="retail"?retailStages:insuranceStages).map(x=><option key={x} value={x}>{stageLabel(x)}</option>)}</select></label>
        <label className="wide">Property<select required value={propertyId} onChange={e=>setPropertyId(e.target.value)}><option value="">Select property</option>{properties.map(p=><option key={p.id} value={p.id}>{p.address_line1}, {p.city}, {p.state} · {customerNames[p.customer_id] || "Customer"}</option>)}</select></label>
        <label>Initial estimate ($)<input type="number" min="0" step="0.01" value={contract} onChange={e=>setContract(e.target.value)} /></label>
        <label>Next action<input value={nextAction} onChange={e=>setNextAction(e.target.value)} placeholder="Call customer, order materials..." /></label>
        <label>Next action due<input type="datetime-local" value={nextDue} onChange={e=>setNextDue(e.target.value)} /></label>
      </div><button className="primary-button" disabled={busy || !properties.length}>Create project</button></form>}
      {message && <p className="inline-message">{message}</p>}
      {error && <p className="inline-message error-text">{error}</p>}
      {busy && <p className="muted">Working...</p>}
      <div className="pipeline-toolbar pipeline-view-toolbar"><span className="muted">{scope === "combined" ? "Combined view is read only. Switch to TRD or CRD to make changes." : "Drag a project between stages to update its workflow."}</span><div className="segmented-filter"><button className={viewMode==="kanban"?"active":""} onClick={()=>setViewMode("kanban")}>Kanban</button><button className={viewMode==="list"?"active":""} onClick={()=>setViewMode("list")}>List</button></div></div>
      {busy && !projects.length ? <div className="empty-state">Loading projects...</div> : filtered.length ? (viewMode === "kanban" ? <div className="kanban-board">{kanbanStages.map(stage=>{
        const items = filtered.filter(project => stageFor(project) === stage);
        return <section className="kanban-column" key={stage} onDragOver={event=>{if(scope!=="combined"&&canWrite)event.preventDefault();}} onDrop={event=>{event.preventDefault();const id=event.dataTransfer.getData("text/project")||draggedProjectId;const project=filtered.find(item=>item.id===id);if(project&&project.pipeline_type){const allowed=project.pipeline_type==="insurance"?insuranceStages:retailStages;if(allowed.includes(stage))void moveProject(project,stage);}setDraggedProjectId(null);}}>
          <div className="kanban-column-header"><strong>{stage==="unassigned"?"Workflow not assigned":stageLabel(stage)}</strong><span>{items.length}</span></div>
          <div className="kanban-column-cards">{items.map(renderProjectCard)}{!items.length&&<div className="kanban-drop-placeholder">Drop project here</div>}</div>
        </section>;
      })}</div> : <div className="table-wrap pipeline-list"><table><thead><tr><th>Project</th><th>Division</th><th>Workflow</th><th>Stage</th><th>Value</th><th>Manager</th><th>Next action</th><th>Days in stage</th></tr></thead><tbody>{filtered.map(project=><tr key={project.id}><td><button className="pipeline-list-link" onClick={()=>void openProject(project)}>{project.project_name}</button><small>{addressFor(project.property_id)}</small></td><td>{project.division_id}</td><td>{project.pipeline_type?stageLabel(project.pipeline_type):"Unassigned"}</td><td>{scope!=="combined"&&canWrite&&project.pipeline_type?<select value={project.workflow_stage||"new_lead"} onChange={e=>void moveProject(project,e.target.value)}>{(project.pipeline_type==="insurance"?insuranceStages:retailStages).map(stage=><option key={stage} value={stage}>{stageLabel(stage)}</option>)}</select>:stageLabel(project.workflow_stage||"unassigned")}</td><td>{money(project.contract_amount||project.initial_approved_amount||project.original_estimate_amount)}</td><td>{project.project_manager_id?staffNames[project.project_manager_id]||"Assigned":"Unassigned"}</td><td>{project.next_action||"—"}</td><td>{daysInStage(project)}</td></tr>)}</tbody></table></div>) : <div className="empty-state"><strong>No projects in this view</strong><span>Create a project using an existing customer property.</span></div>}
    </section>

    {selected && <section className="panel project-detail">
      <div className="panel-heading"><div><p className="eyebrow">PROJECT DETAIL</p><h2>{selected.project_name}</h2><p className="muted">{selected.division_id} · {addressFor(selected.property_id)} · {customerNames[selected.customer_id] || "Customer"}</p></div><button className="secondary-button compact" onClick={()=>setSelected(null)}>Close</button></div>
      <div className="financial-summary">
        <div><span>Contract / approved value</span><strong>{money(contractValue)}</strong></div>
        <div><span>Invoiced</span><strong>{money(selected.invoiced_amount)}</strong></div>
        <div><span>Receivable</span><strong>{money(Math.max(0,Number(selected.invoiced_amount||0)-Number(selected.collected_amount||0)))}</strong></div><div><span>Unapplied payments</span><strong>{money(Math.max(0,Number(selected.collected_amount||0)-Number(selected.invoiced_amount||0)))}</strong></div>
        <div><span>Collected</span><strong>{money(selected.collected_amount)}</strong></div>
        <div><span>Recorded expenses</span><strong>{money(totalExpenses)}</strong></div>
        <div><span>Direct costs</span><strong>{money(directExpenses)}</strong></div>
        <div><span>Gross profit</span><strong>{money(gross)}</strong></div><div><span>Commission earned</span><strong>{money(selected.commission_earned_amount)}</strong></div><div><span>Overhead allocated</span><strong>{money(selected.overhead_allocated_amount)}</strong></div><div><span>Net project profit</span><strong>{money(netProfit)}</strong></div>
      </div>
      {canWriteFinancials && <form className="inline-form" onSubmit={saveFinancials}>
        <div className="panel-heading subheading"><div><h3>Contract and profitability</h3><p className="muted">Set contract and approval values, then manage invoices and payments in the transaction ledger.</p></div></div>
        <div className="form-grid">
          <label>Signed contract amount ($)<input type="number" min="0" step="0.01" value={financeContract} onChange={e=>setFinanceContract(e.target.value)} /></label>
          <label>Initial approved amount ($)<input type="number" min="0" step="0.01" value={financeApproved} onChange={e=>setFinanceApproved(e.target.value)} /></label>
          <label>Commission method<select value={commissionMethod} onChange={e=>setCommissionMethod(e.target.value)}><option value="fixed">Fixed amount</option><option value="contract_percent">Percent of contract</option><option value="collected_percent">Percent of collected revenue</option><option value="gross_profit_percent">Percent of gross profit</option><option value="manual">Manual</option></select></label>
          <label>Commission rate (%)<input type="number" min="0" step="0.01" value={commissionRate} onChange={e=>setCommissionRate(e.target.value)} /></label>
          <label>Commission fixed / manual earned ($)<input type="number" min="0" step="0.01" value={commissionMethod==="manual"?commissionEarned:commissionFixed} onChange={e=>commissionMethod==="manual"?setCommissionEarned(e.target.value):setCommissionFixed(e.target.value)} /></label>
          <label>Commission paid ($)<input type="number" min="0" step="0.01" value={commissionPaid} onChange={e=>setCommissionPaid(e.target.value)} /></label>
          <label>Salesperson<input value={commissionSalesperson} onChange={e=>setCommissionSalesperson(e.target.value)} /></label>
          <label>Overhead method<select value={overheadMethod} onChange={e=>setOverheadMethod(e.target.value)}><option value="flat">Flat amount</option><option value="contract_percent">Percent of contract</option><option value="direct_cost_percent">Percent of direct costs</option><option value="manual">Manual</option></select></label>
          <label>Overhead rate (%)<input type="number" min="0" step="0.01" value={overheadRate} onChange={e=>setOverheadRate(e.target.value)} /></label>
          <label>Overhead flat / manual allocation ($)<input type="number" min="0" step="0.01" value={overheadFixed} onChange={e=>setOverheadFixed(e.target.value)} /></label>
        </div>
        <button className="primary-button" disabled={busy}>Save financials</button>
      </form>}
      <div className="panel-heading subheading"><div><h3>Estimated versus actual costs</h3><p className="muted">Set a budget for each cost category and compare it with recorded costs.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>Category</th><th>Estimated ($)</th><th>Actual ($)</th><th>Variance ($)</th><th></th></tr></thead><tbody>{["materials","labor","equipment","permits","sales_commission","overhead","other"].map(category=>{
        const actual = category==="sales_commission" ? Number(selected.commission_earned_amount||0) : category==="overhead" ? Number(selected.overhead_allocated_amount||0) : expenses.filter(x=>x.category===category).reduce((sum,x)=>sum+Number(x.amount||0),0);
        const estimated = Number(costEstimates[category]||0);
        return <tr key={category}><td>{stageLabel(category)}</td><td>{scope !== "combined" && canWriteFinancials ? <input type="number" min="0" step="0.01" defaultValue={estimated} onBlur={e=>{const v=cents(e.target.value);if(v!==estimated)void saveCostEstimate(category,e.target.value);}} /> : money(estimated)}</td><td>{money(actual)}</td><td>{money(actual-estimated)}</td><td>{actual>estimated && estimated>0 ? <span className="error-text">Over budget</span> : "—"}</td></tr>;
      })}</tbody></table></div>
      <div className="panel-heading subheading"><div><h3>Invoices and payments</h3><p className="muted">Record each invoice and customer payment. Project totals update automatically and remain separate from approved contract value.</p></div></div>
      {scope !== "combined" && canWriteFinancials && <form className="inline-form" onSubmit={addTransaction}><div className="form-grid">
        <label>Transaction<select value={transactionType} onChange={e=>setTransactionType(e.target.value as "invoice"|"payment")}><option value="invoice">Invoice issued</option><option value="payment">Payment received</option></select></label>
        <label>Amount ($)<input required type="number" min="0.01" step="0.01" value={transactionAmount} onChange={e=>setTransactionAmount(e.target.value)} /></label>
        <label>Date<input required type="date" value={transactionDate} onChange={e=>setTransactionDate(e.target.value)} /></label>
        <label>Reference / invoice number<input value={transactionReference} onChange={e=>setTransactionReference(e.target.value)} /></label>
        {transactionType==="payment" && <label>Payment method<select value={transactionMethod} onChange={e=>setTransactionMethod(e.target.value)}><option value="">Select method</option><option value="check">Check</option><option value="ach">ACH / bank transfer</option><option value="card">Card</option><option value="cash">Cash</option><option value="other">Other</option></select></label>}
        <label className="wide">Notes<input value={transactionNotes} onChange={e=>setTransactionNotes(e.target.value)} /></label>
      </div><button className="primary-button" disabled={busy}>Record {transactionType}</button></form>}
      {transactions.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Method</th><th>Amount</th><th>Status</th></tr></thead><tbody>{transactions.map(t=><tr key={t.id}><td>{new Date(t.transaction_date+"T12:00:00").toLocaleDateString()}</td><td>{stageLabel(t.transaction_type)}</td><td>{t.reference_number||"—"}</td><td>{t.payment_method||"—"}</td><td>{money(t.amount)}</td><td>{stageLabel(t.status)}</td></tr>)}</tbody></table></div> : <div className="empty-state">No invoices or payments recorded yet.</div>}
      <div className="panel-heading subheading"><div><h3>Job costs</h3><p className="muted">Record actual expenses. Ordered materials are not counted until an expense is entered.</p></div>{scope !== "combined" && canWriteFinancials&&<button className="primary-button compact" onClick={()=>setShowExpense(v=>!v)}>+ Add expense</button>}</div>
      {scope !== "combined" && showExpense&&<form className="inline-form" onSubmit={addExpense}><div className="form-grid"><label>Category<select value={expenseCategory} onChange={e=>setExpenseCategory(e.target.value)}><option value="materials">Materials</option><option value="labor">Labor</option><option value="equipment">Equipment</option><option value="permits">Permits</option><option value="sales_commission">Sales commission</option><option value="overhead">Overhead allocation</option><option value="other">Other</option></select></label><label>Amount ($)<input type="number" min="0.01" step="0.01" required value={expenseAmount} onChange={e=>setExpenseAmount(e.target.value)} /></label><label>Date<input type="date" required value={expenseDate} onChange={e=>setExpenseDate(e.target.value)} /></label><label>Vendor / payee<input value={vendor} onChange={e=>setVendor(e.target.value)} /></label><label className="wide">Description<input value={expenseDescription} onChange={e=>setExpenseDescription(e.target.value)} /></label><label className="wide">Receipt attachment<input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" onChange={e=>setReceiptFile(e.target.files?.[0] || null)} /></label></div><button className="primary-button" disabled={busy}>Save expense</button></form>}
      {expenses.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Category</th><th>Vendor</th><th>Description</th><th>Amount</th><th>Payment</th><th>Paid</th><th>Receipt</th></tr></thead><tbody>{expenses.map(x=><tr key={x.id}><td>{new Date(x.expense_date+"T12:00:00").toLocaleDateString()}</td><td>{stageLabel(x.category)}</td><td>{x.vendor_payee||"—"}</td><td>{x.description||"—"}</td><td>{money(x.amount)}</td><td>{scope !== "combined" && canWriteFinancials ? <select value={x.payment_status} disabled={busy} onChange={e=>void updateExpense(x,{payment_status:e.target.value})}><option value="unpaid">Unpaid</option><option value="partially_paid">Partially paid</option><option value="paid">Paid</option></select> : stageLabel(x.payment_status)}</td><td>{scope !== "combined" && canWriteFinancials ? <input aria-label="Paid amount" type="number" min="0" max={x.amount} step="0.01" defaultValue={x.paid_amount} onBlur={e=>{const v=cents(e.target.value);if(v!==x.paid_amount)void updateExpense(x,{paid_amount:v,payment_status:v===0?"unpaid":v>=x.amount?"paid":"partially_paid"});}} /> : money(x.paid_amount)}</td><td>{x.receipt_file_id ? <button className="secondary-button compact" onClick={()=>void openReceipt(x)}>View</button> : "—"}</td></tr>)}</tbody></table></div>:<div className="empty-state">No expenses recorded for this project.</div>}
      {selected.pipeline_type==="insurance" && <><div className="panel-heading subheading"><div><h3>Supplements</h3><p className="muted">Each submission is tracked separately with its own response history.</p></div>{scope !== "combined" && canWrite&&<button className="primary-button compact" onClick={()=>setShowSupplement(v=>!v)}>+ Add supplement</button>}</div>
        {scope !== "combined" && showSupplement&&<form className="inline-form" onSubmit={addSupplement}><div className="form-grid"><label>Requested amount ($)<input type="number" min="0" step="0.01" required value={supplementAmount} onChange={e=>setSupplementAmount(e.target.value)} /></label><label>Status<select value={supplementStatus} onChange={e=>setSupplementStatus(e.target.value)}><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="under_review">Under review</option><option value="approved">Approved</option><option value="partially_approved">Partially approved</option><option value="denied">Denied</option><option value="resubmitted">Resubmitted</option></select></label><label className="wide">Notes<textarea rows={2} value={supplementNotes} onChange={e=>setSupplementNotes(e.target.value)} /></label><label className="wide">Supporting document<input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" onChange={e=>setSupplementFile(e.target.files?.[0] || null)} /></label></div><button className="primary-button" disabled={busy}>Save supplement</button></form>}
        {scope !== "combined" && supplementEditing && <form className="inline-form" onSubmit={e=>{e.preventDefault();const s=supplements.find(x=>x.id===supplementEditing);if(s)void updateSupplement(s,{approved_amount:cents(supplementApproved),status:supplementStatusEdit,carrier_response:supplementResponse,response_at:supplementResponseDate?new Date(supplementResponseDate).toISOString():null});}}><div className="form-grid"><label>Status<select value={supplementStatusEdit} onChange={e=>setSupplementStatusEdit(e.target.value)}><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="under_review">Under review</option><option value="approved">Approved</option><option value="partially_approved">Partially approved</option><option value="denied">Denied</option><option value="resubmitted">Resubmitted</option></select></label><label>Approved amount ($)<input type="number" min="0" step="0.01" value={supplementApproved} onChange={e=>setSupplementApproved(e.target.value)} /></label><label>Response date<input type="date" value={supplementResponseDate} onChange={e=>setSupplementResponseDate(e.target.value)} /></label><label className="wide">Carrier response / notes<input value={supplementResponse} onChange={e=>setSupplementResponse(e.target.value)} /></label></div><button className="primary-button" disabled={busy}>Save carrier response</button><button type="button" className="secondary-button compact" onClick={()=>setSupplementEditing(null)}>Cancel</button></form>}
        {supplements.length?<div className="table-wrap"><table><thead><tr><th>#</th><th>Status</th><th>Requested</th><th>Approved</th><th>Submitted</th><th>Carrier response</th><th>Attachments</th><th>Update</th></tr></thead><tbody>{supplements.map(s=><tr key={s.id}><td>{s.supplement_number}</td><td>{stageLabel(s.status)}</td><td>{money(s.requested_amount)}</td><td>{money(s.approved_amount)}</td><td>{s.submitted_at?new Date(s.submitted_at).toLocaleDateString():"—"}</td><td>{s.carrier_response || "—"}</td><td>{(supplementAttachments[s.id] || []).map(file=><button key={file.id} className="secondary-button compact" onClick={()=>void openSupplementAttachment(file)}>View {file.original_filename}</button>)}</td><td>{scope !== "combined" && canWrite && <button className="secondary-button compact" onClick={()=>{setSupplementEditing(s.id);setSupplementApproved(String(s.approved_amount||0));setSupplementResponse(s.carrier_response||"");setSupplementResponseDate(s.response_at?s.response_at.slice(0,10):new Date().toISOString().slice(0,10));setSupplementStatusEdit(s.status);}}>Update</button>}</td></tr>)}</tbody></table></div>:<div className="empty-state">No supplements recorded.</div>}</>}
      <div className="panel-heading subheading"><div><h3>Stage history</h3></div></div>
      {history.length?<div className="history-list">{history.map(item=><div key={item.id}><strong>{stageLabel(item.from_stage||"Project created")} → {stageLabel(item.to_stage)}</strong><span>{new Date(item.changed_at).toLocaleString()}</span>{item.note&&<p>{item.note}</p>}</div>)}</div>:<div className="empty-state">No stage changes recorded yet.</div>}
      <div className="panel-heading subheading"><div><h3>Financial and record edit history</h3><p className="muted">Changes to financial values, expenses, supplements, invoices, and payments are retained.</p></div></div>
      {auditEvents.length ? <div className="history-list">{auditEvents.map(item=><details key={item.id}><summary><strong>{item.kind}</strong><span>{new Date(item.changed_at).toLocaleString()}</span></summary><pre>{JSON.stringify({before:item.before_values,after:item.after_values},null,2)}</pre></details>)}</div> : <div className="empty-state">No financial edits recorded yet.</div>}
    </section>}
  </div>;
}
