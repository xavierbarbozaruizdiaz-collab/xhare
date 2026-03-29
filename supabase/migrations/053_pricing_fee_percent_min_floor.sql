-- Fee al conductor: % del total cobrado en el viaje (suma price_paid de bookings no canceladas).
-- Piso de tarifa mínima efectiva (tras descuento/redondeo), configurable desde admin.

ALTER TABLE pricing_settings
  ADD COLUMN IF NOT EXISTS driver_fee_percent_of_collected int NOT NULL DEFAULT 10
    CHECK (driver_fee_percent_of_collected >= 0 AND driver_fee_percent_of_collected <= 100);

ALTER TABLE pricing_settings
  ADD COLUMN IF NOT EXISTS min_fare_floor_pyg int NOT NULL DEFAULT 10000
    CHECK (min_fare_floor_pyg >= 0);

COMMENT ON COLUMN pricing_settings.driver_fee_percent_of_collected IS
  'Porcentaje del total cobrado (bookings no canceladas) registrado como cargo al conductor al completar el viaje.';
COMMENT ON COLUMN pricing_settings.min_fare_floor_pyg IS
  'Piso en PYG para la tarifa mínima efectiva (después de descuento y redondeo).';

COMMENT ON COLUMN pricing_settings.driver_fee_per_completed_ride IS
  'Legado (PYG fijo); el trigger usa driver_fee_percent_of_collected.';

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
  v_collected numeric;
  v_percent int;
BEGIN
  IF NEW.status <> 'completed' OR (OLD.status IS NOT NULL AND OLD.status = 'completed') THEN
    RETURN NEW;
  END IF;

  v_driver_id := NEW.driver_id;
  IF v_driver_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT driver_fee_percent_of_collected, driver_debt_limit_default
    INTO v_percent, v_debt_limit
    FROM pricing_settings
   WHERE is_active = true
   LIMIT 1;

  IF v_percent IS NULL THEN
    v_percent := 10;
  END IF;
  IF v_debt_limit IS NULL THEN
    v_debt_limit := 50000;
  END IF;

  SELECT COALESCE(SUM(b.price_paid), 0)::numeric INTO v_collected
    FROM bookings b
   WHERE b.ride_id = NEW.id
     AND b.status <> 'cancelled';

  v_fee := GREATEST(0, ROUND(v_collected * v_percent / 100.0))::int;

  INSERT INTO driver_charges (ride_id, driver_id, amount_pyg, status)
  VALUES (NEW.id, v_driver_id, v_fee, 'pending')
  ON CONFLICT (ride_id, driver_id) DO NOTHING;

  INSERT INTO driver_accounts (driver_id, account_status, debt_pyg, debt_limit_pyg, updated_at)
  VALUES (v_driver_id, 'active', 0, v_debt_limit, now())
  ON CONFLICT (driver_id) DO UPDATE SET updated_at = now();

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

COMMENT ON FUNCTION process_driver_charge_on_ride_completed() IS
  'Trigger: ride completed → driver_charge = round(% × sum(bookings.price_paid) no canceladas); actualiza driver_accounts.';
