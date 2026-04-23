-- Fase B/C: agrupamiento classified v2 con score de compatibilidad (origen/destino/dirección) + preview.

CREATE OR REPLACE FUNCTION public._bearing_deg(
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
  SELECT mod(
    (
      degrees(
        atan2(
          sin(radians(lon2 - lon1)) * cos(radians(lat2)),
          cos(radians(lat1)) * sin(radians(lat2))
          - sin(radians(lat1)) * cos(radians(lat2)) * cos(radians(lon2 - lon1))
        )
      ) + 360.0
    )::numeric,
    360::numeric
  )::double precision;
$$;

CREATE OR REPLACE FUNCTION public._heading_similarity(
  b1 double precision,
  b2 double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT 1.0 - LEAST(
    abs(b1 - b2),
    360.0 - abs(b1 - b2)
  ) / 180.0;
$$;

CREATE OR REPLACE FUNCTION public._classified_pair_score(
  base_o_lat double precision,
  base_o_lng double precision,
  base_d_lat double precision,
  base_d_lng double precision,
  cand_o_lat double precision,
  cand_o_lng double precision,
  cand_d_lat double precision,
  cand_d_lng double precision,
  p_max_origin_km double precision,
  p_max_dest_km double precision
)
RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  d_o double precision;
  d_d double precision;
  b1 double precision;
  b2 double precision;
  hs double precision;
  so double precision;
  sd double precision;
BEGIN
  d_o := public._rough_route_length_km(base_o_lat, base_o_lng, cand_o_lat, cand_o_lng);
  d_d := public._rough_route_length_km(base_d_lat, base_d_lng, cand_d_lat, cand_d_lng);
  b1 := public._bearing_deg(base_o_lat, base_o_lng, base_d_lat, base_d_lng);
  b2 := public._bearing_deg(cand_o_lat, cand_o_lng, cand_d_lat, cand_d_lng);
  hs := public._heading_similarity(b1, b2);
  so := 1.0 - LEAST(1.0, d_o / GREATEST(0.05, p_max_origin_km));
  sd := 1.0 - LEAST(1.0, d_d / GREATEST(0.05, p_max_dest_km));
  RETURN GREATEST(0.0, LEAST(1.0, so * 0.35 + sd * 0.35 + hs * 0.30));
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_group_classified_trip_requests_v2(
  p_max_seats int DEFAULT 15,
  p_min_score double precision DEFAULT 0.55,
  p_max_origin_km double precision DEFAULT 8.0,
  p_max_dest_km double precision DEFAULT 8.0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  g RECORD;
  r RECORD;
  max_seats int;
  min_score double precision;
  max_origin_km double precision;
  max_dest_km double precision;
  batch_ids uuid[];
  batch_seats int;
  base_rec public.trip_requests%ROWTYPE;
  score double precision;
  groups_created int := 0;
  grouped_count int := 0;
  skipped_low_score int := 0;
  flush_res jsonb;
BEGIN
  max_seats := GREATEST(1, COALESCE(p_max_seats, 15));
  min_score := LEAST(0.99, GREATEST(0.0, COALESCE(p_min_score, 0.55)));
  max_origin_km := GREATEST(0.05, COALESCE(p_max_origin_km, 8.0));
  max_dest_km := GREATEST(0.05, COALESCE(p_max_dest_km, 8.0));

  FOR g IN
    SELECT tr.corridor_id, tr.time_bucket
    FROM public.trip_requests tr
    WHERE tr.status = 'pending'
      AND tr.classification_status = 'classified'
      AND tr.corridor_id IS NOT NULL
      AND tr.time_bucket IS NOT NULL
      AND tr.seats <= max_seats
      AND NOT EXISTS (SELECT 1 FROM public.demand_route_members m WHERE m.trip_request_id = tr.id)
    GROUP BY tr.corridor_id, tr.time_bucket
    ORDER BY tr.corridor_id, tr.time_bucket
  LOOP
    batch_ids := ARRAY[]::uuid[];
    batch_seats := 0;
    base_rec := NULL;

    FOR r IN
      SELECT tr.*
      FROM public.trip_requests tr
      WHERE tr.status = 'pending'
        AND tr.classification_status = 'classified'
        AND tr.corridor_id = g.corridor_id
        AND tr.time_bucket = g.time_bucket
        AND tr.seats <= max_seats
        AND NOT EXISTS (SELECT 1 FROM public.demand_route_members m WHERE m.trip_request_id = tr.id)
      ORDER BY tr.created_at ASC, tr.id ASC
    LOOP
      IF cardinality(batch_ids) = 0 THEN
        batch_ids := array_append(batch_ids, r.id);
        batch_seats := r.seats;
        base_rec := r;
        CONTINUE;
      END IF;

      score := public._classified_pair_score(
        base_rec.origin_lat, base_rec.origin_lng,
        base_rec.destination_lat, base_rec.destination_lng,
        r.origin_lat, r.origin_lng,
        r.destination_lat, r.destination_lng,
        max_origin_km, max_dest_km
      );

      IF score < min_score THEN
        skipped_low_score := skipped_low_score + 1;
        CONTINUE;
      END IF;

      IF batch_seats + r.seats > max_seats OR cardinality(batch_ids) >= 15 THEN
        flush_res := public._flush_corridor_bucket_batch(batch_ids, g.corridor_id, g.time_bucket);
        IF (flush_res->>'flushed')::boolean THEN
          groups_created := groups_created + 1;
          grouped_count := grouped_count + (flush_res->>'members')::int;
        END IF;
        batch_ids := ARRAY[]::uuid[];
        batch_seats := 0;
        base_rec := NULL;
      END IF;

      IF cardinality(batch_ids) = 0 THEN
        batch_ids := array_append(batch_ids, r.id);
        batch_seats := r.seats;
        base_rec := r;
      ELSE
        batch_ids := array_append(batch_ids, r.id);
        batch_seats := batch_seats + r.seats;
      END IF;
    END LOOP;

    IF cardinality(batch_ids) > 0 THEN
      flush_res := public._flush_corridor_bucket_batch(batch_ids, g.corridor_id, g.time_bucket);
      IF (flush_res->>'flushed')::boolean THEN
        groups_created := groups_created + 1;
        grouped_count := grouped_count + (flush_res->>'members')::int;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'engine', 'classified_v2_scored',
    'groups_created', groups_created,
    'trip_requests_grouped', grouped_count,
    'skipped_low_score', skipped_low_score,
    'params', jsonb_build_object(
      'max_seats', max_seats,
      'min_score', min_score,
      'max_origin_km', max_origin_km,
      'max_dest_km', max_dest_km
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_group_classified_trip_requests_preview_v2(
  p_max_seats int DEFAULT 15,
  p_min_score double precision DEFAULT 0.55,
  p_max_origin_km double precision DEFAULT 8.0,
  p_max_dest_km double precision DEFAULT 8.0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  g RECORD;
  r RECORD;
  max_seats int;
  min_score double precision;
  max_origin_km double precision;
  max_dest_km double precision;
  batch_ids uuid[];
  batch_seats int;
  base_rec public.trip_requests%ROWTYPE;
  score double precision;
  groups_created int := 0;
  grouped_count int := 0;
  skipped_low_score int := 0;
  batches jsonb := '[]'::jsonb;
BEGIN
  max_seats := GREATEST(1, COALESCE(p_max_seats, 15));
  min_score := LEAST(0.99, GREATEST(0.0, COALESCE(p_min_score, 0.55)));
  max_origin_km := GREATEST(0.05, COALESCE(p_max_origin_km, 8.0));
  max_dest_km := GREATEST(0.05, COALESCE(p_max_dest_km, 8.0));

  FOR g IN
    SELECT tr.corridor_id, tr.time_bucket
    FROM public.trip_requests tr
    WHERE tr.status = 'pending'
      AND tr.classification_status = 'classified'
      AND tr.corridor_id IS NOT NULL
      AND tr.time_bucket IS NOT NULL
      AND tr.seats <= max_seats
      AND NOT EXISTS (SELECT 1 FROM public.demand_route_members m WHERE m.trip_request_id = tr.id)
    GROUP BY tr.corridor_id, tr.time_bucket
    ORDER BY tr.corridor_id, tr.time_bucket
  LOOP
    batch_ids := ARRAY[]::uuid[];
    batch_seats := 0;
    base_rec := NULL;

    FOR r IN
      SELECT tr.*
      FROM public.trip_requests tr
      WHERE tr.status = 'pending'
        AND tr.classification_status = 'classified'
        AND tr.corridor_id = g.corridor_id
        AND tr.time_bucket = g.time_bucket
        AND tr.seats <= max_seats
        AND NOT EXISTS (SELECT 1 FROM public.demand_route_members m WHERE m.trip_request_id = tr.id)
      ORDER BY tr.created_at ASC, tr.id ASC
    LOOP
      IF cardinality(batch_ids) = 0 THEN
        batch_ids := array_append(batch_ids, r.id);
        batch_seats := r.seats;
        base_rec := r;
        CONTINUE;
      END IF;

      score := public._classified_pair_score(
        base_rec.origin_lat, base_rec.origin_lng,
        base_rec.destination_lat, base_rec.destination_lng,
        r.origin_lat, r.origin_lng,
        r.destination_lat, r.destination_lng,
        max_origin_km, max_dest_km
      );

      IF score < min_score THEN
        skipped_low_score := skipped_low_score + 1;
        CONTINUE;
      END IF;

      IF batch_seats + r.seats > max_seats OR cardinality(batch_ids) >= 15 THEN
        batches := batches || jsonb_build_array(
          jsonb_build_object(
            'corridor_id', g.corridor_id,
            'time_bucket', g.time_bucket,
            'trip_request_ids', to_jsonb(batch_ids),
            'member_count', cardinality(batch_ids),
            'total_seats', batch_seats
          )
        );
        groups_created := groups_created + 1;
        grouped_count := grouped_count + cardinality(batch_ids);
        batch_ids := ARRAY[]::uuid[];
        batch_seats := 0;
        base_rec := NULL;
      END IF;

      IF cardinality(batch_ids) = 0 THEN
        batch_ids := array_append(batch_ids, r.id);
        batch_seats := r.seats;
        base_rec := r;
      ELSE
        batch_ids := array_append(batch_ids, r.id);
        batch_seats := batch_seats + r.seats;
      END IF;
    END LOOP;

    IF cardinality(batch_ids) > 0 THEN
      batches := batches || jsonb_build_array(
        jsonb_build_object(
          'corridor_id', g.corridor_id,
          'time_bucket', g.time_bucket,
          'trip_request_ids', to_jsonb(batch_ids),
          'member_count', cardinality(batch_ids),
          'total_seats', batch_seats
        )
      );
      groups_created := groups_created + 1;
      grouped_count := grouped_count + cardinality(batch_ids);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'preview', true,
    'engine', 'classified_v2_scored',
    'batches', batches,
    'groups_created', groups_created,
    'trip_requests_grouped', grouped_count,
    'skipped_low_score', skipped_low_score,
    'params', jsonb_build_object(
      'max_seats', max_seats,
      'min_score', min_score,
      'max_origin_km', max_origin_km,
      'max_dest_km', max_dest_km
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public._bearing_deg(double precision, double precision, double precision, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._heading_similarity(double precision, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._classified_pair_score(double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_group_classified_trip_requests_v2(int, double precision, double precision, double precision) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_group_classified_trip_requests_preview_v2(int, double precision, double precision, double precision) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.auto_group_classified_trip_requests_v2(int, double precision, double precision, double precision) TO service_role;
GRANT EXECUTE ON FUNCTION public.auto_group_classified_trip_requests_preview_v2(int, double precision, double precision, double precision) TO service_role;

COMMENT ON FUNCTION public.auto_group_classified_trip_requests_v2 IS
  'Agrupa pending+classified por corridor+bucket con score de compatibilidad origen/destino/dirección y límites de asientos.';

COMMENT ON FUNCTION public.auto_group_classified_trip_requests_preview_v2 IS
  'Preview del agrupamiento classified v2 (scored), sin escrituras.';
