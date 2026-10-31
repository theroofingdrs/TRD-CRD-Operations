-- LIVE CRM SCHEMA SNAPSHOT. REFERENCE ONLY.
-- Generated from Supabase project gubvelngdohrfvqeeabu on 2026-10-30.
-- Not a migration. Do not apply to the existing production database.
-- Fresh projects must have Supabase Auth and Storage installed first.
-- User memberships and website intake data are intentionally excluded.

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA app_private TO authenticated;

CREATE TABLE public.crm_activity_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  division_id text NOT NULL,
  actor_id uuid,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  summary text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_activity_events ADD CONSTRAINT crm_activity_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id);
ALTER TABLE public.crm_activity_events ADD CONSTRAINT crm_activity_events_details_check CHECK ((jsonb_typeof(details) = 'object'::text));
ALTER TABLE public.crm_activity_events ADD CONSTRAINT crm_activity_events_division_id_fkey FOREIGN KEY (division_id) REFERENCES crm_divisions(id);
ALTER TABLE public.crm_activity_events ADD CONSTRAINT crm_activity_events_pkey PRIMARY KEY (id);
CREATE TABLE public.crm_appointments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  division_id text NOT NULL,
  lead_id uuid,
  customer_id uuid,
  property_id uuid,
  appointment_type text NOT NULL DEFAULT 'inspection'::text,
  status text NOT NULL DEFAULT 'scheduled'::text,
  starts_at timestamp with time zone NOT NULL,
  ends_at timestamp with time zone,
  assigned_to uuid,
  location_notes text,
  internal_notes text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_appointments ADD CONSTRAINT crm_appointments_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id);
ALTER TABLE public.crm_appointments ADD CONSTRAINT crm_appointments_check CHECK (((ends_at IS NULL) OR (ends_at > starts_at)));
ALTER TABLE public.crm_appointments ADD CONSTRAINT crm_appointments_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.crm_appointments ADD CONSTRAINT crm_appointments_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES crm_customers(id);
ALTER TABLE public.crm_appointments ADD CONSTRAINT crm_appointments_division_id_fkey FOREIGN KEY (division_id) REFERENCES crm_divisions(id);
ALTER TABLE public.crm_appointments ADD CONSTRAINT crm_appointments_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES crm_leads(id);
ALTER TABLE public.crm_appointments ADD CONSTRAINT crm_appointments_pkey PRIMARY KEY (id);
ALTER TABLE public.crm_appointments ADD CONSTRAINT crm_appointments_property_id_fkey FOREIGN KEY (property_id) REFERENCES crm_properties(id);
ALTER TABLE public.crm_appointments ADD CONSTRAINT crm_appointments_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'confirmed'::text, 'completed'::text, 'cancelled'::text, 'no_show'::text, 'rescheduled'::text])));
CREATE TABLE public.crm_contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  full_name text NOT NULL,
  title text,
  email text,
  phone text,
  is_primary boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_contacts ADD CONSTRAINT crm_contacts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES crm_customers(id) ON DELETE CASCADE;
