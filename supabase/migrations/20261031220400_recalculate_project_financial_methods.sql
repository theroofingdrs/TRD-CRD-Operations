-- Keep percentage-based commissions and overhead allocations in sync with actual project activity.
-- This is an additive migration; it does not rewrite or delete existing project records.

CREATE OR REPLACE FUNCTION app_private.recalculate_project_financial_methods(
  p_project_id uuid,
  p_division_id text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  project_row record;
  direct_cost numeric(14,2);
  contract_value numeric(14,2);
  gross_profit numeric(14,2);
  calculated_commission numeric(14,2);
  calculated_overhead numeric(14,2);
BEGIN
  SELECT *
  INTO project_row
  FROM public.crm_projects
  WHERE id = p_project_id AND division_id = p_division_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(sum(amount), 0)
  INTO direct_cost
  FROM public.crm_project_expenses
  WHERE project_id = p_project_id
    AND division_id = p_division_id
    AND payment_status <> 'void'
    AND category NOT IN ('overhead', 'sales_commission');

  contract_value :=
    COALESCE(NULLIF(project_row.contract_amount, 0), project_row.initial_approved_amount, 0)
    + COALESCE(project_row.supplements_approved_amount, 0);
  gross_profit := GREATEST(contract_value - direct_cost, 0);

  calculated_commission := CASE project_row.commission_method
    WHEN 'fixed' THEN COALESCE(project_row.commission_fixed_amount, 0)
    WHEN 'contract_percent' THEN ROUND(contract_value * GREATEST(COALESCE(project_row.commission_rate, 0), 0) / 100, 2)
    WHEN 'collected_percent' THEN ROUND(COALESCE(project_row.collected_amount, 0) * GREATEST(COALESCE(project_row.commission_rate, 0), 0) / 100, 2)
    WHEN 'gross_profit_percent' THEN ROUND(gross_profit * GREATEST(COALESCE(project_row.commission_rate, 0), 0) / 100, 2)
    ELSE COALESCE(project_row.commission_earned_amount, 0)
  END;

  -- Never reduce earned commission below an amount already paid.
  calculated_commission := GREATEST(calculated_commission, COALESCE(project_row.commission_paid_amount, 0));

  calculated_overhead := CASE project_row.overhead_method
    WHEN 'flat' THEN COALESCE(project_row.overhead_fixed_amount, 0)
    WHEN 'contract_percent' THEN ROUND(contract_value * GREATEST(COALESCE(project_row.overhead_rate, 0), 0) / 100, 2)
    WHEN 'direct_cost_percent' THEN ROUND(direct_cost * GREATEST(COALESCE(project_row.overhead_rate, 0), 0) / 100, 2)
    ELSE COALESCE(project_row.overhead_allocated_amount, 0)
  END;

  UPDATE public.crm_projects
  SET commission_earned_amount = calculated_commission,
      overhead_allocated_amount = calculated_overhead,
      updated_at = now()
  WHERE id = p_project_id
    AND division_id = p_division_id
    AND (
      commission_earned_amount IS DISTINCT FROM calculated_commission
      OR overhead_allocated_amount IS DISTINCT FROM calculated_overhead
    );
END;
$function$;
REVOKE ALL ON FUNCTION app_private.recalculate_project_financial_methods(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.recalculate_project_financials_after_project_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  PERFORM app_private.recalculate_project_financial_methods(NEW.id, NEW.division_id);
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.recalculate_project_financials_after_project_update() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER crm_projects_recalculate_financial_methods
  AFTER UPDATE OF
    contract_amount,
    initial_approved_amount,
    supplements_approved_amount,
    collected_amount,
    commission_method,
    commission_rate,
    commission_fixed_amount,
    commission_paid_amount,
    overhead_method,
    overhead_rate,
    overhead_fixed_amount
  ON public.crm_projects
  FOR EACH ROW
  EXECUTE FUNCTION app_private.recalculate_project_financials_after_project_update();

CREATE OR REPLACE FUNCTION app_private.recalculate_project_financials_after_expense_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  target_project_id uuid;
  target_division_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_project_id := OLD.project_id;
    target_division_id := OLD.division_id;
  ELSE
    IF TG_OP = 'UPDATE'
       AND (NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.division_id IS DISTINCT FROM OLD.division_id) THEN
      RAISE EXCEPTION 'A project expense cannot be moved to another project or division';
    END IF;
    target_project_id := NEW.project_id;
    target_division_id := NEW.division_id;
  END IF;

  PERFORM app_private.recalculate_project_financial_methods(target_project_id, target_division_id);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION app_private.recalculate_project_financials_after_expense_change() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER crm_project_expenses_recalculate_financial_methods
  AFTER INSERT OR UPDATE OR DELETE ON public.crm_project_expenses
  FOR EACH ROW
  EXECUTE FUNCTION app_private.recalculate_project_financials_after_expense_change();
