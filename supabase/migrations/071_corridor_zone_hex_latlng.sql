-- Zonas de corredor: si `origin_zone` / `destination_zone` incluyen `hex_latlng` (6 puntos {lat,lng}),
-- la clasificación usa el polígono (PostGIS). Sin eso, sigue el bbox axis-aligned (MVP legacy).

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
  hex jsonb;
  i int;
  lat0 double precision;
  lng0 double precision;
  pts text;
  poly extensions.geometry;
  pt extensions.geometry;
BEGIN
  hex := zone->'hex_latlng';
  IF hex IS NOT NULL
     AND jsonb_typeof(hex) = 'array'
     AND jsonb_array_length(hex) = 6
  THEN
    pts := '';
    FOR i IN 0..5 LOOP
      IF jsonb_typeof(hex->i) <> 'object' THEN
        RETURN p_lat >= (zone->>'minLat')::double precision
           AND p_lat <= (zone->>'maxLat')::double precision
           AND p_lng >= (zone->>'minLng')::double precision
           AND p_lng <= (zone->>'maxLng')::double precision;
      END IF;
      lat0 := (hex->i->>'lat')::double precision;
      lng0 := (hex->i->>'lng')::double precision;
      IF lng0 IS NULL OR lat0 IS NULL THEN
        RETURN p_lat >= (zone->>'minLat')::double precision
           AND p_lat <= (zone->>'maxLat')::double precision
           AND p_lng >= (zone->>'minLng')::double precision
           AND p_lng <= (zone->>'maxLng')::double precision;
      END IF;
      IF i > 0 THEN
        pts := pts || ',';
      END IF;
      pts := pts || lng0::text || ' ' || lat0::text;
    END LOOP;
    lat0 := (hex->0->>'lat')::double precision;
    lng0 := (hex->0->>'lng')::double precision;
    pts := pts || ',' || lng0::text || ' ' || lat0::text;
    BEGIN
      poly := extensions.ST_MakeValid(
        extensions.ST_GeomFromText('POLYGON((' || pts || '))', 4326)
      );
      pt := extensions.ST_SetSRID(extensions.ST_MakePoint(p_lng, p_lat), 4326);
      RETURN extensions.ST_Covers(poly, pt);
    EXCEPTION
      WHEN others THEN
        RETURN p_lat >= (zone->>'minLat')::double precision
           AND p_lat <= (zone->>'maxLat')::double precision
           AND p_lng >= (zone->>'minLng')::double precision
           AND p_lng <= (zone->>'maxLng')::double precision;
    END;
  END IF;

  RETURN p_lat >= (zone->>'minLat')::double precision
     AND p_lat <= (zone->>'maxLat')::double precision
     AND p_lng >= (zone->>'minLng')::double precision
     AND p_lng <= (zone->>'maxLng')::double precision;
END;
$$;

COMMENT ON FUNCTION public.point_in_corridor_zone(double precision, double precision, jsonb) IS
  'Punto en zona de corredor: si zone.hex_latlng tiene 6 vértices válidos, ST_Covers sobre polígono; si no, bbox min/max.';