ALTER TABLE public.crm_contacts ADD CONSTRAINT crm_contacts_pkey PRIMARY KEY (id);
CREATE TABLE public.crm_customer_divisions (
  customer_id uuid NOT NULL,
  division_id text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_customer_divisions ADD CONSTRAINT crm_customer_divisions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES crm_customers(id) ON DELETE CASCADE;
ALTER TABLE public.crm_customer_divisions ADD CONSTRAINT crm_customer_divisions_division_id_fkey FOREIGN KEY (division_id) REFERENCES crm_divisions(id);
ALTER TABLE public.crm_customer_divisions ADD CONSTRAINT crm_customer_divisions_pkey PRIMARY KEY (customer_id, division_id);
CREATE TABLE public.crm_customers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_type text NOT NULL,
  display_name text NOT NULL,
  legal_name text,
  email text,
  phone text,
  alternate_phone text,
  preferred_contact_method text,
  notes text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_customers ADD CONSTRAINT crm_customers_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.crm_customers ADD CONSTRAINT crm_customers_customer_type_check CHECK ((customer_type = ANY (ARRAY['individual'::text, 'business'::text, 'property_manager'::text, 'organization'::text])));
ALTER TABLE public.crm_customers ADD CONSTRAINT crm_customers_pkey PRIMARY KEY (id);
ALTER TABLE public.crm_customers ADD CONSTRAINT crm_customers_preferred_contact_method_check CHECK ((preferred_contact_method = ANY (ARRAY['phone'::text, 'email'::text, 'text'::text, 'other'::text])));
CREATE TABLE public.crm_divisions (
  id text NOT NULL,
  name text NOT NULL,
  business_scope text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_divisions ADD CONSTRAINT crm_divisions_id_check CHECK ((id = ANY (ARRAY['TRD'::text, 'CRD'::text])));
ALTER TABLE public.crm_divisions ADD CONSTRAINT crm_divisions_pkey PRIMARY KEY (id);
CREATE TABLE public.crm_files (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  division_id text NOT NULL,
  related_type text NOT NULL,
  related_id uuid NOT NULL,
  bucket_id text NOT NULL DEFAULT 'roof-doctors-private'::text,
  object_path text NOT NULL,
  original_filename text NOT NULL,
  content_type text,
  file_size_bytes bigint,
  uploaded_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_files ADD CONSTRAINT crm_files_bucket_id_object_path_key UNIQUE (bucket_id, object_path);
ALTER TABLE public.crm_files ADD CONSTRAINT crm_files_division_id_fkey FOREIGN KEY (division_id) REFERENCES crm_divisions(id);
ALTER TABLE public.crm_files ADD CONSTRAINT crm_files_pkey PRIMARY KEY (id);
ALTER TABLE public.crm_files ADD CONSTRAINT crm_files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id);
CREATE TABLE public.crm_inspection_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL,
  category text NOT NULL,
  location text,
  observation text NOT NULL,
  severity text,
  recommendation text,
  photo_required boolean NOT NULL DEFAULT false,
  ai_generated boolean NOT NULL DEFAULT false,
  human_verified boolean NOT NULL DEFAULT false,
  verified_by uuid,
  verified_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_inspection_items ADD CONSTRAINT crm_inspection_items_inspection_id_fkey FOREIGN KEY (inspection_id) REFERENCES crm_inspections(id) ON DELETE CASCADE;
ALTER TABLE public.crm_inspection_items ADD CONSTRAINT crm_inspection_items_pkey PRIMARY KEY (id);
ALTER TABLE public.crm_inspection_items ADD CONSTRAINT crm_inspection_items_severity_check CHECK ((severity = ANY (ARRAY['informational'::text, 'minor'::text, 'moderate'::text, 'major'::text, 'critical'::text])));
ALTER TABLE public.crm_inspection_items ADD CONSTRAINT crm_inspection_items_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES auth.users(id);
CREATE TABLE public.crm_inspections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  division_id text NOT NULL,
  appointment_id uuid,
  lead_id uuid,
  customer_id uuid,
  property_id uuid NOT NULL,
  inspector_id uuid,
  status text NOT NULL DEFAULT 'draft'::text,
  inspected_at timestamp with time zone,
  weather_conditions text,
  overall_condition text,
  summary text,
  recommendations text,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_inspections ADD CONSTRAINT crm_inspections_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES crm_appointments(id);
ALTER TABLE public.crm_inspections ADD CONSTRAINT crm_inspections_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES crm_customers(id);
ALTER TABLE public.crm_inspections ADD CONSTRAINT crm_inspections_division_id_fkey FOREIGN KEY (division_id) REFERENCES crm_divisions(id);
ALTER TABLE public.crm_inspections ADD CONSTRAINT crm_inspections_inspector_id_fkey FOREIGN KEY (inspector_id) REFERENCES auth.users(id);
ALTER TABLE public.crm_inspections ADD CONSTRAINT crm_inspections_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES crm_leads(id);
ALTER TABLE public.crm_inspections ADD CONSTRAINT crm_inspections_pkey PRIMARY KEY (id);
ALTER TABLE public.crm_inspections ADD CONSTRAINT crm_inspections_property_id_fkey FOREIGN KEY (property_id) REFERENCES crm_properties(id);
ALTER TABLE public.crm_inspections ADD CONSTRAINT crm_inspections_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id);
ALTER TABLE public.crm_inspections ADD CONSTRAINT crm_inspections_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'in_progress'::text, 'review_required'::text, 'approved'::text, 'completed'::text])));
CREATE TABLE public.crm_leads (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  division_id text NOT NULL,
  customer_id uuid,
  property_id uuid,
  contact_id uuid,
  source text,
  service_interest text,
  status text NOT NULL DEFAULT 'new'::text,
  priority text NOT NULL DEFAULT 'normal'::text,
  assigned_to uuid,
  description text,
  next_follow_up_at timestamp with time zone,
  lost_reason text,
  source_record_id text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id);
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES crm_contacts(id);
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES crm_customers(id);
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_division_id_fkey FOREIGN KEY (division_id) REFERENCES crm_divisions(id);
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_pkey PRIMARY KEY (id);
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])));
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_property_id_fkey FOREIGN KEY (property_id) REFERENCES crm_properties(id);
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_status_check CHECK ((status = ANY (ARRAY['new'::text, 'contacted'::text, 'qualified'::text, 'appointment_set'::text, 'inspection_pending'::text, 'estimate_in_progress'::text, 'proposal_sent'::text, 'won'::text, 'lost'::text, 'on_hold'::text])));
CREATE TABLE public.crm_memberships (
  user_id uuid NOT NULL,
  division_id text NOT NULL,
  role text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_memberships ADD CONSTRAINT crm_memberships_division_id_fkey FOREIGN KEY (division_id) REFERENCES crm_divisions(id);
ALTER TABLE public.crm_memberships ADD CONSTRAINT crm_memberships_pkey PRIMARY KEY (user_id, division_id);
ALTER TABLE public.crm_memberships ADD CONSTRAINT crm_memberships_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'division_admin'::text, 'office_manager'::text, 'sales_rep'::text, 'project_manager'::text, 'field_inspector'::text, 'production_manager'::text, 'accounting'::text, 'read_only'::text])));
ALTER TABLE public.crm_memberships ADD CONSTRAINT crm_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE TABLE public.crm_profiles (
  user_id uuid NOT NULL,
  display_name text,
  email text,
  phone text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_profiles ADD CONSTRAINT crm_profiles_pkey PRIMARY KEY (user_id);
ALTER TABLE public.crm_profiles ADD CONSTRAINT crm_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE TABLE public.crm_projects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  division_id text NOT NULL,
  lead_id uuid,
  customer_id uuid NOT NULL,
  property_id uuid NOT NULL,
  project_name text NOT NULL,
  project_type text,
  status text NOT NULL DEFAULT 'planning'::text,
  project_manager_id uuid,
  start_date date,
  target_completion_date date,
  actual_completion_date date,
  contract_amount numeric(14,2),
  scope_of_work text,
  internal_notes text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_projects ADD CONSTRAINT crm_projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.crm_projects ADD CONSTRAINT crm_projects_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES crm_customers(id);
ALTER TABLE public.crm_projects ADD CONSTRAINT crm_projects_division_id_fkey FOREIGN KEY (division_id) REFERENCES crm_divisions(id);
ALTER TABLE public.crm_projects ADD CONSTRAINT crm_projects_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES crm_leads(id);
ALTER TABLE public.crm_projects ADD CONSTRAINT crm_projects_pkey PRIMARY KEY (id);
ALTER TABLE public.crm_projects ADD CONSTRAINT crm_projects_project_manager_id_fkey FOREIGN KEY (project_manager_id) REFERENCES auth.users(id);
ALTER TABLE public.crm_projects ADD CONSTRAINT crm_projects_property_id_fkey FOREIGN KEY (property_id) REFERENCES crm_properties(id);
ALTER TABLE public.crm_projects ADD CONSTRAINT crm_projects_status_check CHECK ((status = ANY (ARRAY['planning'::text, 'approved'::text, 'scheduled'::text, 'in_progress'::text, 'on_hold'::text, 'substantially_complete'::text, 'completed'::text, 'cancelled'::text])));
CREATE TABLE public.crm_properties (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL,
  property_name text,
  address_line1 text NOT NULL,
  address_line2 text,
  city text NOT NULL,
  state text NOT NULL,
  postal_code text,
  county text,
  property_type text,
  year_built integer,
  square_footage numeric(14,2),
  access_notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_properties ADD CONSTRAINT crm_properties_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES crm_customers(id);
ALTER TABLE public.crm_properties ADD CONSTRAINT crm_properties_pkey PRIMARY KEY (id);
CREATE TABLE public.crm_roofs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  roof_section text,
  roof_type text,
  covering_material text,
  installation_year integer,
  approximate_area_sqft numeric(14,2),
  pitch text,
  layers_count integer,
  condition_summary text,
  warranty_notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_roofs ADD CONSTRAINT crm_roofs_pkey PRIMARY KEY (id);
ALTER TABLE public.crm_roofs ADD CONSTRAINT crm_roofs_property_id_fkey FOREIGN KEY (property_id) REFERENCES crm_properties(id) ON DELETE CASCADE;
CREATE TABLE public.crm_tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  division_id text NOT NULL,
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open'::text,
  priority text NOT NULL DEFAULT 'normal'::text,
  assigned_to uuid,
  due_at timestamp with time zone,
  related_type text,
  related_id uuid,
  created_by uuid,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_tasks ADD CONSTRAINT crm_tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id);
ALTER TABLE public.crm_tasks ADD CONSTRAINT crm_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
ALTER TABLE public.crm_tasks ADD CONSTRAINT crm_tasks_division_id_fkey FOREIGN KEY (division_id) REFERENCES crm_divisions(id);
ALTER TABLE public.crm_tasks ADD CONSTRAINT crm_tasks_pkey PRIMARY KEY (id);
ALTER TABLE public.crm_tasks ADD CONSTRAINT crm_tasks_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])));
ALTER TABLE public.crm_tasks ADD CONSTRAINT crm_tasks_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'blocked'::text, 'completed'::text, 'cancelled'::text])));
INSERT INTO public.crm_divisions (id,name,business_scope,active) VALUES
('TRD','The ROOF Doctors','Residential roofing',true),
('CRD','Commercial ROOF Doctors','Commercial roofing',true)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION app_private.appointment_links_match_division(p_division_id text, p_lead_id uuid, p_customer_id uuid, p_property_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    (p_lead_id IS NULL OR EXISTS (
      SELECT 1 FROM public.crm_leads l
      WHERE l.id = p_lead_id AND l.division_id = p_division_id
    ))
    AND (p_customer_id IS NULL OR EXISTS (
      SELECT 1 FROM public.crm_customer_divisions cd
      WHERE cd.customer_id = p_customer_id AND cd.division_id = p_division_id
    ))
    AND (p_property_id IS NULL OR EXISTS (
      SELECT 1 FROM public.crm_properties p
      JOIN public.crm_customer_divisions cd ON cd.customer_id = p.customer_id
      WHERE p.id = p_property_id AND cd.division_id = p_division_id
    ));
$function$


CREATE OR REPLACE FUNCTION app_private.handle_new_auth_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.crm_profiles (user_id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', split_part(COALESCE(NEW.email,''), '@', 1))
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$function$


CREATE OR REPLACE FUNCTION app_private.has_any_active_membership()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_memberships m
    WHERE m.user_id = (SELECT auth.uid()) AND m.active = true
  );
$function$


CREATE OR REPLACE FUNCTION app_private.has_division_access(p_division_id text, p_write boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
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
        OR m.role <> 'read_only'
      )
  );
