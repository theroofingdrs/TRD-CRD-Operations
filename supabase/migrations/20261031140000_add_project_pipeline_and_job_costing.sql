-- Project pipeline and job costing foundation.
-- Additive only: existing customer, property, project, claim, proposal, and file records are preserved.
-- Apply only after the migration has been reviewed and tested. This file is not applied to production.

ALTER TABLE public.crm_projects
  ADD COLUMN IF NOT EXISTS pipeline_type text,
  ADD COLUMN IF NOT EXISTS workflow_stage text,
  ADD COLUMN IF NOT EXISTS next_action text,
  ADD COLUMN IF NOT EXISTS next_action_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS original_estimate_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS initial_approved_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS supplements_approved_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoiced_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS collected_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_method text,
  ADD COLUMN IF NOT EXISTS commission_rate numeric(8,4),
  ADD COLUMN IF NOT EXISTS commission_fixed_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS commission_earned_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overhead_method text,
  ADD COLUMN IF NOT EXISTS overhead_rate numeric(8,4),
  ADD COLUMN IF NOT EXISTS overhead_fixed_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS overhead_allocated_amount numeric(14,2) NOT NULL DEFAULT 0;

ALTER TABLE public.crm_projects
  ADD CONSTRAINT crm_projects_pipeline_type_check
    CHECK (pipeline_type IS NULL OR pipeline_type IN ('retail','insurance')),
  ADD CONSTRAINT crm_projects_money_nonnegative_check
    CHECK (
      (original_estimate_amount IS NULL OR original_estimate_amount >= 0)
      AND (initial_approved_amount IS NULL OR initial_approved_amount >= 0)
      AND supplements_approved_amount >= 0
      AND invoiced_amount >= 0
      AND collected_amount >= 0
      AND commission_earned_amount >= 0
      AND commission_paid_amount >= 0
      AND overhead_allocated_amount >= 0
    ),
  ADD CONSTRAINT crm_projects_commission_method_check
    CHECK (commission_method IS NULL OR commission_method IN ('fixed','contract_percent','collected_percent','gross_profit_percent','manual')),
  ADD CONSTRAINT crm_projects_overhead_method_check
    CHECK (overhead_method IS NULL OR overhead_method IN ('flat','contract_percent','direct_cost_percent','manual'));

CREATE INDEX IF NOT EXISTS crm_projects_pipeline_idx
  ON public.crm_projects (division_id, pipeline_type, workflow_stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS crm_projects_next_action_idx
  ON public.crm_projects (division_id, next_action_due_at)
  WHERE next_action_due_at IS NOT NULL;

CREATE TABLE public.crm_project_stage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL REFERENCES public.crm_divisions(id),
  project_id uuid NOT NULL REFERENCES public.crm_projects(id),
  from_stage text,
  to_stage text NOT NULL,
  changed_by uuid REFERENCES auth.users(id),
  note text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_project_stage_history_project_idx
  ON public.crm_project_stage_history (project_id, changed_at DESC);
ALTER TABLE public.crm_project_stage_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_project_stage_history_read ON public.crm_project_stage_history
  FOR SELECT TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'projects', false));
CREATE POLICY crm_project_stage_history_insert ON public.crm_project_stage_history
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.has_division_resource_access(division_id, 'projects', true)
    AND (changed_by IS NULL OR changed_by = (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM public.crm_projects p
      WHERE p.id = project_id AND p.division_id = division_id
    )
  );
GRANT SELECT, INSERT ON public.crm_project_stage_history TO authenticated;

CREATE TABLE public.crm_project_supplements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL REFERENCES public.crm_divisions(id),
  project_id uuid NOT NULL REFERENCES public.crm_projects(id),
  supplement_number integer NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','under_review','approved','partially_approved','denied','resubmitted')),
  requested_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (requested_amount >= 0),
  approved_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (approved_amount >= 0),
  submitted_at timestamptz,
  response_at timestamptz,
  carrier_response text,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, supplement_number)
);
CREATE INDEX crm_project_supplements_project_idx
  ON public.crm_project_supplements (project_id, supplement_number);
ALTER TABLE public.crm_project_supplements ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_project_supplements_read ON public.crm_project_supplements
  FOR SELECT TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'projects', false));
