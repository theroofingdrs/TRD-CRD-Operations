
CREATE TABLE IF NOT EXISTS public.crm_maintenance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id text NOT NULL REFERENCES public.crm_divisions(id),
  customer_id uuid NOT NULL REFERENCES public.crm_customers(id),
  property_id uuid NOT NULL REFERENCES public.crm_properties(id),
  roof_id uuid REFERENCES public.crm_roofs(id),
  project_id uuid REFERENCES public.crm_projects(id),
  service_type text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled','in_progress','completed','cancelled','deferred')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),
  scheduled_for timestamptz,
  completed_at timestamptz,
  performed_by uuid REFERENCES auth.users(id),
  description text,
  findings text,
  work_performed text,
  recommendations text,
  materials_used text,
  service_cost numeric(12,2) CHECK (service_cost IS NULL OR service_cost >= 0),
  next_service_due date,
  warranty_until date,
  internal_notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_maintenance_division_customer_idx
  ON public.crm_maintenance_records(division_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_maintenance_property_idx
  ON public.crm_maintenance_records(property_id, scheduled_for DESC);
CREATE INDEX IF NOT EXISTS crm_maintenance_roof_idx
  ON public.crm_maintenance_records(roof_id);
CREATE INDEX IF NOT EXISTS crm_maintenance_project_idx
  ON public.crm_maintenance_records(project_id);

ALTER TABLE public.crm_maintenance_records ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION app_private.maintenance_links_match_division(
  p_division_id text,
  p_customer_id uuid,
  p_property_id uuid,
  p_roof_id uuid,
  p_project_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.crm_properties p
      JOIN public.crm_customer_divisions cd ON cd.customer_id = p.customer_id
      WHERE p.id = p_property_id
        AND p.customer_id = p_customer_id
        AND cd.division_id = p_division_id
    )
    AND (
      p_roof_id IS NULL OR EXISTS (
        SELECT 1 FROM public.crm_roofs r
        WHERE r.id = p_roof_id AND r.property_id = p_property_id
      )
    )
    AND (
      p_project_id IS NULL OR EXISTS (
        SELECT 1 FROM public.crm_projects pr
        WHERE pr.id = p_project_id
          AND pr.division_id = p_division_id
          AND pr.customer_id = p_customer_id
          AND pr.property_id = p_property_id
      )
    );
$function$;

REVOKE ALL ON FUNCTION app_private.maintenance_links_match_division(text, uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.maintenance_links_match_division(text, uuid, uuid, uuid, uuid) TO authenticated;

CREATE POLICY crm_maintenance_select ON public.crm_maintenance_records
  FOR SELECT TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'maintenance', false));

CREATE POLICY crm_maintenance_insert ON public.crm_maintenance_records
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.has_division_resource_access(division_id, 'maintenance', true)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND app_private.maintenance_links_match_division(division_id, customer_id, property_id, roof_id, project_id)
  );

CREATE POLICY crm_maintenance_update ON public.crm_maintenance_records
  FOR UPDATE TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'maintenance', true))
  WITH CHECK (
    app_private.has_division_resource_access(division_id, 'maintenance', true)
    AND app_private.maintenance_links_match_division(division_id, customer_id, property_id, roof_id, project_id)
  );

CREATE POLICY crm_maintenance_delete ON public.crm_maintenance_records
  FOR DELETE TO authenticated
  USING (app_private.has_division_resource_access(division_id, 'maintenance', true));

CREATE OR REPLACE FUNCTION app_private.has_division_resource_access(
  p_division_id text,
  p_resource text,
  p_write boolean DEFAULT false
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.crm_memberships m
    WHERE m.user_id = (SELECT auth.uid())
      AND m.division_id = p_division_id
      AND m.active = true
      AND (
        NOT p_write
        OR m.role IN ('owner','division_admin','office_manager')
        OR (m.role = 'sales_rep' AND p_resource IN ('customers','contacts','properties','leads','appointments','tasks','activity','files','claims'))
        OR (m.role = 'project_manager' AND p_resource IN ('customers','contacts','properties','roofs','appointments','inspections','inspection_items','projects','tasks','activity','files','claims','maintenance'))
        OR (m.role = 'field_inspector' AND p_resource IN ('appointments','inspections','inspection_items','activity','files','maintenance'))
        OR (m.role = 'production_manager' AND p_resource IN ('roofs','inspections','projects','tasks','activity','files','claims','maintenance'))
      )
  );
$function$;

REVOKE ALL ON FUNCTION app_private.has_division_resource_access(text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.has_division_resource_access(text, text, boolean) TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_maintenance_records TO authenticated;
