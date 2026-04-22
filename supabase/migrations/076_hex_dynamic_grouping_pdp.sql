-- XHARE V2.2: super-hexágonos H3 (res 6), agrupación hex_bucket, miembros PICKUP/DROPOFF + visit_order,
-- ride multi-parada desde create_ride_from_demand_group cuando aplica.

-- ---------------------------------------------------------------------------
-- trip_requests: celdas H3 (string) para match de agrupación dinámica
-- ---------------------------------------------------------------------------
ALTER TABLE public.trip_requests
  ADD COLUMN IF NOT EXISTS origin_super_hex text,
  ADD COLUMN IF NOT EXISTS dest_super_hex text;

CREATE INDEX IF NOT EXISTS idx_trip_requests_hex_pair_pending
  ON public.trip_requests (origin_super_hex, dest_super_hex)
  WHERE status = 'pending'
    AND origin_super_hex IS NOT NULL
    AND dest_super_hex IS NOT NULL;

COMMENT ON COLUMN public.trip_requests.origin_super_hex IS 'H3 res 6 (~4–5 km) en origen; relleno en insert (API/app).';
COMMENT ON COLUMN public.trip_requests.dest_super_hex IS 'H3 res 6 en destino.';

-- ---------------------------------------------------------------------------
-- demand_route_groups: claves hex + meta de optimización
-- ---------------------------------------------------------------------------
ALTER TABLE public.demand_route_groups
  ADD COLUMN IF NOT EXISTS origin_super_hex text,
  ADD COLUMN IF NOT EXISTS dest_super_hex text,
  ADD COLUMN IF NOT EXISTS optimization_meta jsonb;

COMMENT ON COLUMN public.demand_route_groups.optimization_meta IS 'JSON: resultado Google, degradación FIFO, errores.';

ALTER TABLE public.demand_route_groups DROP CONSTRAINT IF EXISTS demand_route_groups_grouping_source_check;
ALTER TABLE public.demand_route_groups
  ADD CONSTRAINT demand_route_groups_grouping_source_check
  CHECK (grouping_source IN ('geo_sync', 'corridor_bucket', 'hex_bucket'));

COMMENT ON COLUMN public.demand_route_groups.grouping_source IS 'geo_sync | corridor_bucket | hex_bucket';

CREATE INDEX IF NOT EXISTS idx_demand_route_groups_hex_pair
  ON public.demand_route_groups (origin_super_hex, dest_super_hex)
  WHERE grouping_source = 'hex_bucket';

-- ---------------------------------------------------------------------------
-- demand_route_members: PICKUP/DROPOFF + visit_order; LEGACY = flujo previo
-- ---------------------------------------------------------------------------
ALTER TABLE public.demand_route_members
  ADD COLUMN IF NOT EXISTS stop_type text NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN IF NOT EXISTS visit_order int;

ALTER TABLE public.demand_route_members DROP CONSTRAINT IF EXISTS demand_route_members_stop_type_check;
ALTER TABLE public.demand_route_members
  ADD CONSTRAINT demand_route_members_stop_type_check
  CHECK (stop_type IN ('LEGACY', 'PICKUP', 'DROPOFF'));

COMMENT ON COLUMN public.demand_route_members.stop_type IS 'LEGACY: una fila por pasajero (geo/corredor). PICKUP/DROPOFF: PDP hex_bucket.';
COMMENT ON COLUMN public.demand_route_members.visit_order IS 'Secuencia global de visita (1..2N) para hex_bucket; NULL en LEGACY.';

ALTER TABLE public.demand_route_members DROP CONSTRAINT IF EXISTS demand_route_members_trip_request_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS demand_route_members_trip_stop_unique
  ON public.demand_route_members (trip_request_id, stop_type);