$function$


CREATE OR REPLACE FUNCTION app_private.has_division_resource_access(p_division_id text, p_resource text, p_write boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
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
        OR (m.role = 'sales_rep' AND p_resource IN ('customers','contacts','properties','leads','appointments','tasks','activity','files'))
        OR (m.role = 'project_manager' AND p_resource IN ('customers','contacts','properties','roofs','appointments','inspections','inspection_items','projects','tasks','activity','files'))
        OR (m.role = 'field_inspector' AND p_resource IN ('appointments','inspections','inspection_items','activity','files'))
        OR (m.role = 'production_manager' AND p_resource IN ('roofs','inspections','projects','tasks','activity','files'))
      )
  );
$function$


CREATE OR REPLACE FUNCTION app_private.is_crm_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.crm_memberships m
    WHERE m.user_id = (SELECT auth.uid())
      AND m.role = 'owner'
      AND m.active = true
  );
$function$


CREATE OR REPLACE FUNCTION app_private.lead_links_match_division(p_division_id text, p_customer_id uuid, p_property_id uuid, p_contact_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT
    (p_customer_id IS NULL OR EXISTS (
      SELECT 1 FROM public.crm_customer_divisions cd
      WHERE cd.customer_id = p_customer_id AND cd.division_id = p_division_id
    ))
    AND (p_property_id IS NULL OR EXISTS (
      SELECT 1 FROM public.crm_properties p
      JOIN public.crm_customer_divisions cd ON cd.customer_id = p.customer_id
      WHERE p.id = p_property_id AND cd.division_id = p_division_id
    ))
    AND (p_contact_id IS NULL OR EXISTS (
      SELECT 1 FROM public.crm_contacts c
      JOIN public.crm_customer_divisions cd ON cd.customer_id = c.customer_id
      WHERE c.id = p_contact_id AND cd.division_id = p_division_id
    ));
$function$


CREATE OR REPLACE FUNCTION app_private.project_links_match_division(p_division_id text, p_customer_id uuid, p_property_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_properties p
    JOIN public.crm_customer_divisions cd ON cd.customer_id = p.customer_id
    WHERE p.id = p_property_id
      AND p.customer_id = p_customer_id
      AND cd.division_id = p_division_id
  );
$function$


CREATE OR REPLACE FUNCTION app_private.property_in_division(p_division_id text, p_property_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.crm_properties p
    JOIN public.crm_customer_divisions cd ON cd.customer_id = p.customer_id
    WHERE p.id = p_property_id AND cd.division_id = p_division_id
  );
$function$


CREATE OR REPLACE FUNCTION app_private.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$


REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.appointment_links_match_division(p_division_id text, p_lead_id uuid, p_customer_id uuid, p_property_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.has_any_active_membership() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.has_division_access(p_division_id text, p_write boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.has_division_resource_access(p_division_id text, p_resource text, p_write boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.is_crm_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.lead_links_match_division(p_division_id text, p_customer_id uuid, p_property_id uuid, p_contact_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.project_links_match_division(p_division_id text, p_customer_id uuid, p_property_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.property_in_division(p_division_id text, p_property_id uuid) TO authenticated;

CREATE INDEX crm_activity_actor_idx ON public.crm_activity_events USING btree (actor_id);
CREATE INDEX crm_activity_entity_idx ON public.crm_activity_events USING btree (division_id, entity_type, entity_id, created_at DESC);
CREATE INDEX crm_appointments_assigned_idx ON public.crm_appointments USING btree (assigned_to);
CREATE INDEX crm_appointments_created_by_idx ON public.crm_appointments USING btree (created_by);
CREATE INDEX crm_appointments_customer_idx ON public.crm_appointments USING btree (customer_id);
CREATE INDEX crm_appointments_division_start_idx ON public.crm_appointments USING btree (division_id, starts_at);
CREATE INDEX crm_appointments_lead_idx ON public.crm_appointments USING btree (lead_id);
CREATE INDEX crm_appointments_property_idx ON public.crm_appointments USING btree (property_id);
CREATE INDEX crm_contacts_customer_idx ON public.crm_contacts USING btree (customer_id);
CREATE INDEX crm_customer_divisions_division_idx ON public.crm_customer_divisions USING btree (division_id, customer_id);
CREATE INDEX crm_customers_created_by_idx ON public.crm_customers USING btree (created_by);
CREATE INDEX crm_files_related_idx ON public.crm_files USING btree (division_id, related_type, related_id);
CREATE INDEX crm_files_uploaded_by_idx ON public.crm_files USING btree (uploaded_by);
CREATE INDEX crm_inspection_items_inspection_idx ON public.crm_inspection_items USING btree (inspection_id);
CREATE INDEX crm_inspection_items_verified_by_idx ON public.crm_inspection_items USING btree (verified_by);
CREATE INDEX crm_inspections_appointment_idx ON public.crm_inspections USING btree (appointment_id);
CREATE INDEX crm_inspections_customer_idx ON public.crm_inspections USING btree (customer_id);
CREATE INDEX crm_inspections_division_idx ON public.crm_inspections USING btree (division_id);
CREATE INDEX crm_inspections_inspector_idx ON public.crm_inspections USING btree (inspector_id);
CREATE INDEX crm_inspections_lead_idx ON public.crm_inspections USING btree (lead_id);
CREATE INDEX crm_inspections_property_idx ON public.crm_inspections USING btree (property_id, inspected_at DESC);
CREATE INDEX crm_inspections_reviewed_by_idx ON public.crm_inspections USING btree (reviewed_by);
CREATE INDEX crm_leads_assigned_idx ON public.crm_leads USING btree (assigned_to, status);
CREATE INDEX crm_leads_contact_idx ON public.crm_leads USING btree (contact_id);
CREATE INDEX crm_leads_created_by_idx ON public.crm_leads USING btree (created_by);
CREATE INDEX crm_leads_customer_idx ON public.crm_leads USING btree (customer_id);
CREATE INDEX crm_leads_division_status_idx ON public.crm_leads USING btree (division_id, status, created_at DESC);
CREATE INDEX crm_leads_property_idx ON public.crm_leads USING btree (property_id);
CREATE INDEX crm_memberships_division_idx ON public.crm_memberships USING btree (division_id);
CREATE INDEX crm_projects_created_by_idx ON public.crm_projects USING btree (created_by);
CREATE INDEX crm_projects_customer_idx ON public.crm_projects USING btree (customer_id);
CREATE INDEX crm_projects_division_status_idx ON public.crm_projects USING btree (division_id, status);
CREATE INDEX crm_projects_lead_idx ON public.crm_projects USING btree (lead_id);
CREATE INDEX crm_projects_manager_idx ON public.crm_projects USING btree (project_manager_id);
CREATE INDEX crm_projects_property_idx ON public.crm_projects USING btree (property_id);
CREATE INDEX crm_properties_customer_idx ON public.crm_properties USING btree (customer_id);
CREATE INDEX crm_roofs_property_idx ON public.crm_roofs USING btree (property_id);
CREATE INDEX crm_tasks_assignee_due_idx ON public.crm_tasks USING btree (assigned_to, due_at) WHERE (status <> 'completed'::text);
CREATE INDEX crm_tasks_created_by_idx ON public.crm_tasks USING btree (created_by);
CREATE INDEX crm_tasks_division_idx ON public.crm_tasks USING btree (division_id);
CREATE TRIGGER crm_appointments_set_updated_at BEFORE UPDATE ON crm_appointments FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();
CREATE TRIGGER crm_contacts_set_updated_at BEFORE UPDATE ON crm_contacts FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();
CREATE TRIGGER crm_customers_set_updated_at BEFORE UPDATE ON crm_customers FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();
CREATE TRIGGER crm_inspections_set_updated_at BEFORE UPDATE ON crm_inspections FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();
CREATE TRIGGER crm_leads_set_updated_at BEFORE UPDATE ON crm_leads FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();
CREATE TRIGGER crm_memberships_set_updated_at BEFORE UPDATE ON crm_memberships FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();
CREATE TRIGGER crm_profiles_set_updated_at BEFORE UPDATE ON crm_profiles FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();
CREATE TRIGGER crm_projects_set_updated_at BEFORE UPDATE ON crm_projects FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();
CREATE TRIGGER crm_properties_set_updated_at BEFORE UPDATE ON crm_properties FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();
CREATE TRIGGER crm_roofs_set_updated_at BEFORE UPDATE ON crm_roofs FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();
CREATE TRIGGER crm_tasks_set_updated_at BEFORE UPDATE ON crm_tasks FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();
CREATE TRIGGER on_crm_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION app_private.handle_new_auth_user();
ALTER TABLE public.crm_activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_customer_divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_inspection_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_roofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY crm_activity_events_insert ON public.crm_activity_events FOR INSERT TO authenticated WITH CHECK ((app_private.has_division_resource_access(division_id, 'activity'::text, true) AND ((actor_id IS NULL) OR (actor_id = ( SELECT auth.uid() AS uid)))));
CREATE POLICY crm_activity_events_read ON public.crm_activity_events FOR SELECT TO authenticated USING (app_private.has_division_resource_access(division_id, 'activity'::text, false));
CREATE POLICY crm_appointments_delete ON public.crm_appointments FOR DELETE TO authenticated USING (app_private.is_crm_owner());
CREATE POLICY crm_appointments_insert ON public.crm_appointments FOR INSERT TO authenticated WITH CHECK ((app_private.has_division_resource_access(division_id, 'appointments'::text, true) AND ((created_by IS NULL) OR (created_by = ( SELECT auth.uid() AS uid))) AND app_private.appointment_links_match_division(division_id, lead_id, customer_id, property_id)));
CREATE POLICY crm_appointments_read ON public.crm_appointments FOR SELECT TO authenticated USING (app_private.has_division_resource_access(division_id, 'appointments'::text, false));
CREATE POLICY crm_appointments_update ON public.crm_appointments FOR UPDATE TO authenticated USING (app_private.has_division_resource_access(division_id, 'appointments'::text, true)) WITH CHECK ((app_private.has_division_resource_access(division_id, 'appointments'::text, true) AND app_private.appointment_links_match_division(division_id, lead_id, customer_id, property_id)));
CREATE POLICY crm_contacts_delete ON public.crm_contacts FOR DELETE TO authenticated USING (app_private.is_crm_owner());
CREATE POLICY crm_contacts_insert ON public.crm_contacts FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM crm_customer_divisions cd
  WHERE ((cd.customer_id = crm_contacts.customer_id) AND app_private.has_division_resource_access(cd.division_id, 'contacts'::text, true)))));
CREATE POLICY crm_contacts_read ON public.crm_contacts FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM crm_customer_divisions cd
  WHERE ((cd.customer_id = crm_contacts.customer_id) AND app_private.has_division_resource_access(cd.division_id, 'contacts'::text, false)))));