CREATE POLICY crm_project_supplements_insert ON public.crm_project_supplements
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.has_division_resource_access(division_id, 'projects', true)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND EXISTS (SELECT 1 FROM public.crm_projects p WHERE p.id = project_id AND p.division_id = division_id AND p.pipeline_type = 'insurance')
  );
CREATE POLICY crm_project_supplements_update ON public.crm_project_supplements
  FOR UPDATE TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'projects', true))
  WITH CHECK (
    app_private.has_division_resource_access(division_id, 'projects', true)
    AND EXISTS (SELECT 1 FROM public.crm_projects p WHERE p.id = project_id AND p.division_id = division_id AND p.pipeline_type = 'insurance')
  );
GRANT SELECT, INSERT, UPDATE ON public.crm_project_supplements TO authenticated;

CREATE TABLE public.crm_project_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL REFERENCES public.crm_divisions(id),
  project_id uuid NOT NULL REFERENCES public.crm_projects(id),
  category text NOT NULL
    CHECK (category IN ('materials','labor','equipment','permits','sales_commission','overhead','other')),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  vendor_payee text,
  description text,
  payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid','partially_paid','paid','void')),
  paid_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0 AND paid_amount <= amount),
  receipt_file_id uuid REFERENCES public.crm_files(id),
  entered_by uuid REFERENCES auth.users(id),
  notes text,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((payment_status <> 'void') OR (void_reason IS NOT NULL AND length(trim(void_reason)) > 0))
);
CREATE INDEX crm_project_expenses_project_date_idx
  ON public.crm_project_expenses (project_id, expense_date DESC);
CREATE INDEX crm_project_expenses_division_status_idx
  ON public.crm_project_expenses (division_id, payment_status, expense_date DESC);
ALTER TABLE public.crm_project_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_project_expenses_read ON public.crm_project_expenses
  FOR SELECT TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'projects', false));
CREATE POLICY crm_project_expenses_insert ON public.crm_project_expenses
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.has_division_resource_access(division_id, 'projects', true)
    AND (entered_by IS NULL OR entered_by = (SELECT auth.uid()))
    AND EXISTS (SELECT 1 FROM public.crm_projects p WHERE p.id = project_id AND p.division_id = division_id)
    AND (receipt_file_id IS NULL OR EXISTS (
      SELECT 1 FROM public.crm_files f
      WHERE f.id = receipt_file_id AND f.division_id = division_id
        AND f.related_type = 'project' AND f.related_id = project_id
    ))
  );
CREATE POLICY crm_project_expenses_update ON public.crm_project_expenses
  FOR UPDATE TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'projects', true))
  WITH CHECK (
    app_private.has_division_resource_access(division_id, 'projects', true)
    AND EXISTS (SELECT 1 FROM public.crm_projects p WHERE p.id = project_id AND p.division_id = division_id)
  );
GRANT SELECT, INSERT, UPDATE ON public.crm_project_expenses TO authenticated;

CREATE TABLE public.crm_division_financial_settings (
  division_id text PRIMARY KEY REFERENCES public.crm_divisions(id),
  default_commission_method text
    CHECK (default_commission_method IS NULL OR default_commission_method IN ('fixed','contract_percent','collected_percent','gross_profit_percent','manual')),
  default_commission_rate numeric(8,4),
  default_overhead_method text
    CHECK (default_overhead_method IS NULL OR default_overhead_method IN ('flat','contract_percent','direct_cost_percent','manual')),
  default_overhead_rate numeric(8,4),
  default_overhead_fixed_amount numeric(14,2),
  stale_stage_days integer NOT NULL DEFAULT 7 CHECK (stale_stage_days BETWEEN 1 AND 365),
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_division_financial_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_division_financial_settings_read ON public.crm_division_financial_settings
  FOR SELECT TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'projects', false));
CREATE POLICY crm_division_financial_settings_write ON public.crm_division_financial_settings
  FOR ALL TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'projects', true))
  WITH CHECK (app_private.has_division_resource_access(division_id, 'projects', true));
GRANT SELECT, INSERT, UPDATE ON public.crm_division_financial_settings TO authenticated;

-- Reuse the CRM's existing private file bucket and metadata table for receipts.
-- Receipt uploads must be registered with related_type='project' and related_id=the project UUID.
