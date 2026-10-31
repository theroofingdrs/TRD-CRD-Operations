import { FormEvent, useCallback, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";

type DivisionId = "TRD" | "CRD";
type Template = {
  division_id: DivisionId;
  company_name: string;
  introduction: string;
  default_scope: string;
  default_exclusions: string;
  payment_terms: string;
  warranty_summary: string;
  footer_text: string;
};

const emptyTemplate = (division: DivisionId): Template => ({
  division_id: division,
  company_name: division === "TRD" ? "The ROOF Doctors" : "Commercial ROOF Doctors",
  introduction: "",
  default_scope: "",
  default_exclusions: "",
  payment_terms: "",
  warranty_summary: "",
  footer_text: ""
});

export default function ProposalTemplates({ division, userId }: { division: DivisionId; userId: string }) {
  const [template, setTemplate] = useState<Template>(() => emptyTemplate(division));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setMessage("");
    const { data, error } = await supabase.from("crm_proposal_templates").select("*").eq("division_id", division).maybeSingle();
    if (error) setMessage("Could not load proposal template: " + error.message);
    setTemplate(data ? data as Template : emptyTemplate(division));
    setLoading(false);
  }, [division]);
  useEffect(() => { void load(); }, [load]);
  function update(patch: Partial<Template>) {
    setTemplate(current => ({ ...current, ...patch }));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSaving(true);
    setMessage("");
    const { error } = await supabase.from("crm_proposal_templates").upsert({
      ...template,
      company_name: template.company_name.trim(),
      updated_by: userId,
      updated_at: new Date().toISOString()
    }, { onConflict: "division_id" });
    if (error) setMessage("Template could not be saved: " + error.message);
    else setMessage("Proposal template saved. New proposals will use these defaults, and emailed PDFs will use the updated company name and wording.");
    setSaving(false);
  }
  return <div className="content-stack"><section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">{division} DOCUMENT SETTINGS</p><h2>{division === "TRD" ? "Residential" : "Commercial"} proposal template</h2><p className="muted">Edit the standard wording used for new proposals and their emailed PDF documents. Existing proposal records are not changed.</p></div></div>
    {loading ? <div className="empty-state">Loading template...</div> : <form className="inline-form" onSubmit={save}><div className="form-grid">
      <label className="wide">Company name shown on PDF<input required value={template.company_name} onChange={e => update({ company_name: e.target.value })} /></label>
      <label className="wide">Introduction<textarea rows={3} value={template.introduction} onChange={e => update({ introduction: e.target.value })} placeholder="Opening paragraph shown in the proposal PDF." /></label>
      <label className="wide">Default scope of work<textarea rows={6} value={template.default_scope} onChange={e => update({ default_scope: e.target.value })} /></label>
      <label className="wide">Default exclusions<textarea rows={4} value={template.default_exclusions} onChange={e => update({ default_exclusions: e.target.value })} /></label>
      <label className="wide">Default payment terms<textarea rows={3} value={template.payment_terms} onChange={e => update({ payment_terms: e.target.value })} /></label>
      <label className="wide">Default warranty wording<textarea rows={3} value={template.warranty_summary} onChange={e => update({ warranty_summary: e.target.value })} /></label>
      <label className="wide">Closing message / footer<textarea rows={3} value={template.footer_text} onChange={e => update({ footer_text: e.target.value })} /></label>
    </div><button className="primary-button" disabled={saving}>{saving ? "Saving template..." : "Save proposal template"}</button></form>}
    {message && <p className="inline-message">{message}</p>}
  </section></div>;
}
