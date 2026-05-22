-- Hasta 99 calificaciones: promedio visible = 5.00 (valor por defecto).
-- Con 100 o más: promedio = media de las últimas 100 calificaciones.

CREATE OR REPLACE FUNCTION public.sync_profile_rating_from_driver_ratings(p_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_avg numeric(3, 2);
  v_total int;
BEGIN
  SELECT COUNT(*)::int INTO v_total FROM driver_ratings WHERE driver_id = p_profile_id;

  IF v_total >= 100 THEN
    SELECT COALESCE(ROUND(AVG(stars)::numeric, 2), 5.00)
    INTO v_avg
    FROM (
      SELECT stars FROM driver_ratings
      WHERE driver_id = p_profile_id
      ORDER BY created_at DESC
      LIMIT 100
    ) recent;
  ELSE
    v_avg := 5.00;
  END IF;

  UPDATE profiles
  SET
    rating_average = CASE WHEN v_total > 0 THEN v_avg ELSE 0 END,
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
BEGIN
  SELECT COUNT(*)::int INTO v_total FROM passenger_ratings WHERE passenger_id = p_profile_id;

  IF v_total >= 100 THEN
    SELECT COALESCE(ROUND(AVG(stars)::numeric, 2), 5.00)
    INTO v_avg
    FROM (
      SELECT stars FROM passenger_ratings
      WHERE passenger_id = p_profile_id
      ORDER BY created_at DESC
      LIMIT 100
    ) recent;
  ELSE
    v_avg := 5.00;
  END IF;

  UPDATE profiles
  SET
    rating_average = CASE WHEN v_total > 0 THEN v_avg ELSE 0 END,
    rating_count = v_total
  WHERE id = p_profile_id;
END;
$$;

SELECT public.sync_profile_rating_from_driver_ratings(driver_id)
FROM (SELECT DISTINCT driver_id FROM driver_ratings) d;

SELECT public.sync_profile_rating_from_passenger_ratings(passenger_id)
FROM (SELECT DISTINCT passenger_id FROM passenger_ratings) p;
