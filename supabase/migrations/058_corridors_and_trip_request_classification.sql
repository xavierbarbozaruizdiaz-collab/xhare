-- Fase 2: corredores MVP + clasificación automática en INSERT (sin tocar demand-routes/sync ni rides/bookings).
-- Orden de triggers: `tr_trip_requests_before_write` (geom + ventana) corre antes que `z_*` alfabéticamente.

-- ---------------------------------------------------------------------------
-- Corredores (zonas = bbox JSON: minLat, maxLat, minLng, maxLng)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.corridors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  origin_zone jsonb NOT NULL,
  destination_zone jsonb NOT NULL,
  sort_priority int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_corridors_active_priority ON public.corridors (is_active, sort_priority DESC);

COMMENT ON TABLE public.corridors IS 'Corredores MVP (zonas manuales bbox). sort_priority mayor = más específico primero.';
COMMENT ON COLUMN public.corridors.origin_zone IS 'JSON {"minLat","maxLat","minLng","maxLng"} para origen.';
COMMENT ON COLUMN public.corridors.destination_zone IS 'JSON {"minLat","maxLat","minLng","maxLng"} para destino.';

ALTER TABLE public.corridors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read corridors" ON public.corridors;
CREATE POLICY "Anyone can read corridors"
  ON public.corridors FOR SELECT
  USING (true);

-- ---------------------------------------------------------------------------
-- trip_requests: columnas de clasificación
-- ---------------------------------------------------------------------------
ALTER TABLE public.trip_requests
  ADD COLUMN IF NOT EXISTS corridor_id uuid REFERENCES public.corridors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS time_bucket timestamptz,
  ADD COLUMN IF NOT EXISTS classification_status text NOT NULL DEFAULT 'unclassified',
  ADD COLUMN IF NOT EXISTS origin_node_key text,
  ADD COLUMN IF NOT EXISTS destination_node_key text;

ALTER TABLE public.trip_requests DROP CONSTRAINT IF EXISTS trip_requests_classification_status_check;
ALTER TABLE public.trip_requests
  ADD CONSTRAINT trip_requests_classification_status_check
  CHECK (classification_status IN ('unclassified', 'classified'));

COMMENT ON COLUMN public.trip_requests.corridor_id IS 'Corredor MVP que matchea origen/destino por bbox.';
COMMENT ON COLUMN public.trip_requests.time_bucket IS 'Inicio de bloque 15 min (America/Asuncion) como timestamptz.';
COMMENT ON COLUMN public.trip_requests.classification_status IS 'unclassified | classified';
COMMENT ON COLUMN public.trip_requests.origin_node_key IS 'Nodo origen MVP (slug + coords redondeadas); H3 después.';
COMMENT ON COLUMN public.trip_requests.destination_node_key IS 'Nodo destino MVP (slug + coords redondeadas).';

