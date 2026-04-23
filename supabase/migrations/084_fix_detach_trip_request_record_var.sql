-- Fix PL/pgSQL variable/table alias collision:
-- previous function used `tr` as record variable and SQL alias, causing
-- "record \"tr\" is not assigned yet" at runtime.

CREATE OR REPLACE FUNCTION public.detach_trip_request_from_demand_group(
  p_trip_request_id uuid,
  p_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip record;
  v_slot text;
  v_result jsonb;
BEGIN
  SELECT
    t.id,
    t.user_id,
    t.status,
    t.passenger_favorite_slot,
    t.requested_date,
    t.requested_time
  INTO v_trip
  FROM public.trip_requests AS t
  WHERE t.id = p_trip_request_id
    AND t.user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'NOT_FOUND',
      'message', 'Solicitud no encontrada.'
    );
  END IF;

  IF v_trip.status NOT IN ('grouping', 'grouped', 'group_linked_pending') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'INVALID_STATUS',
      'message', 'Esta solicitud no está en un grupo de demanda.'
    );
  END IF;

  v_slot := nullif(trim(v_trip.passenger_favorite_slot), '');
  IF v_slot IS NOT NULL THEN
    v_result := public.detach_passenger_favorite_grouped_requests(
      p_user_id,
      v_slot,
      v_trip.requested_date::text,
      v_trip.requested_time::text
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

COMMENT ON FUNCTION public.detach_trip_request_from_demand_group(uuid, uuid) IS
  'Pasajero sale del grupo: favorito+fecha+hora; si eso cancela 0 filas, detach por id. Sin slot, solo por id.';
