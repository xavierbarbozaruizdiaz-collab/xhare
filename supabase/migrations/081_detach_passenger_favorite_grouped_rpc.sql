-- RPC atómica: pasajero sale de demanda agrupada (mismo favorito + fecha + hora).
-- Bloqueo si hay ride published/booked/en_route; limpia miembros; cancela trips;
-- recomputa passenger_count y base_trip_request_id; archiva grupo vacío (optimization_meta);
-- devuelve rides (draft/awaiting_driver) para notificar al conductor desde la API.

CREATE OR REPLACE FUNCTION public.detach_passenger_favorite_grouped_requests(
  p_user_id uuid,
  p_favorite_slot text,
  p_requested_date text,
  p_requested_time text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date date;
  v_time time;
  v_ids uuid[];
  v_blocked boolean;
  v_gid uuid;
  v_new_base uuid;
  v_member_cnt int;
  v_notify jsonb := '[]'::jsonb;
  v_gids uuid[];
  v_seat_adj jsonb := '[]'::jsonb;
  v_sr record;
BEGIN
  v_date := p_requested_date::date;
  v_time := p_requested_time::time;

  SELECT coalesce(array_agg(tr.id), '{}'::uuid[])
  INTO v_ids
  FROM public.trip_requests tr
  WHERE tr.user_id = p_user_id
    AND tr.passenger_favorite_slot = trim(both from p_favorite_slot)
    AND tr.requested_date = v_date
    AND tr.requested_time = v_time
    AND tr.status IN ('grouping', 'grouped', 'group_linked_pending');

  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'cancelled_count', 0,
      'notify_driver_rides', '[]'::jsonb
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.trip_requests tr
    JOIN public.demand_route_groups dg ON dg.id = tr.demand_group_id
    JOIN public.rides r ON r.id = dg.ride_id
    WHERE tr.id = ANY (v_ids)
      AND dg.ride_id IS NOT NULL
      AND r.status IN ('published', 'booked', 'en_route')
  )
  INTO v_blocked;

  IF v_blocked THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'GROUP_HAS_ACTIVE_RIDE',
      'message',
      'Ya hay un viaje publicado o en curso desde este grupo. No podés salir del grupo desde acá; hablá con el conductor o soporte.'
    );
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'ride_id', x.ride_id,
        'group_id', x.group_id
      )
    ),
    '[]'::jsonb
  )
  INTO v_notify
  FROM (
    SELECT DISTINCT dg.ride_id, dg.id AS group_id
    FROM public.trip_requests tr
    JOIN public.demand_route_groups dg ON dg.id = tr.demand_group_id
    JOIN public.rides r ON r.id = dg.ride_id
    WHERE tr.id = ANY (v_ids)
      AND dg.ride_id IS NOT NULL
      AND r.status IN ('awaiting_driver', 'draft')
  ) x;

  SELECT coalesce(array_agg(DISTINCT m.group_id), '{}'::uuid[])
  INTO v_gids
  FROM public.demand_route_members m
  WHERE m.trip_request_id = ANY (v_ids);

  SELECT coalesce(
    jsonb_agg(jsonb_build_object('ride_id', z.ride_id, 'seat_sum', z.s)),
    '[]'::jsonb
  )
  INTO v_seat_adj
  FROM (
    SELECT dg.ride_id, sum(tr.seats)::int AS s
    FROM public.trip_requests tr
    JOIN public.demand_route_groups dg ON dg.id = tr.demand_group_id
    JOIN public.rides r ON r.id = dg.ride_id
    WHERE tr.id = ANY (v_ids)
      AND dg.ride_id IS NOT NULL
      AND r.status IN ('awaiting_driver', 'draft')
    GROUP BY dg.ride_id
  ) z;

  DELETE FROM public.demand_route_members m
  WHERE m.trip_request_id = ANY (v_ids);

  UPDATE public.trip_requests tr
  SET
    status = 'cancelled',
    demand_group_id = NULL,
    ride_id = NULL,
    updated_at = now()
  WHERE tr.id = ANY (v_ids);

  FOR v_sr IN
  SELECT (e ->> 'ride_id')::uuid AS rid, (e ->> 'seat_sum')::int AS sm
  FROM jsonb_array_elements(v_seat_adj) AS e
  LOOP
    UPDATE public.rides r
    SET
      available_seats = greatest(0, coalesce(r.available_seats, 0) - greatest(0, v_sr.sm)),
      total_seats = greatest(0, coalesce(r.total_seats, 0) - greatest(0, v_sr.sm)),
      updated_at = now()
    WHERE r.id = v_sr.rid
      AND r.status IN ('awaiting_driver', 'draft');
  END LOOP;

  FOREACH v_gid IN ARRAY v_gids
  LOOP
    SELECT count(DISTINCT m.trip_request_id)::int
    INTO v_member_cnt
    FROM public.demand_route_members m
    WHERE m.group_id = v_gid;

    IF v_member_cnt = 0 THEN
      UPDATE public.demand_route_groups dg
      SET
        passenger_count = 0,
        base_trip_request_id = NULL,
        optimization_meta = coalesce(dg.optimization_meta, '{}'::jsonb)
          || jsonb_build_object(
            'demand_archived', true,
            'reason', 'empty_after_passenger_detach',
            'archived_at', to_jsonb(now())
          ),
        updated_at = now()
      WHERE dg.id = v_gid;
    ELSE
      SELECT tr.id
      INTO v_new_base
      FROM public.demand_route_members m
      JOIN public.trip_requests tr ON tr.id = m.trip_request_id
      WHERE m.group_id = v_gid
        AND tr.status IN ('grouping', 'grouped', 'group_linked_pending')
      ORDER BY coalesce(m.visit_order, 0), tr.created_at ASC
      LIMIT 1;

      UPDATE public.demand_route_groups dg
      SET
        passenger_count = v_member_cnt,
        base_trip_request_id = CASE
          WHEN dg.base_trip_request_id = ANY (v_ids) THEN v_new_base
          WHEN NOT EXISTS (
            SELECT 1
            FROM public.demand_route_members m2
            WHERE m2.group_id = dg.id
              AND m2.trip_request_id = dg.base_trip_request_id
          ) THEN coalesce(v_new_base, dg.base_trip_request_id)
          ELSE dg.base_trip_request_id
        END,
        updated_at = now()
      WHERE dg.id = v_gid;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'cancelled_count', cardinality(v_ids),
    'notify_driver_rides', coalesce(v_notify, '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.detach_passenger_favorite_grouped_requests(uuid, text, text, text) IS
  'Atómico: saca pedidos agrupados del mismo favorito/fecha/hora; limpia miembros; cancela trips; actualiza grupo/base/archivo vacío. Bloquea si ride published/booked/en_route.';

REVOKE ALL ON FUNCTION public.detach_passenger_favorite_grouped_requests(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detach_passenger_favorite_grouped_requests(uuid, text, text, text) TO service_role;
