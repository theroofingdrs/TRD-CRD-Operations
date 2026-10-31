-- Invoice2go historical migration support. Additive only.
create table if not exists public.crm_import_batches (
  id uuid primary key default gen_random_uuid(),
  division_id text not null references public.crm_divisions(id),
  source_system text not null,
  batch_name text not null,
  source_files jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists crm_import_batches_division_created_idx
  on public.crm_import_batches(division_id, created_at desc);
alter table public.crm_import_batches enable row level security;
drop policy if exists crm_import_batches_read on public.crm_import_batches;
create policy crm_import_batches_read on public.crm_import_batches
  for select to authenticated
  using (app_private.has_division_resource_access(division_id, 'customers', false));
drop policy if exists crm_import_batches_insert on public.crm_import_batches;
create policy crm_import_batches_insert on public.crm_import_batches
  for insert to authenticated
  with check (
    app_private.has_division_resource_access(division_id, 'customers', true)
    and (created_by is null or created_by = (select auth.uid()))
  );
drop policy if exists crm_import_batches_update on public.crm_import_batches;
create policy crm_import_batches_update on public.crm_import_batches
  for update to authenticated
  using (app_private.has_division_resource_access(division_id, 'customers', true))
  with check (app_private.has_division_resource_access(division_id, 'customers', true));

create table if not exists public.crm_historical_documents (
  id uuid primary key default gen_random_uuid(),
  division_id text not null references public.crm_divisions(id),
  customer_id uuid not null references public.crm_customers(id) on delete cascade,
  property_id uuid references public.crm_properties(id) on delete set null,
  document_type text not null check (document_type in ('invoice','estimate','credit_memo','photo','other')),
  document_number text,
  document_date date,
  due_date date,
  status text,
  subtotal numeric(14,2),
  tax_amount numeric(14,2),
  total_amount numeric(14,2),
  original_filename text,
  storage_file_id uuid references public.crm_files(id) on delete set null,
  source_system text not null default 'manual',
  source_record_id text,
  import_batch_id uuid references public.crm_import_batches(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists crm_historical_documents_customer_idx
  on public.crm_historical_documents(division_id, customer_id, document_date desc);
create unique index if not exists crm_historical_documents_source_unique
  on public.crm_historical_documents(division_id, source_system, source_record_id)
  where source_record_id is not null;
alter table public.crm_historical_documents enable row level security;
drop policy if exists crm_historical_documents_read on public.crm_historical_documents;
create policy crm_historical_documents_read on public.crm_historical_documents
  for select to authenticated
  using (
    app_private.has_division_resource_access(division_id, 'files', false)
    and app_private.project_links_match_division(division_id, customer_id, property_id)
  );
drop policy if exists crm_historical_documents_insert on public.crm_historical_documents;
create policy crm_historical_documents_insert on public.crm_historical_documents
  for insert to authenticated
  with check (
    app_private.has_division_resource_access(division_id, 'files', true)
    and app_private.project_links_match_division(division_id, customer_id, property_id)
    and (created_by is null or created_by = (select auth.uid()))
  );
drop policy if exists crm_historical_documents_update on public.crm_historical_documents;
create policy crm_historical_documents_update on public.crm_historical_documents
  for update to authenticated
  using (app_private.has_division_resource_access(division_id, 'files', true))
  with check (
    app_private.has_division_resource_access(division_id, 'files', true)
    and app_private.project_links_match_division(division_id, customer_id, property_id)
  );
