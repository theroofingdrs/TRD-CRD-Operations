
CREATE INDEX IF NOT EXISTS crm_maintenance_customer_idx ON public.crm_maintenance_records(customer_id);
CREATE INDEX IF NOT EXISTS crm_maintenance_performed_by_idx ON public.crm_maintenance_records(performed_by);
CREATE INDEX IF NOT EXISTS crm_maintenance_created_by_idx ON public.crm_maintenance_records(created_by);
