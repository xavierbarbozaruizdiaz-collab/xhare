-- Fase 4: demand_route_groups → rides reales (sin conductor, awaiting_driver).
-- No crea bookings; trip_requests pasan a accepted + ride_id.

-- ---------------------------------------------------------------------------
-- Grupo → ride (1:1)
-- ---------------------------------------------------------------------------
ALTER TABLE public.demand_route_groups
  ADD COLUMN IF NOT EXISTS ride_id uuid REFERENCES public.rides(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_demand_route_groups_ride_id_unique
  ON public.demand_route_groups (ride_id)
  WHERE ride_id IS NOT NULL;

COMMENT ON COLUMN public.demand_route_groups.ride_id IS 'Viaje creado desde este grupo (dispatch).';

-- ---------------------------------------------------------------------------
-- Estado operativo para viajes sin conductor asignado
-- ---------------------------------------------------------------------------
ALTER TABLE public.rides DROP CONSTRAINT IF EXISTS rides_status_check;
ALTER TABLE public.rides
  ADD CONSTRAINT rides_status_check
  CHECK (status IN (
    'draft',
    'awaiting_driver',
    'published',
    'booked',
    'en_route',
    'completed',
    'cancelled'
  ));

COMMENT ON COLUMN public.rides.status IS
  'draft | awaiting_driver (dispatch sin chofer) | published | booked | en_route | completed | cancelled';

-- ---------------------------------------------------------------------------
-- Lectura: awaiting_driver para conductores/admin y pasajeros con trip_request al viaje
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view published rides" ON public.rides;
CREATE POLICY "Anyone can view published rides"
  ON public.rides FOR SELECT
  USING (
    status = 'published'
    OR (
      status = 'en_route'
      AND available_seats > 0
      AND auth.uid() IS NOT NULL
    )
    OR (
      status = 'awaiting_driver'
      AND auth.uid() IS NOT NULL
      AND (
        public.is_admin(auth.uid())
        OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'driver')
        OR EXISTS (
          SELECT 1 FROM public.trip_requests tr
          WHERE tr.ride_id = rides.id AND tr.user_id = auth.uid()
        )
      )
    )
    OR driver_id = auth.uid()
    OR public.is_admin(auth.uid())
    OR public.passenger_has_non_cancelled_booking(id)
  );

COMMENT ON POLICY "Anyone can view published rides" ON public.rides IS
  'Publicados; en_route con cupo (sesión); awaiting_driver para admin/driver o pasajeros vinculados por trip_request; conductor dueño; admin; reservas.';

DROP POLICY IF EXISTS "Anyone can view stops for published rides" ON public.ride_stops;
CREATE POLICY "Anyone can view stops for published rides"
  ON public.ride_stops FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.rides r
      WHERE r.id = ride_stops.ride_id
        AND (
          r.status = 'published'
          OR (
            r.status = 'en_route'
            AND r.available_seats > 0
            AND auth.uid() IS NOT NULL
          )
          OR (
            r.status = 'awaiting_driver'
            AND auth.uid() IS NOT NULL
            AND (
              public.is_admin(auth.uid())
              OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'driver')
              OR EXISTS (
                SELECT 1 FROM public.trip_requests tr
                WHERE tr.ride_id = r.id AND tr.user_id = auth.uid()
              )
            )
          )
          OR r.driver_id = auth.uid()
          OR public.is_admin(auth.uid())
          OR public.passenger_has_non_cancelled_booking(r.id)
        )
    )
  );

-- ---------------------------------------------------------------------------
-- RPC: crear ride + paradas + vincular trip_requests y grupo
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

  SELECT array_agg(m.trip_request_id ORDER BY m.created_at, m.trip_request_id)
  INTO v_member_ids
  FROM public.demand_route_members m
  WHERE m.group_id = p_group_id;

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

  v_base_id := COALESCE(
    g.base_trip_request_id,
    v_member_ids[1]
  );

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

  INSERT INTO public.ride_stops (ride_id, stop_order, lat, lng, label, is_base_stop)
  VALUES
    (
      v_rid,
      0,
      base_rec.origin_lat,
      base_rec.origin_lng,
      base_rec.origin_label,
      true
    ),
    (
      v_rid,
      1,
      base_rec.destination_lat,
      base_rec.destination_lng,
      base_rec.destination_label,
      true
    );

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
    'total_seats', v_total
  );
END;
$$;

COMMENT ON FUNCTION public.create_ride_from_demand_group(uuid) IS
  'Crea ride awaiting_driver desde demand_route_group, paradas base, vincula trip_requests → accepted. Idempotente si ride_id ya existe.';

