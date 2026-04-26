-- Código corto para compartir viajes publicados desde conductor hacia pasajero.
-- Formato: XH-ABC123

ALTER TABLE public.rides
ADD COLUMN IF NOT EXISTS share_code text;

CREATE OR REPLACE FUNCTION public.generate_ride_share_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_code text;
BEGIN
  LOOP
    v_code := 'XH-' || upper(substr(replace(uuid_generate_v4()::text, '-', ''), 1, 6));
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.rides r
      WHERE r.share_code = v_code
    );
  END LOOP;
  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_ride_share_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.share_code IS NULL OR btrim(NEW.share_code) = '' THEN
    NEW.share_code := public.generate_ride_share_code();
  ELSE
    NEW.share_code := upper(btrim(NEW.share_code));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rides_share_code ON public.rides;
CREATE TRIGGER trg_rides_share_code
BEFORE INSERT ON public.rides
FOR EACH ROW
EXECUTE FUNCTION public.ensure_ride_share_code();

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT r.id
    FROM public.rides r
    WHERE r.share_code IS NULL OR btrim(r.share_code) = ''
  LOOP
    UPDATE public.rides
    SET share_code = public.generate_ride_share_code()
    WHERE id = rec.id;
  END LOOP;
END;
$$;

UPDATE public.rides
SET share_code = upper(btrim(share_code))
WHERE share_code IS NOT NULL AND share_code <> upper(btrim(share_code));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'idx_rides_share_code_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_rides_share_code_unique ON public.rides (share_code);
  END IF;
END;
$$;
