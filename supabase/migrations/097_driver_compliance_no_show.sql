-- Bloqueo operativo (distinto de suspensión por deuda), ventana de inicio en_route, marca de no-show procesado.

ALTER TABLE public.driver_accounts
  ADD COLUMN IF NOT EXISTS operational_blocked_until timestamptz,
  ADD COLUMN IF NOT EXISTS operational_block_reason text;

COMMENT ON COLUMN public.driver_accounts.operational_blocked_until IS
  'Si es futuro, el conductor no puede iniciar viajes (castigo operativo, ej. no-show). Independiente de account_status por deuda.';
COMMENT ON COLUMN public.driver_accounts.operational_block_reason IS
  'Código corto del motivo del bloqueo operativo (ej. no_show_departure).';

ALTER TABLE public.rides
  ADD COLUMN IF NOT EXISTS driver_no_show_processed_at timestamptz;

COMMENT ON COLUMN public.rides.driver_no_show_processed_at IS
  'Cuándo el job de no-show ya sancionó este viaje (idempotencia).';

CREATE INDEX IF NOT EXISTS idx_rides_no_show_cron
  ON public.rides (departure_time, status)
  WHERE driver_no_show_processed_at IS NULL
    AND status IN ('published', 'booked')
    AND driver_id IS NOT NULL;

-- Ventana de inicio: solo entre (departure_time - 5 min) y departure_time inclusive; + bloqueos conductor.
CREATE OR REPLACE FUNCTION public.rides_en_route_departure_and_driver_checks()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  dep timestamptz;
  now_ts timestamptz := now();
  acc RECORD;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'en_route' OR OLD.status = 'en_route' THEN
    RETURN NEW;
  END IF;

  dep := NEW.departure_time;
  IF dep IS NULL THEN
    RAISE EXCEPTION 'ride_missing_departure_time' USING ERRCODE = '23514';
  END IF;

  IF now_ts < (dep - interval '5 minutes') THEN
    RAISE EXCEPTION 'ride_start_too_early' USING ERRCODE = '23514';
  END IF;

  IF now_ts > dep THEN
    RAISE EXCEPTION 'ride_start_too_late' USING ERRCODE = '23514';
  END IF;

  IF NEW.driver_id IS NULL THEN
    RAISE EXCEPTION 'ride_start_no_driver' USING ERRCODE = '23514';
  END IF;

  SELECT account_status, operational_blocked_until, debt_pyg, debt_limit_pyg
  INTO acc
  FROM driver_accounts
  WHERE driver_id = NEW.driver_id;

  IF FOUND THEN
    IF acc.operational_blocked_until IS NOT NULL AND acc.operational_blocked_until > now_ts THEN
      RAISE EXCEPTION 'driver_operationally_blocked' USING ERRCODE = '23514';
    END IF;
    IF acc.account_status = 'suspended' THEN
      RAISE EXCEPTION 'driver_account_suspended' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_rides_en_route_departure_checks ON public.rides;
CREATE TRIGGER trigger_rides_en_route_departure_checks
  BEFORE UPDATE OF status ON public.rides
  FOR EACH ROW
  WHEN (NEW.status = 'en_route' AND (OLD.status IS DISTINCT FROM 'en_route'))
  EXECUTE FUNCTION public.rides_en_route_departure_and_driver_checks();

COMMENT ON FUNCTION public.rides_en_route_departure_and_driver_checks() IS
  'Antes de en_route: ventana T-5m..T (UTC), conductor no bloqueado operativamente ni suspendido.';
