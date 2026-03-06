-- Al marcar un driver_charge como 'paid', recalcular debt_pyg del conductor y reactivar si queda por debajo del límite.

CREATE OR REPLACE FUNCTION recalc_driver_account_on_charge_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id uuid;
  v_debt int;
BEGIN
  v_driver_id := COALESCE(NEW.driver_id, OLD.driver_id);
  IF v_driver_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT COALESCE(SUM(amount_pyg), 0)::int INTO v_debt
    FROM driver_charges
   WHERE driver_id = v_driver_id AND status = 'pending';

  UPDATE driver_accounts
     SET debt_pyg = v_debt,
         account_status = CASE WHEN v_debt > debt_limit_pyg THEN 'suspended' ELSE 'active' END,
         updated_at = now()
   WHERE driver_id = v_driver_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trigger_recalc_driver_account_on_charge_update ON driver_charges;
CREATE TRIGGER trigger_recalc_driver_account_on_charge_update
  AFTER INSERT OR UPDATE OF status ON driver_charges
  FOR EACH ROW
  EXECUTE FUNCTION recalc_driver_account_on_charge_change();

COMMENT ON FUNCTION recalc_driver_account_on_charge_change() IS 'Recalcula driver_accounts.debt_pyg y account_status cuando cambia un driver_charge (ej. marcar pagado).';
