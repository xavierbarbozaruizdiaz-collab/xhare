-- point_in_corridor_zone: soporte para city_polygons (lista activable por ciudad).
-- Prioridad: city_polygons (si existe) -> polygon_latlng -> hex_latlng -> bbox.

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
  cities jsonb;
  city jsonb;
  poly_json jsonb;
  i int;
  n int;
  lat0 double precision;
  lng0 double precision;
  pts text;
  poly extensions.geometry;
  pt extensions.geometry;
  has_city_array boolean := false;
BEGIN
  pt := extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326);

  -- 1) Lista de ciudades activables/desactivables
  cities := zone->'city_polygons';
  IF cities IS NOT NULL AND jsonb_typeof(cities) = 'array' THEN
    has_city_array := true;
    FOR city IN SELECT value FROM jsonb_array_elements(cities)
    LOOP
      IF city->>'active' = 'false' THEN
        CONTINUE;
      END IF;
      poly_json := city->'polygon_latlng';
      IF poly_json IS NULL OR jsonb_typeof(poly_json) <> 'array' THEN
        CONTINUE;
      END IF;
      n := jsonb_array_length(poly_json);
      IF n < 3 THEN
        CONTINUE;
      END IF;
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
      IF pts = '' THEN
        CONTINUE;
      END IF;
      lat0 := (poly_json->0->>'lat')::double precision;
      lng0 := (poly_json->0->>'lng')::double precision;
      pts := pts || ',' || lng0::text || ' ' || lat0::text;
      BEGIN
        poly := extensions.ST_MakeValid(
          extensions.ST_GeomFromText('POLYGON((' || pts || '))', 4326)
        );
        IF extensions.ST_Covers(poly, pt) THEN
          RETURN true;
        END IF;
      EXCEPTION
        WHEN others THEN
          CONTINUE;
      END;
    END LOOP;
    -- Si city_polygons existe, solo clasifica por ciudades activas.
    RETURN false;
  END IF;

  -- 2) Polígono libre
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
            NULL;
        END;
      END IF;
    END IF;
  END IF;

  -- 3) Hexágono
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

  -- 4) Bbox
  RETURN p_lat >= (zone->>'minLat')::double precision
     AND p_lat <= (zone->>'maxLat')::double precision
     AND p_lng >= (zone->>'minLng')::double precision
     AND p_lng <= (zone->>'maxLng')::double precision;
END;
$$;

COMMENT ON FUNCTION public.point_in_corridor_zone(double precision, double precision, jsonb) IS
  'Punto en zona de corredor: city_polygons activos (si existe), luego polygon_latlng, luego hex_latlng, luego bbox.';
