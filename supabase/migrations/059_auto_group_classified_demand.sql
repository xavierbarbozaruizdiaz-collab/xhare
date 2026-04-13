-- Fase 3: agrupar trip_requests clasificadas (corridor_id + time_bucket) en demand_route_groups/members.
-- No duplica tablas. Geo sync sigue para unclassified; esta ruta es corridor_bucket.

-- ---------------------------------------------------------------------------
-- Metadatos opcionales en grupos (geo_sync = comportamiento histórico)
-- ---------------------------------------------------------------------------
ALTER TABLE public.demand_route_groups
  ADD COLUMN IF NOT EXISTS corridor_id uuid REFERENCES public.corridors(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS time_bucket timestamptz,
  ADD COLUMN IF NOT EXISTS grouping_source text NOT NULL DEFAULT 'geo_sync';

ALTER TABLE public.demand_route_groups DROP CONSTRAINT IF EXISTS demand_route_groups_grouping_source_check;
ALTER TABLE public.demand_route_groups
  ADD CONSTRAINT demand_route_groups_grouping_source_check
  CHECK (grouping_source IN ('geo_sync', 'corridor_bucket'));

COMMENT ON COLUMN public.demand_route_groups.corridor_id IS 'Corredor MVP si el grupo viene de auto_group_classified.';
COMMENT ON COLUMN public.demand_route_groups.time_bucket IS 'Bucket 15m (America/Asuncion) alineado a trip_requests.time_bucket.';
COMMENT ON COLUMN public.demand_route_groups.grouping_source IS 'geo_sync | corridor_bucket';

CREATE INDEX IF NOT EXISTS idx_demand_route_groups_corridor_bucket
  ON public.demand_route_groups (corridor_id, time_bucket)
  WHERE grouping_source = 'corridor_bucket';

-- ---------------------------------------------------------------------------
-- Conductores: poder vincular solicitudes agrupadas al publicar viaje
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Drivers can accept trip_requests (set ride_id and status)" ON public.trip_requests;
CREATE POLICY "Drivers can accept trip_requests (set ride_id and status)"
  ON public.trip_requests FOR UPDATE
  USING (
    status IN ('pending', 'grouped', 'grouping')
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role IN ('driver', 'admin')
    )
  )
  WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Helper: longitud aproximada si falta route_length_km
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._rough_route_length_km(
  lat1 double precision,
  lon1 double precision,
  lat2 double precision,
  lon2 double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT (
    6371.0 * acos(
      LEAST(1.0::double precision, GREATEST(-1.0::double precision,
        cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lon2) - radians(lon1))
        + sin(radians(lat1)) * sin(radians(lat2))
      ))
    )
  )::double precision;
$$;

