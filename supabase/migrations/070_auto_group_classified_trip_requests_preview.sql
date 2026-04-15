-- Preview del agrupado classified: misma partición en lotes que auto_group_classified_trip_requests, sin INSERT/UPDATE.

CREATE OR REPLACE FUNCTION public.auto_group_classified_trip_requests_preview(p_max_seats int DEFAULT 15)
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
  batches jsonb := '[]'::jsonb;
  one_batch jsonb;
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
        one_batch := jsonb_build_object(
          'corridor_id', v_corridor,
          'time_bucket', v_bucket,
          'trip_request_ids', to_jsonb(batch_ids),
          'member_count', cardinality(batch_ids),
          'total_seats', batch_seats
        );
        batches := batches || jsonb_build_array(one_batch);
        groups_created := groups_created + 1;
        trip_requests_grouped := trip_requests_grouped + cardinality(batch_ids);
        batch_ids := ARRAY[]::uuid[];
        batch_seats := 0;
      END IF;
    END IF;

    IF cardinality(batch_ids) > 0 AND batch_seats + r.seats > max_seats THEN
      one_batch := jsonb_build_object(
        'corridor_id', v_corridor,
        'time_bucket', v_bucket,
        'trip_request_ids', to_jsonb(batch_ids),
        'member_count', cardinality(batch_ids),
        'total_seats', batch_seats
      );
      batches := batches || jsonb_build_array(one_batch);
      groups_created := groups_created + 1;
      trip_requests_grouped := trip_requests_grouped + cardinality(batch_ids);
      batch_ids := ARRAY[]::uuid[];
      batch_seats := 0;
    END IF;

    IF cardinality(batch_ids) >= 15 THEN
      one_batch := jsonb_build_object(
        'corridor_id', v_corridor,
        'time_bucket', v_bucket,
        'trip_request_ids', to_jsonb(batch_ids),
        'member_count', cardinality(batch_ids),
        'total_seats', batch_seats
      );
      batches := batches || jsonb_build_array(one_batch);
      groups_created := groups_created + 1;
      trip_requests_grouped := trip_requests_grouped + cardinality(batch_ids);
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
    one_batch := jsonb_build_object(
      'corridor_id', v_corridor,
      'time_bucket', v_bucket,
      'trip_request_ids', to_jsonb(batch_ids),
      'member_count', cardinality(batch_ids),
      'total_seats', batch_seats
    );
    batches := batches || jsonb_build_array(one_batch);
    groups_created := groups_created + 1;
    trip_requests_grouped := trip_requests_grouped + cardinality(batch_ids);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'preview', true,
    'batches', batches,
    'batches_count', groups_created,
    'groups_created', groups_created,
    'trip_requests_grouped', trip_requests_grouped,
    'max_seats_per_group', max_seats
  );
END;
$$;

REVOKE ALL ON FUNCTION public.auto_group_classified_trip_requests_preview(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auto_group_classified_trip_requests_preview(int) TO service_role;

COMMENT ON FUNCTION public.auto_group_classified_trip_requests_preview IS
  'Solo lectura + partición: mismos lotes que auto_group_classified_trip_requests sin escribir en demand_route_* ni trip_requests.';
