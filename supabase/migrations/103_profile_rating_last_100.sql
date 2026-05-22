-- Promedio de perfil = últimas 100 calificaciones (ventana móvil tipo Uber).
-- rating_count = total histórico de calificaciones recibidas.

CREATE OR REPLACE FUNCTION public.sync_profile_rating_from_driver_ratings(p_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_avg numeric(3, 2);
  v_total int;
  v_window int;
BEGIN
  SELECT COUNT(*)::int INTO v_total FROM driver_ratings WHERE driver_id = p_profile_id;

  SELECT COUNT(*)::int
  INTO v_window
  FROM (
    SELECT 1 FROM driver_ratings
    WHERE driver_id = p_profile_id
    ORDER BY created_at DESC
    LIMIT 100
  ) w;

  SELECT COALESCE(ROUND(AVG(stars)::numeric, 2), 0)
  INTO v_avg
  FROM (
    SELECT stars FROM driver_ratings
    WHERE driver_id = p_profile_id
    ORDER BY created_at DESC
    LIMIT 100
  ) recent;

  UPDATE profiles
  SET
    rating_average = CASE WHEN v_window > 0 THEN v_avg ELSE 0 END,
    rating_count = v_total
  WHERE id = p_profile_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_profile_rating_from_passenger_ratings(p_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_avg numeric(3, 2);
  v_total int;
  v_window int;
BEGIN
  SELECT COUNT(*)::int INTO v_total FROM passenger_ratings WHERE passenger_id = p_profile_id;

  SELECT COUNT(*)::int
  INTO v_window
  FROM (
    SELECT 1 FROM passenger_ratings
    WHERE passenger_id = p_profile_id
    ORDER BY created_at DESC
    LIMIT 100
  ) w;

  SELECT COALESCE(ROUND(AVG(stars)::numeric, 2), 0)
  INTO v_avg
  FROM (
    SELECT stars FROM passenger_ratings
    WHERE passenger_id = p_profile_id
    ORDER BY created_at DESC
    LIMIT 100
  ) recent;

  UPDATE profiles
  SET
    rating_average = CASE WHEN v_window > 0 THEN v_avg ELSE 0 END,
    rating_count = v_total
  WHERE id = p_profile_id;
END;
$$;

-- Re-sincronizar perfiles con calificaciones existentes
SELECT public.sync_profile_rating_from_driver_ratings(driver_id)
FROM (SELECT DISTINCT driver_id FROM driver_ratings) d;

SELECT public.sync_profile_rating_from_passenger_ratings(passenger_id)
FROM (SELECT DISTINCT passenger_id FROM passenger_ratings) p;
