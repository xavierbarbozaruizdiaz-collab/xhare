-- V3 final: merge agresivo en grupos hex existentes + tolerancia de vecinos (aprox k-ring 1)
-- Regla: no crear grupo nuevo si existe uno compatible (<15 min) con cupo.

-- ---------------------------------------------------------------------------
-- Append seguro de una trip_request a grupo existente
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._append_trip_request_to_group(
  p_group_id uuid,
  p_trip_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_group public.demand_route_groups%ROWTYPE;
  v_tr public.trip_requests%ROWTYPE;
  v_max_visit int;
  v_use_pdp boolean;
BEGIN
  IF p_group_id IS NULL OR p_trip_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_args');
  END IF;

  SELECT * INTO v_group
  FROM public.demand_route_groups
  WHERE id = p_group_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'group_not_found');
  END IF;

  IF v_group.ride_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'group_already_materialized');
  END IF;

  SELECT * INTO v_tr
  FROM public.trip_requests
  WHERE id = p_trip_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trip_not_found');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.demand_route_members m
    WHERE m.trip_request_id = p_trip_request_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trip_already_grouped');
  END IF;

  IF v_tr.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'trip_not_pending');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.demand_route_members m
    WHERE m.group_id = p_group_id
      AND m.stop_type IN ('PICKUP', 'DROPOFF')
  ) INTO v_use_pdp;

  IF v_use_pdp THEN
    SELECT COALESCE(MAX(m.visit_order), 0)
    INTO v_max_visit
    FROM public.demand_route_members m
    WHERE m.group_id = p_group_id
      AND m.stop_type IN ('PICKUP', 'DROPOFF');

    INSERT INTO public.demand_route_members (group_id, trip_request_id, stop_type, visit_order)
    VALUES
      (p_group_id, p_trip_request_id, 'PICKUP', v_max_visit + 1),
      (p_group_id, p_trip_request_id, 'DROPOFF', v_max_visit + 2);
  ELSE
    INSERT INTO public.demand_route_members (group_id, trip_request_id, stop_type, visit_order)
    VALUES (p_group_id, p_trip_request_id, 'LEGACY', NULL);
  END IF;

  UPDATE public.trip_requests
  SET status = 'grouped', updated_at = now()
  WHERE id = p_trip_request_id;

  UPDATE public.demand_route_groups
  SET passenger_count = COALESCE(passenger_count, 0) + 1, updated_at = now()
  WHERE id = p_group_id;

  RETURN jsonb_build_object('ok', true, 'group_id', p_group_id, 'trip_request_id', p_trip_request_id);
END;
$$;

