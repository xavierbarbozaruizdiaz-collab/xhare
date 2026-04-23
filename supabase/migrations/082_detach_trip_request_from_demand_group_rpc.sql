-- Salir de demanda agrupada por id de solicitud (p. ej. desde "Mis solicitudes").
-- Si tiene passenger_favorite_slot, delega en detach_passenger_favorite_grouped_requests (misma fecha/hora/slot).
-- Si no, desvincula solo ese trip_request (misma lógica atómica que 081).

CREATE OR REPLACE FUNCTION public.detach_trip_request_ids_from_demand_group(
  p_ids uuid[],
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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
  SELECT coalesce(array_agg(tr.id), '{}'::uuid[])
  INTO v_ids
  FROM public.trip_requests tr
  WHERE tr.id = ANY (p_ids)
    AND tr.user_id = p_user_id
    AND tr.status IN ('grouping', 'grouped', 'group_linked_pending');

  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'NOT_FOUND',
      'message', 'No hay solicitudes en grupo para salir.'
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

CREATE OR REPLACE FUNCTION public.detach_trip_request_from_demand_group(
  p_trip_request_id uuid,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tr record;
  v_slot text;
  v_result jsonb;
BEGIN
  SELECT
    tr.id,
    tr.user_id,
    tr.status,
    tr.passenger_favorite_slot,
    tr.requested_date,
    tr.requested_time
  INTO tr
  FROM public.trip_requests tr
  WHERE tr.id = p_trip_request_id
    AND tr.user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'NOT_FOUND',
      'message', 'Solicitud no encontrada.'
    );
  END IF;

  IF tr.status NOT IN ('grouping', 'grouped', 'group_linked_pending') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'INVALID_STATUS',
      'message', 'Esta solicitud no está en un grupo de demanda.'
    );
  END IF;

  v_slot := nullif(trim(tr.passenger_favorite_slot), '');
  IF v_slot IS NOT NULL THEN
    v_result := public.detach_passenger_favorite_grouped_requests(
      p_user_id,
      v_slot,
      tr.requested_date::text,
      tr.requested_time::text
    );
    IF coalesce((v_result->>'ok')::boolean, false)
      AND coalesce((v_result->>'cancelled_count')::int, 0) = 0 THEN
      RETURN public.detach_trip_request_ids_from_demand_group(ARRAY[p_trip_request_id], p_user_id);
    END IF;
    RETURN v_result;
  END IF;

  RETURN public.detach_trip_request_ids_from_demand_group(ARRAY[p_trip_request_id], p_user_id);
END;
$$;

COMMENT ON FUNCTION public.detach_trip_request_ids_from_demand_group(uuid[], uuid) IS
  'Atómico: desvincula los trip_requests indicados (dueño verificado) de demanda agrupada. Uso interno / service_role.';

COMMENT ON FUNCTION public.detach_trip_request_from_demand_group(uuid, uuid) IS
  'Pasajero sale del grupo: favorito+fecha+hora; si eso cancela 0 filas, detach por id. Sin slot, solo por id.';

REVOKE ALL ON FUNCTION public.detach_trip_request_ids_from_demand_group(uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detach_trip_request_ids_from_demand_group(uuid[], uuid) TO service_role;

REVOKE ALL ON FUNCTION public.detach_trip_request_from_demand_group(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detach_trip_request_from_demand_group(uuid, uuid) TO service_role;