CREATE POLICY crm_contacts_update ON public.crm_contacts FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM crm_customer_divisions cd
  WHERE ((cd.customer_id = crm_contacts.customer_id) AND app_private.has_division_resource_access(cd.division_id, 'contacts'::text, true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM crm_customer_divisions cd
  WHERE ((cd.customer_id = crm_contacts.customer_id) AND app_private.has_division_resource_access(cd.division_id, 'contacts'::text, true)))));
CREATE POLICY crm_customer_divisions_delete ON public.crm_customer_divisions FOR DELETE TO authenticated USING (app_private.is_crm_owner());
CREATE POLICY crm_customer_divisions_insert ON public.crm_customer_divisions FOR INSERT TO authenticated WITH CHECK (app_private.has_division_resource_access(division_id, 'customers'::text, true));
CREATE POLICY crm_customer_divisions_read ON public.crm_customer_divisions FOR SELECT TO authenticated USING (app_private.has_division_resource_access(division_id, 'customers'::text, false));
CREATE POLICY crm_customer_divisions_update ON public.crm_customer_divisions FOR UPDATE TO authenticated USING (app_private.has_division_resource_access(division_id, 'customers'::text, true)) WITH CHECK (app_private.has_division_resource_access(division_id, 'customers'::text, true));
CREATE POLICY crm_customers_delete ON public.crm_customers FOR DELETE TO authenticated USING (app_private.is_crm_owner());
CREATE POLICY crm_customers_insert ON public.crm_customers FOR INSERT TO authenticated WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND app_private.has_any_active_membership()));
CREATE POLICY crm_customers_read ON public.crm_customers FOR SELECT TO authenticated USING (((created_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM crm_customer_divisions cd
  WHERE ((cd.customer_id = crm_customers.id) AND app_private.has_division_resource_access(cd.division_id, 'customers'::text, false))))));
