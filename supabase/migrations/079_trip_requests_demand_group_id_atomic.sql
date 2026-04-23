-- Solución de fondo:
-- - ride_id se mantiene exclusivo para viajes materializados (tabla rides).
-- - demanda agrupada se vincula por trip_requests.demand_group_id -> demand_route_groups.id.
-- - al agrupar, status + demand_group_id se escriben atómicamente.

ALTER TABLE public.trip_requests
ADD COLUMN IF NOT EXISTS demand_group_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trip_requests_demand_group_id_fkey'
  ) THEN
    ALTER TABLE public.trip_requests
      ADD CONSTRAINT trip_requests_demand_group_id_fkey
      FOREIGN KEY (demand_group_id)
      REFERENCES public.demand_route_groups(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_trip_requests_demand_group_id
  ON public.trip_requests (demand_group_id);

CREATE INDEX IF NOT EXISTS idx_trip_requests_status_demand_group_id
  ON public.trip_requests (status, demand_group_id);

-- Backfill para históricos ya agrupados por membresía.
UPDATE public.trip_requests tr
SET demand_group_id = m.group_id
FROM public.demand_route_members m
WHERE tr.id = m.trip_request_id
  AND tr.demand_group_id IS NULL
  AND tr.status = 'grouped';

-- ---------------------------------------------------------------------------
-- Append seguro de una trip_request a grupo existente (v3 hex merge)
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
  SET status = 'grouped', demand_group_id = p_group_id, ride_id = NULL, updated_at = now()
  WHERE id = p_trip_request_id;

  UPDATE public.demand_route_groups
  SET passenger_count = COALESCE(passenger_count, 0) + 1, updated_at = now()
  WHERE id = p_group_id;

  RETURN jsonb_build_object('ok', true, 'group_id', p_group_id, 'trip_request_id', p_trip_request_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Flush corridor bucket: grupo nuevo + membresías
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
    RAISE EXCEPTION 'corridor_group: base trip_request % no existe', base_id;
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
  SET status = 'grouped', demand_group_id = v_gid, ride_id = NULL, updated_at = now()
  WHERE id = ANY (p_ids);

  RETURN jsonb_build_object(
    'flushed', true,
    'group_id', v_gid,
    'members', v_cnt
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Flush hex bucket: grupo nuevo + PICKUP/DROPOFF
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
  SET status = 'grouped', demand_group_id = v_gid, ride_id = NULL, updated_at = now()
  WHERE id = ANY (p_ids);

  RETURN jsonb_build_object(
    'flushed', true,
    'group_id', v_gid,
    'members', v_cnt
  );
END;
$$;