REVOKE ALL ON FUNCTION public.create_ride_from_demand_group(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_ride_from_demand_group(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- get_ride_detail_for_user: awaiting_driver + dueños de trip_request vinculada
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_ride_detail_for_user(p_ride_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_uid uuid;
  v_ride rides%ROWTYPE;
  v_has_access boolean := false;
  v_stops jsonb;
  v_driver_profile jsonb;
  v_ride_json jsonb;
  v_passenger_extra_stops jsonb;
  v_result jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_ride FROM rides WHERE id = p_ride_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_ride.driver_id = v_uid THEN
    v_has_access := true;
  END IF;

  IF NOT v_has_access AND is_admin(v_uid) THEN
    v_has_access := true;
  END IF;

  IF NOT v_has_access AND EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.ride_id = p_ride_id
      AND b.passenger_id = v_uid
      AND b.status != 'cancelled'
  ) THEN
    v_has_access := true;
  END IF;

  IF NOT v_has_access AND EXISTS (
    SELECT 1 FROM trip_requests tr
    WHERE tr.ride_id = p_ride_id
      AND tr.user_id = v_uid
  ) THEN
    v_has_access := true;
  END IF;

  IF NOT v_has_access AND v_ride.status = 'awaiting_driver' AND EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = v_uid AND p.role IN ('driver', 'admin')
  ) THEN
    v_has_access := true;
  END IF;

  IF NOT v_has_access AND v_ride.status = 'published' THEN
    v_has_access := true;
  END IF;

  IF NOT v_has_access THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', rs.id,
        'ride_id', rs.ride_id,
        'stop_order', rs.stop_order,
        'lat', rs.lat,
        'lng', rs.lng,
        'label', rs.label,
        'eta', rs.eta,
        'arrived_at', rs.arrived_at,
        'is_base_stop', rs.is_base_stop
      ) ORDER BY rs.stop_order
    ),
    '[]'::jsonb
  ) INTO v_stops
  FROM ride_stops rs
  WHERE rs.ride_id = p_ride_id;

  SELECT jsonb_build_object(
    'id', p.id,
    'full_name', p.full_name,
    'avatar_url', p.avatar_url,
    'rating_average', p.rating_average,
    'rating_count', p.rating_count
  ) INTO v_driver_profile
  FROM profiles p
  WHERE p.id = v_ride.driver_id;

  v_ride_json := jsonb_build_object(
    'id', v_ride.id,
    'driver_id', v_ride.driver_id,
    'status', v_ride.status,
    'base_route_polyline', v_ride.base_route_polyline,
    'origin_lat', v_ride.origin_lat,
    'origin_lng', v_ride.origin_lng,
    'origin_label', v_ride.origin_label,
    'destination_lat', v_ride.destination_lat,
    'destination_lng', v_ride.destination_lng,
    'destination_label', v_ride.destination_label,
    'route_name', v_ride.route_name,
    'current_stop_index', v_ride.current_stop_index,
    'total_seats', v_ride.total_seats,
    'available_seats', v_ride.available_seats,
    'departure_time', v_ride.departure_time,
    'estimated_duration_minutes', v_ride.estimated_duration_minutes,
    'driver_lat', v_ride.driver_lat,
    'driver_lng', v_ride.driver_lng,
    'driver_location_updated_at', v_ride.driver_location_updated_at,
    'price_per_seat', v_ride.price_per_seat,
    'description', v_ride.description,
    'awaiting_stop_confirmation', v_ride.awaiting_stop_confirmation
  );

  IF v_ride.driver_id = v_uid OR is_admin(v_uid) THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', pes.id,
          'ride_id', pes.ride_id,
          'passenger_id', pes.passenger_id,
          'lat', pes.lat,
          'lng', pes.lng,
          'label', pes.label,
          'stop_order', pes.stop_order
        ) ORDER BY pes.passenger_id, pes.stop_order
      ),
      '[]'::jsonb
    ) INTO v_passenger_extra_stops
    FROM passenger_extra_stops pes
    WHERE pes.ride_id = p_ride_id;
  ELSE
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', pes.id,
          'ride_id', pes.ride_id,
          'passenger_id', pes.passenger_id,
          'lat', pes.lat,
          'lng', pes.lng,
          'label', pes.label,
          'stop_order', pes.stop_order
        ) ORDER BY pes.stop_order
      ),
      '[]'::jsonb
    ) INTO v_passenger_extra_stops
    FROM passenger_extra_stops pes
    WHERE pes.ride_id = p_ride_id
      AND pes.passenger_id = v_uid;
  END IF;

  v_result := jsonb_build_object(
    'ride', v_ride_json,
    'ride_stops', COALESCE(v_stops, '[]'::jsonb),
    'driver_profile', COALESCE(v_driver_profile, 'null'::jsonb),
    'passenger_extra_stops', COALESCE(v_passenger_extra_stops, '[]'::jsonb)
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_ride_detail_for_user(uuid) IS
  'Detalle ride: admin, conductor, booking, trip_request vinculada, awaiting_driver+driver/admin, published. Incluye route_name.';