CREATE POLICY crm_customers_update ON public.crm_customers FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM crm_customer_divisions cd
  WHERE ((cd.customer_id = crm_customers.id) AND app_private.has_division_resource_access(cd.division_id, 'customers'::text, true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM crm_customer_divisions cd
  WHERE ((cd.customer_id = crm_customers.id) AND app_private.has_division_resource_access(cd.division_id, 'customers'::text, true)))));
CREATE POLICY crm_divisions_member_read ON public.crm_divisions FOR SELECT TO authenticated USING (app_private.has_division_access(id, false));
CREATE POLICY crm_files_delete ON public.crm_files FOR DELETE TO authenticated USING (app_private.is_crm_owner());
CREATE POLICY crm_files_insert ON public.crm_files FOR INSERT TO authenticated WITH CHECK ((app_private.has_division_resource_access(division_id, 'files'::text, true) AND ((uploaded_by IS NULL) OR (uploaded_by = ( SELECT auth.uid() AS uid)))));
CREATE POLICY crm_files_read ON public.crm_files FOR SELECT TO authenticated USING (app_private.has_division_resource_access(division_id, 'files'::text, false));
CREATE POLICY crm_files_update ON public.crm_files FOR UPDATE TO authenticated USING (app_private.is_crm_owner()) WITH CHECK (app_private.is_crm_owner());
CREATE POLICY crm_inspection_items_delete ON public.crm_inspection_items FOR DELETE TO authenticated USING (app_private.is_crm_owner());
CREATE POLICY crm_inspection_items_insert ON public.crm_inspection_items FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM crm_inspections i
  WHERE ((i.id = crm_inspection_items.inspection_id) AND app_private.has_division_resource_access(i.division_id, 'inspection_items'::text, true)))));
CREATE POLICY crm_inspection_items_read ON public.crm_inspection_items FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM crm_inspections i
  WHERE ((i.id = crm_inspection_items.inspection_id) AND app_private.has_division_resource_access(i.division_id, 'inspections'::text, false)))));
CREATE POLICY crm_inspection_items_update ON public.crm_inspection_items FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM crm_inspections i
  WHERE ((i.id = crm_inspection_items.inspection_id) AND app_private.has_division_resource_access(i.division_id, 'inspection_items'::text, true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM crm_inspections i
  WHERE ((i.id = crm_inspection_items.inspection_id) AND app_private.has_division_resource_access(i.division_id, 'inspection_items'::text, true)))));
CREATE POLICY crm_inspections_delete ON public.crm_inspections FOR DELETE TO authenticated USING (app_private.is_crm_owner());
CREATE POLICY crm_inspections_insert ON public.crm_inspections FOR INSERT TO authenticated WITH CHECK ((app_private.has_division_resource_access(division_id, 'inspections'::text, true) AND app_private.property_in_division(division_id, property_id)));
CREATE POLICY crm_inspections_read ON public.crm_inspections FOR SELECT TO authenticated USING (app_private.has_division_resource_access(division_id, 'inspections'::text, false));
CREATE POLICY crm_inspections_update ON public.crm_inspections FOR UPDATE TO authenticated USING (app_private.has_division_resource_access(division_id, 'inspections'::text, true)) WITH CHECK ((app_private.has_division_resource_access(division_id, 'inspections'::text, true) AND app_private.property_in_division(division_id, property_id)));
CREATE POLICY crm_leads_delete ON public.crm_leads FOR DELETE TO authenticated USING (app_private.is_crm_owner());
CREATE POLICY crm_leads_insert ON public.crm_leads FOR INSERT TO authenticated WITH CHECK ((app_private.has_division_resource_access(division_id, 'leads'::text, true) AND ((created_by IS NULL) OR (created_by = ( SELECT auth.uid() AS uid))) AND app_private.lead_links_match_division(division_id, customer_id, property_id, contact_id)));
CREATE POLICY crm_leads_read ON public.crm_leads FOR SELECT TO authenticated USING (app_private.has_division_resource_access(division_id, 'leads'::text, false));
CREATE POLICY crm_leads_update ON public.crm_leads FOR UPDATE TO authenticated USING (app_private.has_division_resource_access(division_id, 'leads'::text, true)) WITH CHECK ((app_private.has_division_resource_access(division_id, 'leads'::text, true) AND app_private.lead_links_match_division(division_id, customer_id, property_id, contact_id)));
CREATE POLICY crm_memberships_owner_delete ON public.crm_memberships FOR DELETE TO authenticated USING (app_private.is_crm_owner());
CREATE POLICY crm_memberships_owner_insert ON public.crm_memberships FOR INSERT TO authenticated WITH CHECK (app_private.is_crm_owner());
CREATE POLICY crm_memberships_owner_update ON public.crm_memberships FOR UPDATE TO authenticated USING (app_private.is_crm_owner()) WITH CHECK (app_private.is_crm_owner());
CREATE POLICY crm_memberships_self_read ON public.crm_memberships FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR app_private.is_crm_owner()));
CREATE POLICY crm_profiles_self_read ON public.crm_profiles FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR app_private.is_crm_owner()));
CREATE POLICY crm_profiles_self_update ON public.crm_profiles FOR UPDATE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR app_private.is_crm_owner())) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) OR app_private.is_crm_owner()));
CREATE POLICY crm_projects_delete ON public.crm_projects FOR DELETE TO authenticated USING (app_private.is_crm_owner());
CREATE POLICY crm_projects_insert ON public.crm_projects FOR INSERT TO authenticated WITH CHECK ((app_private.has_division_resource_access(division_id, 'projects'::text, true) AND ((created_by IS NULL) OR (created_by = ( SELECT auth.uid() AS uid))) AND app_private.project_links_match_division(division_id, customer_id, property_id)));
CREATE POLICY crm_projects_read ON public.crm_projects FOR SELECT TO authenticated USING (app_private.has_division_resource_access(division_id, 'projects'::text, false));
CREATE POLICY crm_projects_update ON public.crm_projects FOR UPDATE TO authenticated USING (app_private.has_division_resource_access(division_id, 'projects'::text, true)) WITH CHECK ((app_private.has_division_resource_access(division_id, 'projects'::text, true) AND app_private.project_links_match_division(division_id, customer_id, property_id)));
CREATE POLICY crm_properties_delete ON public.crm_properties FOR DELETE TO authenticated USING (app_private.is_crm_owner());
CREATE POLICY crm_properties_insert ON public.crm_properties FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM crm_customer_divisions cd
  WHERE ((cd.customer_id = crm_properties.customer_id) AND app_private.has_division_resource_access(cd.division_id, 'properties'::text, true)))));