CREATE INDEX IF NOT EXISTS idx_trip_requests_corridor_time_bucket
  ON public.trip_requests (corridor_id, time_bucket)
  WHERE classification_status = 'classified' AND corridor_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.point_in_corridor_zone(
  p_lat double precision,
  p_lng double precision,
  zone jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT p_lat >= (zone->>'minLat')::double precision
     AND p_lat <= (zone->>'maxLat')::double precision
     AND p_lng >= (zone->>'minLng')::double precision
     AND p_lng <= (zone->>'maxLng')::double precision;
$$;

-- Piso a 15 min en reloj local Paraguay (07:12 → 07:00, 07:26 → 07:15).
CREATE OR REPLACE FUNCTION public.trip_request_time_bucket_15m(p_ts timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  lt timestamp;
  v_mins int;
  v_floor int;
  day0 timestamp;
BEGIN
  IF p_ts IS NULL THEN
    RETURN NULL;
  END IF;
  lt := p_ts AT TIME ZONE 'America/Asuncion';
  day0 := date_trunc('day', lt);
  v_mins := EXTRACT(HOUR FROM lt)::int * 60 + EXTRACT(MINUTE FROM lt)::int;
  v_floor := (v_mins / 15) * 15;
  RETURN (day0 + make_interval(mins => v_floor)) AT TIME ZONE 'America/Asuncion';
END;
$$;

-- ---------------------------------------------------------------------------
-- Clasificación BEFORE INSERT (después de tr_trip_requests_before_write)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.z_trip_requests_classify_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
  v_bucket timestamptz;
  v_round_o_lat text;
  v_round_o_lng text;
  v_round_d_lat text;
  v_round_d_lng text;
BEGIN
  IF NEW.requested_time_start IS NULL THEN
    NEW.classification_status := 'unclassified';
    NEW.time_bucket := NULL;
    NEW.corridor_id := NULL;
    NEW.origin_node_key := NULL;
    NEW.destination_node_key := NULL;
    RETURN NEW;
  END IF;

  v_bucket := public.trip_request_time_bucket_15m(NEW.requested_time_start);
  NEW.time_bucket := v_bucket;
  NEW.corridor_id := NULL;
  NEW.origin_node_key := NULL;
  NEW.destination_node_key := NULL;
  NEW.classification_status := 'unclassified';

  FOR c IN
    SELECT * FROM public.corridors
    WHERE is_active = true
    ORDER BY sort_priority DESC, id ASC
  LOOP
    IF public.point_in_corridor_zone(NEW.origin_lat, NEW.origin_lng, c.origin_zone)
       AND public.point_in_corridor_zone(NEW.destination_lat, NEW.destination_lng, c.destination_zone)
    THEN
      v_round_o_lat := trim(to_char(round(NEW.origin_lat::numeric, 2), 'FM999999990.09'));
      v_round_o_lng := trim(to_char(round(NEW.origin_lng::numeric, 2), 'FM999999990.09'));
      v_round_d_lat := trim(to_char(round(NEW.destination_lat::numeric, 2), 'FM999999990.09'));
      v_round_d_lng := trim(to_char(round(NEW.destination_lng::numeric, 2), 'FM999999990.09'));
      NEW.corridor_id := c.id;
      NEW.classification_status := 'classified';
      NEW.origin_node_key := c.slug || '_o_' || v_round_o_lat || '_' || v_round_o_lng;
      NEW.destination_node_key := c.slug || '_d_' || v_round_d_lat || '_' || v_round_d_lng;
      RETURN NEW;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS z_trip_requests_classify_before_insert ON public.trip_requests;
CREATE TRIGGER z_trip_requests_classify_before_insert
  BEFORE INSERT ON public.trip_requests
  FOR EACH ROW
  EXECUTE PROCEDURE public.z_trip_requests_classify_before_insert();

-- ---------------------------------------------------------------------------
-- Seed MVP (Paraguay — ajustar en producción)
-- ---------------------------------------------------------------------------
INSERT INTO public.corridors (name, slug, origin_zone, destination_zone, sort_priority, is_active)
VALUES
  (
    'Asunción metro (viaje local)',
    'asu_metro_local',
    '{"minLat": -25.42, "maxLat": -25.22, "minLng": -57.68, "maxLng": -57.48}'::jsonb,
    '{"minLat": -25.42, "maxLat": -25.22, "minLng": -57.68, "maxLng": -57.48}'::jsonb,
    20,
    true
  ),
  (
    'Asunción → Ciudad del Este',
    'asu_to_cde',
    '{"minLat": -25.45, "maxLat": -25.20, "minLng": -57.70, "maxLng": -57.45}'::jsonb,
    '{"minLat": -25.56, "maxLat": -25.44, "minLng": -54.66, "maxLng": -54.55}'::jsonb,
    10,
    true
  )
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Backfill filas existentes
-- ---------------------------------------------------------------------------
UPDATE public.trip_requests tr
SET
  time_bucket = b.tb,
  corridor_id = b.cid,
  classification_status = b.cstat,
  origin_node_key = b.onk,
  destination_node_key = b.dnk,
  updated_at = now()
FROM (
  SELECT
    tr0.id AS tid,
    public.trip_request_time_bucket_15m(tr0.requested_time_start) AS tb,
    c.id AS cid,
    CASE WHEN c.id IS NOT NULL THEN 'classified' ELSE 'unclassified' END AS cstat,
    CASE
      WHEN c.id IS NULL THEN NULL::text
      ELSE c.slug || '_o_' || trim(to_char(round(tr0.origin_lat::numeric, 2), 'FM999999990.09')) || '_' ||
           trim(to_char(round(tr0.origin_lng::numeric, 2), 'FM999999990.09'))
    END AS onk,
    CASE
      WHEN c.id IS NULL THEN NULL::text
      ELSE c.slug || '_d_' || trim(to_char(round(tr0.destination_lat::numeric, 2), 'FM999999990.09')) || '_' ||
           trim(to_char(round(tr0.destination_lng::numeric, 2), 'FM999999990.09'))
    END AS dnk
  FROM public.trip_requests tr0
  LEFT JOIN LATERAL (
    SELECT c.*
    FROM public.corridors c
    WHERE c.is_active = true
      AND public.point_in_corridor_zone(tr0.origin_lat, tr0.origin_lng, c.origin_zone)
      AND public.point_in_corridor_zone(tr0.destination_lat, tr0.destination_lng, c.destination_zone)
    ORDER BY c.sort_priority DESC, c.id ASC
    LIMIT 1
  ) c ON true
) b
WHERE tr.id = b.tid
  AND (
    tr.time_bucket IS DISTINCT FROM b.tb
    OR tr.corridor_id IS DISTINCT FROM b.cid
    OR tr.classification_status IS DISTINCT FROM b.cstat
    OR tr.origin_node_key IS DISTINCT FROM b.onk
    OR tr.destination_node_key IS DISTINCT FROM b.dnk
  );
