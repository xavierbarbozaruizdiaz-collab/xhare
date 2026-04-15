-- Extiende point_in_corridor_zone para soportar `polygon_latlng` (anillo libre).
-- Prioridad de evaluación: polygon_latlng -> hex_latlng -> bbox legacy.

CREATE OR REPLACE FUNCTION public.point_in_corridor_zone(
  p_lat double precision,
  p_lng double precision,
  zone jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, extensions
AS $$
DECLARE
  poly_json jsonb;
  i int;
  n int;
  lat0 double precision;
  lng0 double precision;
  pts text;
  poly extensions.geometry;
  pt extensions.geometry;
BEGIN
  pt := extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326);

  -- 1) Polígono libre dibujado en admin
  poly_json := zone->'polygon_latlng';
  IF poly_json IS NOT NULL
     AND jsonb_typeof(poly_json) = 'array'
  THEN
    n := jsonb_array_length(poly_json);
    IF n >= 3 THEN
      pts := '';
      FOR i IN 0..n-1 LOOP
        IF jsonb_typeof(poly_json->i) <> 'object' THEN
          pts := '';
          EXIT;
        END IF;
        lat0 := (poly_json->i->>'lat')::double precision;
        lng0 := (poly_json->i->>'lng')::double precision;
        IF lng0 IS NULL OR lat0 IS NULL THEN
          pts := '';
          EXIT;
        END IF;
        IF i > 0 THEN
          pts := pts || ',';
        END IF;
        pts := pts || lng0::text || ' ' || lat0::text;
      END LOOP;
      IF pts <> '' THEN
        lat0 := (poly_json->0->>'lat')::double precision;
        lng0 := (poly_json->0->>'lng')::double precision;
        pts := pts || ',' || lng0::text || ' ' || lat0::text;
        BEGIN
          poly := extensions.ST_MakeValid(
            extensions.ST_GeomFromText('POLYGON((' || pts || '))', 4326)
          );
          RETURN extensions.ST_Covers(poly, pt);
        EXCEPTION
          WHEN others THEN
            -- fallback a hex/bbox
            NULL;
        END;
      END IF;
    END IF;
  END IF;

  -- 2) Hexágono explícito (6 vértices)
  poly_json := zone->'hex_latlng';
  IF poly_json IS NOT NULL
     AND jsonb_typeof(poly_json) = 'array'
     AND jsonb_array_length(poly_json) = 6
  THEN
    pts := '';
    FOR i IN 0..5 LOOP
      IF jsonb_typeof(poly_json->i) <> 'object' THEN
        pts := '';
        EXIT;
      END IF;
      lat0 := (poly_json->i->>'lat')::double precision;
      lng0 := (poly_json->i->>'lng')::double precision;
      IF lng0 IS NULL OR lat0 IS NULL THEN
        pts := '';
        EXIT;
      END IF;
      IF i > 0 THEN
        pts := pts || ',';
      END IF;
      pts := pts || lng0::text || ' ' || lat0::text;
    END LOOP;
    IF pts <> '' THEN
      lat0 := (poly_json->0->>'lat')::double precision;
      lng0 := (poly_json->0->>'lng')::double precision;
      pts := pts || ',' || lng0::text || ' ' || lat0::text;
      BEGIN
        poly := extensions.ST_MakeValid(
          extensions.ST_GeomFromText('POLYGON((' || pts || '))', 4326)
        );
        RETURN extensions.ST_Covers(poly, pt);
      EXCEPTION
        WHEN others THEN
          NULL;
      END;
    END IF;
  END IF;

  -- 3) Bbox legacy
  RETURN p_lat >= (zone->>'minLat')::double precision
     AND p_lat <= (zone->>'maxLat')::double precision
     AND p_lng >= (zone->>'minLng')::double precision
     AND p_lng <= (zone->>'maxLng')::double precision;
END;
$$;

COMMENT ON FUNCTION public.point_in_corridor_zone(double precision, double precision, jsonb) IS
  'Punto en zona de corredor: polygon_latlng (si existe), sino hex_latlng, sino bbox min/max.';