-- ---------------------------------------------------------------------------
-- Flush un lote: inserta grupo + miembros + status grouped
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._flush_corridor_bucket_batch(
  p_ids uuid[],
  p_corridor_id uuid,
  p_time_bucket timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  base_id uuid;
  base_rec public.trip_requests%ROWTYPE;
  v_poly jsonb;
  v_len double precision;
  v_gid uuid;
  v_id uuid;
  v_cnt int;
BEGIN
  v_cnt := cardinality(p_ids);
  IF v_cnt IS NULL OR v_cnt < 1 THEN
    RETURN jsonb_build_object('flushed', false, 'reason', 'empty_batch');
  END IF;

  base_id := p_ids[1];
  SELECT * INTO base_rec FROM public.trip_requests WHERE id = base_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'auto_group: base trip_request % no existe', base_id;
  END IF;

  v_poly := COALESCE(
    base_rec.route_polyline,
    jsonb_build_array(
      jsonb_build_object('lat', base_rec.origin_lat, 'lng', base_rec.origin_lng),
      jsonb_build_object('lat', base_rec.destination_lat, 'lng', base_rec.destination_lng)
    )
  );

  v_len := base_rec.route_length_km;
  IF v_len IS NULL OR v_len <= 0 THEN
    v_len := public._rough_route_length_km(
      base_rec.origin_lat, base_rec.origin_lng,
      base_rec.destination_lat, base_rec.destination_lng
    );
  END IF;

  INSERT INTO public.demand_route_groups (
    base_polyline,
    base_length_km,
    base_trip_request_id,
    requested_date,
    requested_time,
    origin_city,
    origin_department,
    origin_barrio,
    destination_city,
    destination_department,
    destination_barrio,
    passenger_count,
    corridor_id,
    time_bucket,
    grouping_source,
    updated_at
  ) VALUES (
    v_poly,
    v_len,
    base_id,
    base_rec.requested_date,
    base_rec.requested_time,
    base_rec.origin_city,
    base_rec.origin_department,
    base_rec.origin_barrio,
    base_rec.destination_city,
    base_rec.destination_department,
    base_rec.destination_barrio,
    v_cnt,
    p_corridor_id,
    p_time_bucket,
    'corridor_bucket',
    now()
  )
  RETURNING id INTO v_gid;

  FOREACH v_id IN ARRAY p_ids LOOP
    INSERT INTO public.demand_route_members (group_id, trip_request_id)
    VALUES (v_gid, v_id);
  END LOOP;

  UPDATE public.trip_requests
  SET status = 'grouped', updated_at = now()
  WHERE id = ANY (p_ids);

  RETURN jsonb_build_object(
    'flushed', true,
    'group_id', v_gid,
    'members', v_cnt
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC principal: lotes por (corridor_id, time_bucket), sum(seats) <= p_max_seats, máx 15 solicitudes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_group_classified_trip_requests(p_max_seats int DEFAULT 15)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r RECORD;
  v_corridor uuid;
  v_bucket timestamptz;
  batch_ids uuid[];
  batch_seats int;
  max_seats int;
  groups_created int := 0;
  trip_requests_grouped int := 0;
  flush_res jsonb;
BEGIN
  max_seats := COALESCE(p_max_seats, 15);
  IF max_seats < 1 THEN
    max_seats := 15;
  END IF;

  batch_ids := ARRAY[]::uuid[];
  batch_seats := 0;
  v_corridor := NULL;
  v_bucket := NULL;

  FOR r IN
    SELECT tr.*
    FROM public.trip_requests tr
    WHERE tr.status = 'pending'
      AND tr.classification_status = 'classified'
      AND tr.corridor_id IS NOT NULL
      AND tr.time_bucket IS NOT NULL
      AND tr.seats <= max_seats
      AND NOT EXISTS (
        SELECT 1 FROM public.demand_route_members m WHERE m.trip_request_id = tr.id
      )
    ORDER BY tr.corridor_id, tr.time_bucket, tr.created_at ASC, tr.id ASC
  LOOP
    IF cardinality(batch_ids) > 0 THEN
      IF v_corridor IS DISTINCT FROM r.corridor_id OR v_bucket IS DISTINCT FROM r.time_bucket THEN
        flush_res := public._flush_corridor_bucket_batch(batch_ids, v_corridor, v_bucket);
        IF (flush_res->>'flushed')::boolean THEN
          groups_created := groups_created + 1;
          trip_requests_grouped := trip_requests_grouped + (flush_res->>'members')::int;
        END IF;
        batch_ids := ARRAY[]::uuid[];
        batch_seats := 0;
      END IF;
    END IF;

    IF cardinality(batch_ids) > 0 AND batch_seats + r.seats > max_seats THEN
      flush_res := public._flush_corridor_bucket_batch(batch_ids, v_corridor, v_bucket);
      IF (flush_res->>'flushed')::boolean THEN
        groups_created := groups_created + 1;
        trip_requests_grouped := trip_requests_grouped + (flush_res->>'members')::int;
      END IF;
      batch_ids := ARRAY[]::uuid[];
      batch_seats := 0;
    END IF;

    IF cardinality(batch_ids) >= 15 THEN
      flush_res := public._flush_corridor_bucket_batch(batch_ids, v_corridor, v_bucket);
      IF (flush_res->>'flushed')::boolean THEN
        groups_created := groups_created + 1;
        trip_requests_grouped := trip_requests_grouped + (flush_res->>'members')::int;
      END IF;
      batch_ids := ARRAY[]::uuid[];
      batch_seats := 0;
    END IF;

    IF cardinality(batch_ids) = 0 THEN
      v_corridor := r.corridor_id;
      v_bucket := r.time_bucket;
    END IF;

    batch_ids := array_append(batch_ids, r.id);
    batch_seats := batch_seats + r.seats;
  END LOOP;

  IF cardinality(batch_ids) > 0 THEN
    flush_res := public._flush_corridor_bucket_batch(batch_ids, v_corridor, v_bucket);
    IF (flush_res->>'flushed')::boolean THEN
      groups_created := groups_created + 1;
      trip_requests_grouped := trip_requests_grouped + (flush_res->>'members')::int;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'groups_created', groups_created,
    'trip_requests_grouped', trip_requests_grouped,
    'max_seats_per_group', max_seats
  );
END;
$$;

REVOKE ALL ON FUNCTION public.auto_group_classified_trip_requests(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._flush_corridor_bucket_batch(uuid[], uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_group_classified_trip_requests(int) TO service_role;

COMMENT ON FUNCTION public.auto_group_classified_trip_requests IS
  'Agrupa solicitudes pending+classified por corridor_id+time_bucket; plazas: sum(seats)<=p_max_seats y máx 15 solicitudes.';
