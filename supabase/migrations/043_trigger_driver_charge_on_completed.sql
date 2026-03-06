-- Al marcar ride como completed: crear cargo (idempotente), upsert driver_accounts y recalcular deuda/suspensión.

CREATE OR REPLACE FUNCTION process_driver_charge_on_ride_completed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver_id uuid;
  v_fee int;
  v_debt_limit int;
  v_debt int;
BEGIN
  IF NEW.status <> 'completed' OR (OLD.status IS NOT NULL AND OLD.status = 'completed') THEN
    RETURN NEW;
  END IF;

  v_driver_id := NEW.driver_id;
  IF v_driver_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Fee desde pricing_settings activo o default
  SELECT driver_fee_per_completed_ride, driver_debt_limit_default
    INTO v_fee, v_debt_limit
    FROM pricing_settings
   WHERE is_active = true
   LIMIT 1;
  IF v_fee IS NULL THEN
    v_fee := 2000;
    v_debt_limit := 50000;
  END IF;
  IF v_debt_limit IS NULL THEN
    v_debt_limit := 50000;
  END IF;

  -- Insertar cargo (idempotente)
  INSERT INTO driver_charges (ride_id, driver_id, amount_pyg, status)
  VALUES (NEW.id, v_driver_id, v_fee, 'pending')
  ON CONFLICT (ride_id, driver_id) DO NOTHING;

  -- Upsert driver_accounts: crear si no existe, con debt_limit por defecto
  INSERT INTO driver_accounts (driver_id, account_status, debt_pyg, debt_limit_pyg, updated_at)
  VALUES (v_driver_id, 'active', 0, v_debt_limit, now())
  ON CONFLICT (driver_id) DO UPDATE SET updated_at = now();

  -- Recalcular deuda (solo pending)
  SELECT COALESCE(SUM(amount_pyg), 0)::int INTO v_debt
    FROM driver_charges
   WHERE driver_id = v_driver_id AND status = 'pending';

  UPDATE driver_accounts
     SET debt_pyg = v_debt,
         account_status = CASE WHEN v_debt > debt_limit_pyg THEN 'suspended' ELSE 'active' END,
         updated_at = now()
   WHERE driver_id = v_driver_id;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION process_driver_charge_on_ride_completed() IS 'Trigger: al pasar ride a completed, crea driver_charge y actualiza driver_accounts (deuda y suspensión).';

DROP TRIGGER IF EXISTS trigger_driver_charge_on_ride_completed ON rides;
CREATE TRIGGER trigger_driver_charge_on_ride_completed
  AFTER UPDATE OF status ON rides
  FOR EACH ROW
  EXECUTE FUNCTION process_driver_charge_on_ride_completed();