CREATE POLICY crm_properties_read ON public.crm_properties FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM crm_customer_divisions cd
  WHERE ((cd.customer_id = crm_properties.customer_id) AND app_private.has_division_resource_access(cd.division_id, 'properties'::text, false)))));
CREATE POLICY crm_properties_update ON public.crm_properties FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM crm_customer_divisions cd
  WHERE ((cd.customer_id = crm_properties.customer_id) AND app_private.has_division_resource_access(cd.division_id, 'properties'::text, true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM crm_customer_divisions cd
  WHERE ((cd.customer_id = crm_properties.customer_id) AND app_private.has_division_resource_access(cd.division_id, 'properties'::text, true)))));
CREATE POLICY crm_roofs_delete ON public.crm_roofs FOR DELETE TO authenticated USING (app_private.is_crm_owner());
CREATE POLICY crm_roofs_insert ON public.crm_roofs FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (crm_properties p
     JOIN crm_customer_divisions cd ON ((cd.customer_id = p.customer_id)))
  WHERE ((p.id = crm_roofs.property_id) AND app_private.has_division_resource_access(cd.division_id, 'roofs'::text, true)))));
CREATE POLICY crm_roofs_read ON public.crm_roofs FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (crm_properties p
     JOIN crm_customer_divisions cd ON ((cd.customer_id = p.customer_id)))
  WHERE ((p.id = crm_roofs.property_id) AND app_private.has_division_resource_access(cd.division_id, 'roofs'::text, false)))));
CREATE POLICY crm_roofs_update ON public.crm_roofs FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (crm_properties p
     JOIN crm_customer_divisions cd ON ((cd.customer_id = p.customer_id)))
  WHERE ((p.id = crm_roofs.property_id) AND app_private.has_division_resource_access(cd.division_id, 'roofs'::text, true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (crm_properties p
     JOIN crm_customer_divisions cd ON ((cd.customer_id = p.customer_id)))
  WHERE ((p.id = crm_roofs.property_id) AND app_private.has_division_resource_access(cd.division_id, 'roofs'::text, true)))));