-- ---------------------------------------------------------------------------
-- Corridor flush: miembros como LEGACY (compat)
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
    INSERT INTO public.demand_route_members (group_id, trip_request_id, stop_type, visit_order)
    VALUES (v_gid, v_id, 'LEGACY', NULL);
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
-- Hex flush: grupo hex_bucket + 2 filas por pasajero (PICKUP / DROPOFF)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._flush_hex_bucket_batch(
  p_ids uuid[],
  p_origin_super_hex text,
  p_dest_super_hex text
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
  v_k int;
BEGIN
  v_cnt := cardinality(p_ids);
  IF v_cnt IS NULL OR v_cnt < 1 THEN
    RETURN jsonb_build_object('flushed', false, 'reason', 'empty_batch');
  END IF;

  base_id := p_ids[1];
  SELECT * INTO base_rec FROM public.trip_requests WHERE id = base_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hex_group: base trip_request % no existe', base_id;
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
    origin_super_hex,
    dest_super_hex,
    optimization_meta,
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
    NULL,
    NULL,
    'hex_bucket',
    p_origin_super_hex,
    p_dest_super_hex,
    jsonb_build_object('engine', 'hex_naive_fifo', 'pickup_count', v_cnt),
    now()
  )
  RETURNING id INTO v_gid;

  v_k := 1;
  FOREACH v_id IN ARRAY p_ids LOOP
    INSERT INTO public.demand_route_members (group_id, trip_request_id, stop_type, visit_order)
    VALUES (v_gid, v_id, 'PICKUP', v_k);
    INSERT INTO public.demand_route_members (group_id, trip_request_id, stop_type, visit_order)
    VALUES (v_gid, v_id, 'DROPOFF', v_cnt + v_k);
    v_k := v_k + 1;
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

