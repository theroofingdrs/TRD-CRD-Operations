grant select, insert, update on table public.crm_import_batches to authenticated;
grant select, insert, update on table public.crm_historical_documents to authenticated;

drop policy if exists crm_historical_documents_read on public.crm_historical_documents;
create policy crm_historical_documents_read on public.crm_historical_documents
for select to authenticated
using (
  app_private.has_division_resource_access(division_id, 'files', false)
  and (
    (property_id is null and exists (
      select 1 from public.crm_customer_divisions cd
      where cd.customer_id = crm_historical_documents.customer_id
        and cd.division_id = crm_historical_documents.division_id
    ))
    or app_private.project_links_match_division(division_id, customer_id, property_id)
  )
);

drop policy if exists crm_historical_documents_insert on public.crm_historical_documents;
create policy crm_historical_documents_insert on public.crm_historical_documents
for insert to authenticated
with check (
  app_private.has_division_resource_access(division_id, 'files', true)
  and (
    (property_id is null and exists (
      select 1 from public.crm_customer_divisions cd
      where cd.customer_id = crm_historical_documents.customer_id
        and cd.division_id = crm_historical_documents.division_id
    ))
    or app_private.project_links_match_division(division_id, customer_id, property_id)
  )
  and (created_by is null or created_by = (select auth.uid()))
);

drop policy if exists crm_historical_documents_update on public.crm_historical_documents;
create policy crm_historical_documents_update on public.crm_historical_documents
for update to authenticated
using (app_private.has_division_resource_access(division_id, 'files', true))
with check (
  app_private.has_division_resource_access(division_id, 'files', true)
  and (
    (property_id is null and exists (
      select 1 from public.crm_customer_divisions cd
      where cd.customer_id = crm_historical_documents.customer_id
        and cd.division_id = crm_historical_documents.division_id
    ))
    or app_private.project_links_match_division(division_id, customer_id, property_id)
  )
);