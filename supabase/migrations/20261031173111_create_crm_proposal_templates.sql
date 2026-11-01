create table if not exists public.crm_proposal_templates (
  division_id text primary key references public.crm_divisions(id) on delete cascade,
  company_name text not null,
  introduction text not null default '',
  default_scope text not null default '',
  default_exclusions text not null default '',
  payment_terms text not null default '',
  warranty_summary text not null default '',
  footer_text text not null default '',
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.crm_proposal_templates enable row level security;
grant select, insert, update on public.crm_proposal_templates to authenticated;
create policy crm_proposal_templates_read on public.crm_proposal_templates
for select to authenticated
using (app_private.has_division_resource_access(division_id, 'leads', false));
create policy crm_proposal_templates_owner_insert on public.crm_proposal_templates
for insert to authenticated
with check (app_private.is_crm_owner() and (updated_by is null or updated_by = (select auth.uid())));
create policy crm_proposal_templates_owner_update on public.crm_proposal_templates
for update to authenticated
using (app_private.is_crm_owner())
with check (app_private.is_crm_owner() and (updated_by is null or updated_by = (select auth.uid())));
insert into public.crm_proposal_templates (division_id, company_name, introduction, default_scope, default_exclusions, payment_terms, warranty_summary, footer_text)
values
('TRD', 'The ROOF Doctors', 'Thank you for the opportunity to provide this proposal for your property.', 'Remove existing roofing materials as specified. Inspect exposed decking and document any damaged areas. Install the specified underlayment, flashing, roofing system, ventilation components, and related accessories. Complete cleanup and a final site review.', 'Unless specifically included in this proposal, concealed damage, structural repairs, interior repairs, code upgrades, permit fees, and work outside the described scope are excluded.', 'Due upon completion unless otherwise stated in writing.', 'Manufacturer and workmanship warranties apply only as specifically identified in this proposal and the final warranty documents.', 'Thank you for considering The ROOF Doctors. Please contact our office with any questions.'),
('CRD', 'Commercial ROOF Doctors', 'Thank you for the opportunity to evaluate your commercial roofing project and provide this proposal.', 'Prepare the designated roof areas. Complete the specified repairs or restoration, including surface preparation, insulation, membrane or coating installation, flashing, penetrations, terminations, and project closeout as described in the approved scope.', 'Unless specifically included, concealed substrate conditions, structural repairs, interior repairs, hazardous material abatement, code upgrades, engineering, permits, and work outside the identified roof areas are excluded.', 'Payment is due according to the approved schedule and written agreement.', 'Applicable manufacturer and contractor warranties will be identified in the final project and warranty documents.', 'Thank you for considering Commercial ROOF Doctors. We appreciate the opportunity to work with your organization.')
on conflict (division_id) do nothing;