REVOKE ALL ON FUNCTION public._flush_hex_bucket_batch(uuid[], text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._flush_hex_bucket_batch(uuid[], text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- RPC: agrupar por par super-hex + solapamiento de ventana extendida ±15m
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_group_hex_trip_requests_v3(p_max_seats int DEFAULT 15)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  g RECORD;
  r RECORD;
  max_seats int;
  batch_ids uuid[];
  batch_seats int;
  flush_res jsonb;
  groups_created int := 0;
  grouped_trips int := 0;
  v_overlap boolean;
  group_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  max_seats := GREATEST(1, COALESCE(p_max_seats, 15));

  FOR g IN
    SELECT tr.origin_super_hex AS ohx, tr.dest_super_hex AS dhx
    FROM public.trip_requests tr
    WHERE tr.status = 'pending'
      AND tr.origin_super_hex IS NOT NULL
      AND tr.dest_super_hex IS NOT NULL
      AND tr.requested_time_start IS NOT NULL
      AND tr.requested_time_end IS NOT NULL
      AND tr.seats <= max_seats
      AND NOT EXISTS (SELECT 1 FROM public.demand_route_members m WHERE m.trip_request_id = tr.id)
    GROUP BY tr.origin_super_hex, tr.dest_super_hex
    ORDER BY tr.origin_super_hex, tr.dest_super_hex
  LOOP
    batch_ids := ARRAY[]::uuid[];
    batch_seats := 0;

    FOR r IN
      SELECT tr.id, tr.seats, tr.requested_time_start, tr.requested_time_end
      FROM public.trip_requests tr
      WHERE tr.status = 'pending'
        AND tr.origin_super_hex = g.ohx
        AND tr.dest_super_hex = g.dhx
        AND tr.requested_time_start IS NOT NULL
        AND tr.requested_time_end IS NOT NULL
        AND tr.seats <= max_seats
        AND NOT EXISTS (SELECT 1 FROM public.demand_route_members m WHERE m.trip_request_id = tr.id)
      ORDER BY tr.created_at ASC, tr.id ASC
    LOOP
      IF cardinality(batch_ids) = 0 THEN
        batch_ids := array_append(batch_ids, r.id);
        batch_seats := r.seats;
        CONTINUE;
      END IF;

      IF batch_seats + r.seats > max_seats OR cardinality(batch_ids) >= 15 THEN
        flush_res := public._flush_hex_bucket_batch(batch_ids, g.ohx, g.dhx);
        IF (flush_res->>'flushed')::boolean THEN
          groups_created := groups_created + 1;
          grouped_trips := grouped_trips + (flush_res->>'members')::int;
          group_ids := array_append(group_ids, (flush_res->>'group_id')::uuid);
        END IF;
        batch_ids := ARRAY[r.id]::uuid[];
        batch_seats := r.seats;
        CONTINUE;
      END IF;

      SELECT EXISTS (
        SELECT 1
        FROM unnest(batch_ids) AS bid(tid)
        JOIN public.trip_requests tb ON tb.id = bid.tid
        WHERE (r.requested_time_start - interval '15 minutes') <= (tb.requested_time_end + interval '15 minutes')
          AND (r.requested_time_end + interval '15 minutes') >= (tb.requested_time_start - interval '15 minutes')
      ) INTO v_overlap;

      IF NOT v_overlap THEN
        flush_res := public._flush_hex_bucket_batch(batch_ids, g.ohx, g.dhx);
        IF (flush_res->>'flushed')::boolean THEN
          groups_created := groups_created + 1;
          grouped_trips := grouped_trips + (flush_res->>'members')::int;
          group_ids := array_append(group_ids, (flush_res->>'group_id')::uuid);
        END IF;
        batch_ids := ARRAY[r.id]::uuid[];
        batch_seats := r.seats;
        CONTINUE;
      END IF;

      batch_ids := array_append(batch_ids, r.id);
      batch_seats := batch_seats + r.seats;
    END LOOP;

    IF cardinality(batch_ids) > 0 THEN
      flush_res := public._flush_hex_bucket_batch(batch_ids, g.ohx, g.dhx);
      IF (flush_res->>'flushed')::boolean THEN
        groups_created := groups_created + 1;
        grouped_trips := grouped_trips + (flush_res->>'members')::int;
        group_ids := array_append(group_ids, (flush_res->>'group_id')::uuid);
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'engine', 'hex_bucket_v3',
    'groups_created', groups_created,
    'trip_requests_grouped', grouped_trips,
    'group_ids', to_jsonb(group_ids),
    'params', jsonb_build_object('max_seats', max_seats)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.auto_group_hex_trip_requests_v3(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_group_hex_trip_requests_v3(int) TO service_role;

COMMENT ON FUNCTION public.auto_group_hex_trip_requests_v3 IS
  'Agrupa pending con mismo H3 origen/destino y ventanas [start-15m,end+15m] con solapamiento; hasta 15 solicitudes y plazas.';

-- ---------------------------------------------------------------------------
-- Ride desde grupo: multi-parada si hay PICKUP/DROPOFF con visit_order
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_ride_from_demand_group(p_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g RECORD;
  v_base_id uuid;
  base_rec public.trip_requests%ROWTYPE;
  v_member_ids uuid[];
  v_sum_seats int;
  v_total int;
  v_dur int;
  v_dep timestamptz;
  v_rid uuid;
  v_name text;
  v_use_pdp boolean;
  v_ord int := 0;
  v_max_visit int;
  rs RECORD;
BEGIN
  IF p_group_id IS NULL THEN
    RAISE EXCEPTION 'create_ride_from_demand_group: group_id requerido';
  END IF;

  SELECT * INTO g FROM public.demand_route_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_ride_from_demand_group: grupo no encontrado';
  END IF;

  IF g.ride_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'ride_id', g.ride_id,
      'group_id', p_group_id,
      'already', true
    );
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.demand_route_members m
    WHERE m.group_id = p_group_id AND m.stop_type IN ('PICKUP', 'DROPOFF')
  ) INTO v_use_pdp;

  IF v_use_pdp THEN
    SELECT array_agg(DISTINCT m.trip_request_id ORDER BY m.trip_request_id)
    INTO v_member_ids
    FROM public.demand_route_members m
    WHERE m.group_id = p_group_id AND m.stop_type IN ('PICKUP', 'DROPOFF');
  ELSE
    SELECT array_agg(m.trip_request_id ORDER BY m.created_at, m.trip_request_id)
    INTO v_member_ids
    FROM public.demand_route_members m
    WHERE m.group_id = p_group_id;
  END IF;

  IF v_member_ids IS NULL OR cardinality(v_member_ids) < 1 THEN
    RAISE EXCEPTION 'create_ride_from_demand_group: el grupo no tiene miembros';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.trip_requests tr
    WHERE tr.id = ANY (v_member_ids)
      AND tr.status IS DISTINCT FROM 'grouped'
  ) THEN
    RAISE EXCEPTION 'create_ride_from_demand_group: todas las solicitudes deben estar en status grouped';
  END IF;

  v_base_id := COALESCE(g.base_trip_request_id, v_member_ids[1]);

  SELECT * INTO base_rec FROM public.trip_requests WHERE id = v_base_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_ride_from_demand_group: trip_request base no encontrada';
  END IF;

  SELECT COALESCE(SUM(tr.seats), 0) INTO v_sum_seats
  FROM public.trip_requests tr
  WHERE tr.id = ANY (v_member_ids);

  v_total := GREATEST(COALESCE(v_sum_seats, 1), 1);
  IF v_total > 15 THEN
    v_total := 15;
  END IF;

  v_dur := GREATEST(
    15,
    LEAST(24 * 60, CEIL((COALESCE(g.base_length_km, 0)::numeric / 40.0) * 60)::int)
  );

  v_dep := (g.requested_date + g.requested_time::time)::timestamp AT TIME ZONE 'America/Asuncion';

  v_name := NULLIF(
    trim(both ' -' FROM concat_ws(' → ', nullif(nullif(trim(g.origin_city), ''), ''), nullif(nullif(trim(g.destination_city), ''), ''))),
    ''
  );
  IF v_name IS NULL THEN
    v_name := 'Demanda agrupada';
  END IF;

  INSERT INTO public.rides (
    mode,
    route_id,
    driver_id,
    capacity,
    status,
    departure_time,
    origin_lat,
    origin_lng,
    origin_label,
    destination_lat,
    destination_lng,
    destination_label,
    price_per_seat,
    available_seats,
    description,
    vehicle_info,
    flexible_departure,
    flexible_return,
    total_seats,
    estimated_duration_minutes,
    departure_flexibility,
    seat_layout,
    base_route_polyline,
    max_deviation_km,
    route_name
  ) VALUES (
    'free',
    NULL,
    NULL,
    v_total,
    'awaiting_driver',
    v_dep,
    base_rec.origin_lat,
    base_rec.origin_lng,
    base_rec.origin_label,
    base_rec.destination_lat,
    base_rec.destination_lng,
    base_rec.destination_label,
    0,
    v_total,
    'Despacho desde grupo de demanda (asignar conductor y precio).',
    NULL,
    false,
    false,
    v_total,
    v_dur,
    'strict_5',
    NULL,
    g.base_polyline,
    1.0,
    v_name
  )
  RETURNING id INTO v_rid;

  IF v_use_pdp THEN
    SELECT COALESCE(MAX(m.visit_order), 0) INTO v_max_visit
    FROM public.demand_route_members m
    WHERE m.group_id = p_group_id AND m.stop_type IN ('PICKUP', 'DROPOFF');

    FOR rs IN
      SELECT
        CASE m.stop_type
          WHEN 'PICKUP' THEN tr.origin_lat
          WHEN 'DROPOFF' THEN tr.destination_lat
        END AS lat,
        CASE m.stop_type
          WHEN 'PICKUP' THEN tr.origin_lng
          WHEN 'DROPOFF' THEN tr.destination_lng
        END AS lng,
        CASE m.stop_type
          WHEN 'PICKUP' THEN tr.origin_label
          WHEN 'DROPOFF' THEN tr.destination_label
        END AS lbl,
        m.visit_order,
        m.stop_type
      FROM public.demand_route_members m
      JOIN public.trip_requests tr ON tr.id = m.trip_request_id
      WHERE m.group_id = p_group_id
        AND m.stop_type IN ('PICKUP', 'DROPOFF')
        AND m.visit_order IS NOT NULL
      ORDER BY m.visit_order ASC
    LOOP
      INSERT INTO public.ride_stops (ride_id, stop_order, lat, lng, label, is_base_stop)
      VALUES (
        v_rid,
        v_ord,
        rs.lat,
        rs.lng,
        COALESCE(rs.lbl, ''),
        (v_ord = 0 OR (rs.visit_order = v_max_visit AND rs.stop_type = 'DROPOFF'))
      );
      v_ord := v_ord + 1;
    END LOOP;
  ELSE
    INSERT INTO public.ride_stops (ride_id, stop_order, lat, lng, label, is_base_stop)
    VALUES
      (v_rid, 0, base_rec.origin_lat, base_rec.origin_lng, base_rec.origin_label, true),
      (v_rid, 1, base_rec.destination_lat, base_rec.destination_lng, base_rec.destination_label, true);
  END IF;

  UPDATE public.demand_route_groups
  SET ride_id = v_rid, updated_at = now()
  WHERE id = p_group_id;

  UPDATE public.trip_requests
  SET ride_id = v_rid, status = 'accepted', updated_at = now()
  WHERE id = ANY (v_member_ids);

  RETURN jsonb_build_object(
    'ok', true,
    'ride_id', v_rid,
    'group_id', p_group_id,
    'already', false,
    'trip_requests_updated', cardinality(v_member_ids),
    'total_seats', v_total,
    'pdp_stops', v_use_pdp
  );
END;
$$;

COMMENT ON FUNCTION public.create_ride_from_demand_group(uuid) IS
  'Crea ride awaiting_driver: 2 paradas legacy (LEGACY) o secuencia PICKUP/DROPOFF por visit_order.';