REVOKE ALL ON FUNCTION public._append_trip_request_to_group(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._append_trip_request_to_group(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- RPC v3 (merge-first): intenta anexar a grupo existente, y solo crea nuevo si no hay match.
-- Tolerancia vecina (k=1 aproximado): distancia origen/destino por centro <= p_neighbor_km.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.auto_group_hex_trip_requests_v3(int);

CREATE OR REPLACE FUNCTION public.auto_group_hex_trip_requests_v3(
  p_max_seats int DEFAULT 15,
  p_neighbor_km double precision DEFAULT 6.0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  r RECORD;
  max_seats int;
  neighbor_km double precision;
  v_group_id uuid;
  v_group_seats int;
  v_append jsonb;
  v_flush jsonb;
  group_ids uuid[] := ARRAY[]::uuid[];
  grouped_trips int := 0;
  groups_created int := 0;
  groups_merged int := 0;
BEGIN
  max_seats := GREATEST(1, COALESCE(p_max_seats, 15));
  neighbor_km := GREATEST(0.1, COALESCE(p_neighbor_km, 6.0));

  FOR r IN
    SELECT
      tr.id,
      tr.seats,
      tr.origin_super_hex,
      tr.dest_super_hex,
      tr.origin_lat,
      tr.origin_lng,
      tr.destination_lat,
      tr.destination_lng,
      tr.requested_time_start
    FROM public.trip_requests tr
    WHERE tr.status = 'pending'
      AND tr.origin_super_hex IS NOT NULL
      AND tr.dest_super_hex IS NOT NULL
      AND tr.requested_time_start IS NOT NULL
      AND tr.requested_time_end IS NOT NULL
      AND tr.seats <= max_seats
      AND NOT EXISTS (SELECT 1 FROM public.demand_route_members m WHERE m.trip_request_id = tr.id)
    ORDER BY tr.created_at ASC, tr.id ASC
  LOOP
    v_group_id := NULL;

    SELECT dg.id
    INTO v_group_id
    FROM public.demand_route_groups dg
    JOIN public.trip_requests base_tr ON base_tr.id = dg.base_trip_request_id
    WHERE dg.grouping_source = 'hex_bucket'
      AND dg.ride_id IS NULL
      AND COALESCE(dg.passenger_count, 0) < 15
      AND (
        abs(
          EXTRACT(
            EPOCH FROM (
              ((dg.requested_date + dg.requested_time)::timestamp AT TIME ZONE 'America/Asuncion')
              - r.requested_time_start
            )
          )
        ) / 60.0
      ) <= 15.0
      AND (
        (dg.origin_super_hex = r.origin_super_hex AND dg.dest_super_hex = r.dest_super_hex)
        OR (
          public._rough_route_length_km(base_tr.origin_lat, base_tr.origin_lng, r.origin_lat, r.origin_lng) <= neighbor_km
          AND public._rough_route_length_km(base_tr.destination_lat, base_tr.destination_lng, r.destination_lat, r.destination_lng) <= neighbor_km
        )
      )
    ORDER BY
      abs(
        EXTRACT(
          EPOCH FROM (
            ((dg.requested_date + dg.requested_time)::timestamp AT TIME ZONE 'America/Asuncion')
            - r.requested_time_start
          )
        )
      ) ASC,
      COALESCE(dg.passenger_count, 0) DESC
    LIMIT 1;

    IF v_group_id IS NOT NULL THEN
      SELECT COALESCE(SUM(tr2.seats), 0)
      INTO v_group_seats
      FROM (
        SELECT DISTINCT m.trip_request_id
        FROM public.demand_route_members m
        WHERE m.group_id = v_group_id
          AND m.stop_type IN ('PICKUP', 'LEGACY')
      ) x
      JOIN public.trip_requests tr2 ON tr2.id = x.trip_request_id;

      IF v_group_seats + r.seats <= max_seats THEN
        v_append := public._append_trip_request_to_group(v_group_id, r.id);
        IF COALESCE((v_append->>'ok')::boolean, false) THEN
          grouped_trips := grouped_trips + 1;
          groups_merged := groups_merged + 1;
          IF NOT (v_group_id = ANY(group_ids)) THEN
            group_ids := array_append(group_ids, v_group_id);
          END IF;
          CONTINUE;
        END IF;
      END IF;
    END IF;

    v_flush := public._flush_hex_bucket_batch(ARRAY[r.id]::uuid[], r.origin_super_hex, r.dest_super_hex);
    IF COALESCE((v_flush->>'flushed')::boolean, false) THEN
      grouped_trips := grouped_trips + 1;
      groups_created := groups_created + 1;
      v_group_id := (v_flush->>'group_id')::uuid;
      IF NOT (v_group_id = ANY(group_ids)) THEN
        group_ids := array_append(group_ids, v_group_id);
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'engine', 'hex_bucket_v3_merge',
    'groups_created', groups_created,
    'groups_merged', groups_merged,
    'trip_requests_grouped', grouped_trips,
    'group_ids', to_jsonb(group_ids),
    'params', jsonb_build_object(
      'max_seats', max_seats,
      'neighbor_km', neighbor_km,
      'time_tolerance_min', 15
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.auto_group_hex_trip_requests_v3(int, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_group_hex_trip_requests_v3(int, double precision) TO service_role;

COMMENT ON FUNCTION public.auto_group_hex_trip_requests_v3 IS
  'Merge-first: agrega pending a grupos hex existentes (<=15 min) y solo crea nuevos si no hay match; tolera vecinos por proximidad km (k-ring1 aproximado).';
