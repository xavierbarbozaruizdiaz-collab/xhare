-- Código corto de ticket por reserva (ej. A471) para que conductor y pasajero identifiquen el viaje.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS booking_code text;

COMMENT ON COLUMN public.bookings.booking_code IS
  'Código visible del ticket (letra + 3 dígitos, ej. A471). Único en todo el sistema.';

CREATE OR REPLACE FUNCTION public.generate_booking_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_code text;
  v_try int := 0;
BEGIN
  LOOP
    v_code :=
      chr(65 + floor(random() * 26)::int)
      || lpad((floor(random() * 1000))::text, 3, '0');
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.bookings b WHERE b.booking_code = v_code
    );
    v_try := v_try + 1;
    IF v_try > 80 THEN
      v_code :=
        chr(65 + floor(random() * 26)::int)
        || lpad((floor(random() * 10000))::text, 4, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.bookings b WHERE b.booking_code = v_code
      );
    END IF;
    IF v_try > 120 THEN
      RAISE EXCEPTION 'generate_booking_code: no se pudo asignar código único';
    END IF;
  END LOOP;
  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_booking_code_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.booking_code IS NULL OR btrim(NEW.booking_code) = '' THEN
    NEW.booking_code := public.generate_booking_code();
  ELSE
    NEW.booking_code := upper(btrim(NEW.booking_code));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_set_booking_code ON public.bookings;
CREATE TRIGGER trigger_set_booking_code
  BEFORE INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_booking_code_before_insert();

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id FROM public.bookings WHERE booking_code IS NULL OR btrim(booking_code) = ''
  LOOP
    UPDATE public.bookings
    SET booking_code = public.generate_booking_code()
    WHERE id = r.id;
  END LOOP;
END;
$$;

ALTER TABLE public.bookings
  ALTER COLUMN booking_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_booking_code_unique
  ON public.bookings (booking_code);
