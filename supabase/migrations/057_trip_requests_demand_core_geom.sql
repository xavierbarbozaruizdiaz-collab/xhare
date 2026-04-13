-- Fase demanda / agrupación: extender trip_requests (sin duplicar ride_requests ni passenger_ride_requests).
-- PostGIS para origen/destino; ventana horaria en timestamptz; estados grouping/grouped para fases siguientes.
-- accepted = ya usado en todo el repo como “asignada a viaje real” (= assigned del modelo de producto).

-- Supabase: extensión en schema `extensions` (search_path suele incluirla).
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;

ALTER TABLE trip_requests
  ADD COLUMN IF NOT EXISTS requested_mode text NOT NULL DEFAULT 'scheduled',
  ADD COLUMN IF NOT EXISTS requested_time_start timestamptz,
  ADD COLUMN IF NOT EXISTS requested_time_end timestamptz,
  ADD COLUMN IF NOT EXISTS origin_geom geometry(Point, 4326),
  ADD COLUMN IF NOT EXISTS destination_geom geometry(Point, 4326);

ALTER TABLE trip_requests DROP CONSTRAINT IF EXISTS trip_requests_requested_mode_check;
ALTER TABLE trip_requests
  ADD CONSTRAINT trip_requests_requested_mode_check
  CHECK (requested_mode IN ('now', 'scheduled'));

COMMENT ON COLUMN trip_requests.requested_mode IS 'now | scheduled. Viaje inmediato vs fecha/hora elegida (requested_date + requested_time).';
COMMENT ON COLUMN trip_requests.requested_time_start IS 'Inicio ventana deseada (UTC). Si NULL al insert, lo completa el trigger.';
COMMENT ON COLUMN trip_requests.requested_time_end IS 'Fin ventana deseada (UTC). Por defecto start + 90 min alineado a demand-routes/sync.';
COMMENT ON COLUMN trip_requests.origin_geom IS 'PostGIS SRID 4326; se mantiene junto a origin_lat/lng.';
COMMENT ON COLUMN trip_requests.destination_geom IS 'PostGIS SRID 4326; se mantiene junto a destination_lat/lng.';

-- seats = seats_requested (mismo significado; no duplicar columna).

ALTER TABLE trip_requests DROP CONSTRAINT IF EXISTS trip_requests_status_check;
ALTER TABLE trip_requests
  ADD CONSTRAINT trip_requests_status_check
  CHECK (status IN (
    'pending',
    'grouping',
    'grouped',
    'accepted',
    'expired',
    'cancelled',
    'group_linked_pending'
  ));

COMMENT ON COLUMN trip_requests.status IS
  'pending | grouping | grouped | group_linked_pending | accepted (viaje asignado) | expired | cancelled';

CREATE OR REPLACE FUNCTION public.trip_requests_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_mode text;
  v_start timestamptz;
  v_end timestamptz;
BEGIN
  IF NEW.origin_lat IS NULL OR NEW.origin_lng IS NULL OR NEW.destination_lat IS NULL OR NEW.destination_lng IS NULL THEN
    RAISE EXCEPTION 'trip_requests: origen y destino con coordenadas son obligatorios';
  END IF;

  NEW.origin_geom := ST_SetSRID(ST_MakePoint(NEW.origin_lng, NEW.origin_lat), 4326);
  NEW.destination_geom := ST_SetSRID(ST_MakePoint(NEW.destination_lng, NEW.destination_lat), 4326);

  v_mode := COALESCE(NULLIF(trim(NEW.requested_mode), ''), 'scheduled');
  IF v_mode NOT IN ('now', 'scheduled') THEN
    RAISE EXCEPTION 'trip_requests: requested_mode inválido';
  END IF;
  NEW.requested_mode := v_mode;

  IF TG_OP = 'INSERT' THEN
    IF NEW.requested_time_start IS NULL AND NEW.requested_time_end IS NULL THEN
      IF v_mode = 'now' THEN
        v_start := now();
        v_end := now() + interval '90 minutes';
        NEW.requested_date := (now() AT TIME ZONE 'America/Asuncion')::date;
        NEW.requested_time := (now() AT TIME ZONE 'America/Asuncion')::time;
      ELSE
        IF NEW.requested_date IS NULL OR NEW.requested_time IS NULL THEN
          RAISE EXCEPTION 'trip_requests: scheduled requiere requested_date y requested_time';
        END IF;
        v_start := (NEW.requested_date + NEW.requested_time)::timestamp AT TIME ZONE 'America/Asuncion';
        v_end := v_start + interval '90 minutes';
      END IF;
      NEW.requested_time_start := v_start;
      NEW.requested_time_end := v_end;
    ELSIF NEW.requested_time_start IS NULL OR NEW.requested_time_end IS NULL THEN
      RAISE EXCEPTION 'trip_requests: indicá ambos requested_time_start y requested_time_end o ninguno';
    END IF;
  END IF;

  IF NEW.requested_time_start IS NOT NULL
     AND NEW.requested_time_end IS NOT NULL
     AND NEW.requested_time_end < NEW.requested_time_start THEN
    RAISE EXCEPTION 'trip_requests: requested_time_end debe ser >= requested_time_start';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.trip_requests_before_write() SET search_path = public, extensions;

DROP TRIGGER IF EXISTS tr_trip_requests_before_write ON trip_requests;
CREATE TRIGGER tr_trip_requests_before_write
  BEFORE INSERT OR UPDATE OF
    origin_lat, origin_lng, destination_lat, destination_lng,
    requested_date, requested_time, requested_mode,
    requested_time_start, requested_time_end
  ON trip_requests
  FOR EACH ROW
  EXECUTE PROCEDURE public.trip_requests_before_write();

-- Datos existentes: ventana 90 min desde fecha/hora local Paraguay; geometrías.
UPDATE trip_requests
SET
  requested_mode = COALESCE(NULLIF(trim(requested_mode), ''), 'scheduled'),
  requested_time_start = (requested_date + requested_time)::timestamp AT TIME ZONE 'America/Asuncion',
  requested_time_end = (requested_date + requested_time)::timestamp AT TIME ZONE 'America/Asuncion' + interval '90 minutes',
  origin_geom = ST_SetSRID(ST_MakePoint(origin_lng, origin_lat), 4326),
  destination_geom = ST_SetSRID(ST_MakePoint(destination_lng, destination_lat), 4326),
  updated_at = now()
WHERE requested_time_start IS NULL OR requested_time_end IS NULL OR origin_geom IS NULL OR destination_geom IS NULL;

ALTER TABLE trip_requests ALTER COLUMN requested_time_start SET NOT NULL;
ALTER TABLE trip_requests ALTER COLUMN requested_time_end SET NOT NULL;