CREATE POLICY crm_tasks_delete ON public.crm_tasks FOR DELETE TO authenticated USING (app_private.is_crm_owner());
CREATE POLICY crm_tasks_insert ON public.crm_tasks FOR INSERT TO authenticated WITH CHECK ((app_private.has_division_resource_access(division_id, 'tasks'::text, true) AND ((created_by IS NULL) OR (created_by = ( SELECT auth.uid() AS uid)))));
CREATE POLICY crm_tasks_read ON public.crm_tasks FOR SELECT TO authenticated USING (app_private.has_division_resource_access(division_id, 'tasks'::text, false));
CREATE POLICY crm_tasks_update ON public.crm_tasks FOR UPDATE TO authenticated USING (app_private.has_division_resource_access(division_id, 'tasks'::text, true)) WITH CHECK (app_private.has_division_resource_access(division_id, 'tasks'::text, true));
GRANT REFERENCES ON TABLE public.crm_activity_events TO anon;
GRANT TRIGGER ON TABLE public.crm_activity_events TO anon;
GRANT TRUNCATE ON TABLE public.crm_activity_events TO anon;
GRANT INSERT ON TABLE public.crm_activity_events TO authenticated;
GRANT REFERENCES ON TABLE public.crm_activity_events TO authenticated;
GRANT SELECT ON TABLE public.crm_activity_events TO authenticated;
GRANT TRIGGER ON TABLE public.crm_activity_events TO authenticated;
GRANT TRUNCATE ON TABLE public.crm_activity_events TO authenticated;
GRANT REFERENCES ON TABLE public.crm_activity_events TO service_role;
GRANT TRIGGER ON TABLE public.crm_activity_events TO service_role;
GRANT TRUNCATE ON TABLE public.crm_activity_events TO service_role;
GRANT REFERENCES ON TABLE public.crm_appointments TO anon;
GRANT TRIGGER ON TABLE public.crm_appointments TO anon;
GRANT TRUNCATE ON TABLE public.crm_appointments TO anon;
GRANT DELETE ON TABLE public.crm_appointments TO authenticated;
GRANT INSERT ON TABLE public.crm_appointments TO authenticated;
GRANT REFERENCES ON TABLE public.crm_appointments TO authenticated;
GRANT SELECT ON TABLE public.crm_appointments TO authenticated;
GRANT TRIGGER ON TABLE public.crm_appointments TO authenticated;
GRANT TRUNCATE ON TABLE public.crm_appointments TO authenticated;
GRANT UPDATE ON TABLE public.crm_appointments TO authenticated;
GRANT REFERENCES ON TABLE public.crm_appointments TO service_role;
GRANT TRIGGER ON TABLE public.crm_appointments TO service_role;
GRANT TRUNCATE ON TABLE public.crm_appointments TO service_role;
GRANT REFERENCES ON TABLE public.crm_contacts TO anon;
GRANT TRIGGER ON TABLE public.crm_contacts TO anon;
GRANT TRUNCATE ON TABLE public.crm_contacts TO anon;
GRANT DELETE ON TABLE public.crm_contacts TO authenticated;
GRANT INSERT ON TABLE public.crm_contacts TO authenticated;
GRANT REFERENCES ON TABLE public.crm_contacts TO authenticated;
GRANT SELECT ON TABLE public.crm_contacts TO authenticated;
GRANT TRIGGER ON TABLE public.crm_contacts TO authenticated;
GRANT TRUNCATE ON TABLE public.crm_contacts TO authenticated;
GRANT UPDATE ON TABLE public.crm_contacts TO authenticated;
GRANT REFERENCES ON TABLE public.crm_contacts TO service_role;
GRANT TRIGGER ON TABLE public.crm_contacts TO service_role;
GRANT TRUNCATE ON TABLE public.crm_contacts TO service_role;
GRANT REFERENCES ON TABLE public.crm_customer_divisions TO anon;
GRANT TRIGGER ON TABLE public.crm_customer_divisions TO anon;
GRANT TRUNCATE ON TABLE public.crm_customer_divisions TO anon;
GRANT DELETE ON TABLE public.crm_customer_divisions TO authenticated;
GRANT INSERT ON TABLE public.crm_customer_divisions TO authenticated;
GRANT REFERENCES ON TABLE public.crm_customer_divisions TO authenticated;
GRANT SELECT ON TABLE public.crm_customer_divisions TO authenticated;
GRANT TRIGGER ON TABLE public.crm_customer_divisions TO authenticated;
GRANT TRUNCATE ON TABLE public.crm_customer_divisions TO authenticated;
GRANT UPDATE ON TABLE public.crm_customer_divisions TO authenticated;
GRANT REFERENCES ON TABLE public.crm_customer_divisions TO service_role;
GRANT TRIGGER ON TABLE public.crm_customer_divisions TO service_role;
GRANT TRUNCATE ON TABLE public.crm_customer_divisions TO service_role;
GRANT REFERENCES ON TABLE public.crm_customers TO anon;
GRANT TRIGGER ON TABLE public.crm_customers TO anon;
GRANT TRUNCATE ON TABLE public.crm_customers TO anon;
GRANT DELETE ON TABLE public.crm_customers TO authenticated;
GRANT INSERT ON TABLE public.crm_customers TO authenticated;
GRANT REFERENCES ON TABLE public.crm_customers TO authenticated;
GRANT SELECT ON TABLE public.crm_customers TO authenticated;
GRANT TRIGGER ON TABLE public.crm_customers TO authenticated;
GRANT TRUNCATE ON TABLE public.crm_customers TO authenticated;
GRANT UPDATE ON TABLE public.crm_customers TO authenticated;
GRANT REFERENCES ON TABLE public.crm_customers TO service_role;
GRANT TRIGGER ON TABLE public.crm_customers TO service_role;
GRANT TRUNCATE ON TABLE public.crm_customers TO service_role;
GRANT REFERENCES ON TABLE public.crm_divisions TO anon;
GRANT TRIGGER ON TABLE public.crm_divisions TO anon;
GRANT TRUNCATE ON TABLE public.crm_divisions TO anon;
GRANT REFERENCES ON TABLE public.crm_divisions TO authenticated;
GRANT SELECT ON TABLE public.crm_divisions TO authenticated;
GRANT TRIGGER ON TABLE public.crm_divisions TO authenticated;
GRANT TRUNCATE ON TABLE public.crm_divisions TO authenticated;
GRANT REFERENCES ON TABLE public.crm_divisions TO service_role;
GRANT TRIGGER ON TABLE public.crm_divisions TO service_role;
GRANT TRUNCATE ON TABLE public.crm_divisions TO service_role;
GRANT REFERENCES ON TABLE public.crm_files TO anon;
GRANT TRIGGER ON TABLE public.crm_files TO anon;
GRANT TRUNCATE ON TABLE public.crm_files TO anon;
GRANT DELETE ON TABLE public.crm_files TO authenticated;
GRANT INSERT ON TABLE public.crm_files TO authenticated;
GRANT REFERENCES ON TABLE public.crm_files TO authenticated;
GRANT SELECT ON TABLE public.crm_files TO authenticated;
GRANT TRIGGER ON TABLE public.crm_files TO authenticated;
GRANT TRUNCATE ON TABLE public.crm_files TO authenticated;
GRANT UPDATE ON TABLE public.crm_files TO authenticated;
GRANT REFERENCES ON TABLE public.crm_files TO service_role;
GRANT TRIGGER ON TABLE public.crm_files TO service_role;
GRANT TRUNCATE ON TABLE public.crm_files TO service_role;
GRANT REFERENCES ON TABLE public.crm_inspection_items TO anon;
GRANT TRIGGER ON TABLE public.crm_inspection_items TO anon;
GRANT TRUNCATE ON TABLE public.crm_inspection_items TO anon;
GRANT DELETE ON TABLE public.crm_inspection_items TO authenticated;
GRANT INSERT ON TABLE public.crm_inspection_items TO authenticated;
GRANT REFERENCES ON TABLE public.crm_inspection_items TO authenticated;
GRANT SELECT ON TABLE public.crm_inspection_items TO authenticated;
GRANT TRIGGER ON TABLE public.crm_inspection_items TO authenticated;
GRANT TRUNCATE ON TABLE public.crm_inspection_items TO authenticated;
GRANT UPDATE ON TABLE public.crm_inspection_items TO authenticated;
GRANT REFERENCES ON TABLE public.crm_inspection_items TO service_role;
GRANT TRIGGER ON TABLE public.crm_inspection_items TO service_role;
GRANT TRUNCATE ON TABLE public.crm_inspection_items TO service_role;
GRANT REFERENCES ON TABLE public.crm_inspections TO anon;
GRANT TRIGGER ON TABLE public.crm_inspections TO anon;
GRANT TRUNCATE ON TABLE public.crm_inspections TO anon;
GRANT DELETE ON TABLE public.crm_inspections TO authenticated;
GRANT INSERT ON TABLE public.crm_inspections TO authenticated;
GRANT REFERENCES ON TABLE public.crm_inspections TO authenticated;
GRANT SELECT ON TABLE public.crm_inspections TO authenticated;
GRANT TRIGGER ON TABLE public.crm_inspections TO authenticated;
GRANT TRUNCATE ON TABLE public.crm_inspections TO authenticated;
GRANT UPDATE ON TABLE public.crm_inspections TO authenticated;
GRANT REFERENCES ON TABLE public.crm_inspections TO service_role;
GRANT TRIGGER ON TABLE public.crm_inspections TO service_role;
GRANT TRUNCATE ON TABLE public.crm_inspections TO service_role;
GRANT REFERENCES ON TABLE public.crm_leads TO anon;
GRANT TRIGGER ON TABLE public.crm_leads TO anon;
GRANT TRUNCATE ON TABLE public.crm_leads TO anon;
GRANT DELETE ON TABLE public.crm_leads TO authenticated;
GRANT INSERT ON TABLE public.crm_leads TO authenticated;
GRANT REFERENCES ON TABLE public.crm_leads TO authenticated;
GRANT SELECT ON TABLE public.crm_leads TO authenticated;
GRANT TRIGGER ON TABLE public.crm_leads TO authenticated;
GRANT TRUNCATE ON TABLE public.crm_leads TO authenticated;
GRANT UPDATE ON TABLE public.crm_leads TO authenticated;
GRANT REFERENCES ON TABLE public.crm_leads TO service_role;
GRANT TRIGGER ON TABLE public.crm_leads TO service_role;
GRANT TRUNCATE ON TABLE public.crm_leads TO service_role;
GRANT REFERENCES ON TABLE public.crm_memberships TO anon;
GRANT TRIGGER ON TABLE public.crm_memberships TO anon;
GRANT TRUNCATE ON TABLE public.crm_memberships TO anon;
GRANT REFERENCES ON TABLE public.crm_memberships TO authenticated;
GRANT SELECT ON TABLE public.crm_memberships TO authenticated;
GRANT TRIGGER ON TABLE public.crm_memberships TO authenticated;
GRANT TRUNCATE ON TABLE public.crm_memberships TO authenticated;
GRANT REFERENCES ON TABLE public.crm_memberships TO service_role;
GRANT TRIGGER ON TABLE public.crm_memberships TO service_role;
GRANT TRUNCATE ON TABLE public.crm_memberships TO service_role;
GRANT REFERENCES ON TABLE public.crm_profiles TO anon;
GRANT TRIGGER ON TABLE public.crm_profiles TO anon;
GRANT TRUNCATE ON TABLE public.crm_profiles TO anon;
GRANT REFERENCES ON TABLE public.crm_profiles TO authenticated;
GRANT SELECT ON TABLE public.crm_profiles TO authenticated;
GRANT TRIGGER ON TABLE public.crm_profiles TO authenticated;
GRANT TRUNCATE ON TABLE public.crm_profiles TO authenticated;
GRANT UPDATE ON TABLE public.crm_profiles TO authenticated;
GRANT REFERENCES ON TABLE public.crm_profiles TO service_role;
GRANT TRIGGER ON TABLE public.crm_profiles TO service_role;
GRANT TRUNCATE ON TABLE public.crm_profiles TO service_role;
GRANT REFERENCES ON TABLE public.crm_projects TO anon;
GRANT TRIGGER ON TABLE public.crm_projects TO anon;
GRANT TRUNCATE ON TABLE public.crm_projects TO anon;
GRANT DELETE ON TABLE public.crm_projects TO authenticated;
GRANT INSERT ON TABLE public.crm_projects TO authenticated;
GRANT REFERENCES ON TABLE public.crm_projects TO authenticated;
GRANT SELECT ON TABLE public.crm_projects TO authenticated;
GRANT TRIGGER ON TABLE public.crm_projects TO authenticated;
GRANT TRUNCATE ON TABLE public.crm_projects TO authenticated;
GRANT UPDATE ON TABLE public.crm_projects TO authenticated;
GRANT REFERENCES ON TABLE public.crm_projects TO service_role;
GRANT TRIGGER ON TABLE public.crm_projects TO service_role;
GRANT TRUNCATE ON TABLE public.crm_projects TO service_role;
GRANT REFERENCES ON TABLE public.crm_properties TO anon;
GRANT TRIGGER ON TABLE public.crm_properties TO anon;
GRANT TRUNCATE ON TABLE public.crm_properties TO anon;
GRANT DELETE ON TABLE public.crm_properties TO authenticated;
GRANT INSERT ON TABLE public.crm_properties TO authenticated;
GRANT REFERENCES ON TABLE public.crm_properties TO authenticated;
GRANT SELECT ON TABLE public.crm_properties TO authenticated;
GRANT TRIGGER ON TABLE public.crm_properties TO authenticated;
GRANT TRUNCATE ON TABLE public.crm_properties TO authenticated;
GRANT UPDATE ON TABLE public.crm_properties TO authenticated;
GRANT REFERENCES ON TABLE public.crm_properties TO service_role;
GRANT TRIGGER ON TABLE public.crm_properties TO service_role;
GRANT TRUNCATE ON TABLE public.crm_properties TO service_role;
GRANT REFERENCES ON TABLE public.crm_roofs TO anon;
GRANT TRIGGER ON TABLE public.crm_roofs TO anon;
GRANT TRUNCATE ON TABLE public.crm_roofs TO anon;
GRANT DELETE ON TABLE public.crm_roofs TO authenticated;
GRANT INSERT ON TABLE public.crm_roofs TO authenticated;
GRANT REFERENCES ON TABLE public.crm_roofs TO authenticated;
GRANT SELECT ON TABLE public.crm_roofs TO authenticated;
GRANT TRIGGER ON TABLE public.crm_roofs TO authenticated;
GRANT TRUNCATE ON TABLE public.crm_roofs TO authenticated;
GRANT UPDATE ON TABLE public.crm_roofs TO authenticated;
GRANT REFERENCES ON TABLE public.crm_roofs TO service_role;
GRANT TRIGGER ON TABLE public.crm_roofs TO service_role;
GRANT TRUNCATE ON TABLE public.crm_roofs TO service_role;
GRANT REFERENCES ON TABLE public.crm_tasks TO anon;
GRANT TRIGGER ON TABLE public.crm_tasks TO anon;
GRANT TRUNCATE ON TABLE public.crm_tasks TO anon;
GRANT DELETE ON TABLE public.crm_tasks TO authenticated;
GRANT INSERT ON TABLE public.crm_tasks TO authenticated;
GRANT REFERENCES ON TABLE public.crm_tasks TO authenticated;
GRANT SELECT ON TABLE public.crm_tasks TO authenticated;
GRANT TRIGGER ON TABLE public.crm_tasks TO authenticated;
GRANT TRUNCATE ON TABLE public.crm_tasks TO authenticated;
GRANT UPDATE ON TABLE public.crm_tasks TO authenticated;
GRANT REFERENCES ON TABLE public.crm_tasks TO service_role;
GRANT TRIGGER ON TABLE public.crm_tasks TO service_role;
GRANT TRUNCATE ON TABLE public.crm_tasks TO service_role;
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types) VALUES ('roof-doctors-private','roof-doctors-private',false,15728640,ARRAY['image/jpeg','image/png','image/webp','application/pdf']) ON CONFLICT (id) DO NOTHING;
CREATE POLICY crm_private_files_delete ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'roof-doctors-private'::text) AND app_private.is_crm_owner()));
CREATE POLICY crm_private_files_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'roof-doctors-private'::text) AND app_private.has_division_resource_access((storage.foldername(name))[1], 'files'::text, true)));
CREATE POLICY crm_private_files_read ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'roof-doctors-private'::text) AND app_private.has_division_resource_access((storage.foldername(name))[1], 'files'::text, false)));
CREATE POLICY crm_private_files_update ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'roof-doctors-private'::text) AND app_private.has_division_resource_access((storage.foldername(name))[1], 'files'::text, true))) WITH CHECK (((bucket_id = 'roof-doctors-private'::text) AND app_private.has_division_resource_access((storage.foldername(name))[1], 'files'::text, true)));
