import { useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";

type DivisionId = "TRD" | "CRD";
type Props = {
  entityType: "lead" | "customer";
  entityId: string;
  division: DivisionId;
  assignedTo: string | null;
  isOwner: boolean;
  compact?: boolean;
};

type Salesperson = { user_id: string; display_name: string; email: string; divisions: string[] };
type History = { id: string; previous_assignee: string | null; new_assignee: string | null; changed_at: string; changed_by: string };

export default function SalespersonAssignment({ entityType, entityId, division, assignedTo, isOwner, compact = false }: Props) {
  const [people, setPeople] = useState<Salesperson[]>([]);
  const [peopleLoaded, setPeopleLoaded] = useState(false);
  const [history, setHistory] = useState<History[]>([]);
  const [historyNames, setHistoryNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [assignedName, setAssignedName] = useState("");

  const load = useCallback(async () => {
    setPeopleLoaded(false);
    if (!supabase || !isOwner) return;
    const { data: memberships, error } = await supabase.from("crm_memberships")
      .select("user_id,division_id").in("division_id", entityType === "customer" ? ["TRD", "CRD"] : [division]).eq("role", "sales_rep").eq("active", true);
    if (error) { setMessage(error.message); setPeopleLoaded(true); return; }
    const divisionMap = new Map<string, string[]>();
    (memberships ?? []).forEach((item: { user_id: string; division_id: string }) => divisionMap.set(item.user_id, [...(divisionMap.get(item.user_id) ?? []), item.division_id]));
    const ids = [...divisionMap.keys()];
    if (!ids.length) { setPeople([]); setPeopleLoaded(true); return; }
    const { data: profiles, error: profileError } = await supabase.from("crm_profiles")
      .select("user_id,display_name,email").in("user_id", ids).eq("active", true).order("display_name");
    if (profileError) { setMessage(profileError.message); setPeopleLoaded(true); return; }
    setPeople((profiles ?? []).map((p: any) => ({ user_id: p.user_id, display_name: p.display_name || p.email || "Salesperson", email: p.email || "", divisions: divisionMap.get(p.user_id) ?? [] })));
    setPeopleLoaded(true);
  }, [division, isOwner]);

  const loadHistory = useCallback(async () => {
    if (!supabase || !isOwner) return;
    const { data, error } = await supabase.from("crm_assignment_history")
      .select("id,previous_assignee,new_assignee,changed_at,changed_by")
      .eq("entity_type", entityType).eq("entity_id", entityId).order("changed_at", { ascending: false }).limit(8);
    if (error) { setMessage(error.message); return; }
    const rows = (data ?? []) as History[];
    setHistory(rows);
    const ids = [...new Set(rows.flatMap(item => [item.previous_assignee, item.new_assignee, item.changed_by].filter(Boolean) as string[]))];
    if (ids.length) {
      const { data: profiles } = await supabase.from("crm_profiles").select("user_id,display_name,email").in("user_id", ids);
      const names: Record<string, string> = {};
      (profiles ?? []).forEach((profile: any) => { names[profile.user_id] = profile.display_name || profile.email || "Former employee"; });
      setHistoryNames(names);
    } else setHistoryNames({});
  }, [entityId, entityType, isOwner]);

  useEffect(() => { void load(); void loadHistory(); }, [load, loadHistory]);

  useEffect(() => {
    let cancelled = false;
    async function loadAssignedName() {
      if (!supabase || !assignedTo) { setAssignedName(""); return; }
      const { data, error } = await supabase.rpc("crm_assigned_salesperson_name", {
        p_entity_type: entityType,
        p_entity_id: entityId
      });
      if (cancelled) return;
      setAssignedName(!error && typeof data === "string" ? data : "Assigned");
    }
    void loadAssignedName();
    return () => { cancelled = true; };
  }, [assignedTo, entityId, entityType, isOwner]);

  async function assign(value: string) {
    if (!supabase || !isOwner) return;
    setBusy(true); setMessage("");
    const { error } = await supabase.from(entityType === "lead" ? "crm_leads" : "crm_customers")
      .update({ assigned_to: value || null }).eq("id", entityId);
    if (error) setMessage(error.message);
    else { setMessage("Assignment saved."); await loadHistory(); }
    setBusy(false);
  }

  if (!isOwner) return <span className="muted">{assignedTo ? (assignedName || "Assigned") : "Unassigned"}</span>;

  return <div className={compact ? "assignment-control compact" : "assignment-control"}>
    <select className="table-select" aria-label="Assigned salesperson" value={assignedTo || ""} disabled={busy}
      onChange={event => void assign(event.target.value)}>
      <option value="">Unassigned</option>
      {assignedTo && !people.some(person => person.user_id === assignedTo) && <option value={assignedTo} disabled>{assignedName || "Current assignee"}</option>}
      {people.map(person => <option key={person.user_id} value={person.user_id}>{person.display_name}{entityType === "customer" ? ` (${person.divisions.join("/")})` : ""}</option>)}
    </select>
    {peopleLoaded && !people.length && <span className="assignment-message" title="No active Sales Rep accounts are available for assignment. Add a Sales Rep in Team access to assign or transfer this record.">{compact ? "No reps available" : "No active Sales Rep accounts are available for assignment. Add a Sales Rep in Team access to assign or transfer this record."}</span>}
    {message && <span className="assignment-message">{message}</span>}
    {!compact && history.length > 0 && <details className="assignment-history"><summary>Assignment history ({history.length})</summary>
      {history.map(item => <div key={item.id}>{new Date(item.changed_at).toLocaleString()} · {historyNames[item.previous_assignee || ""] || (item.previous_assignee ? "Former salesperson" : "Unassigned")} → {historyNames[item.new_assignee || ""] || (item.new_assignee ? "Former salesperson" : "Unassigned")} · changed by {historyNames[item.changed_by] || "admin"}</div>)}
    </details>}
  </div>;
}
