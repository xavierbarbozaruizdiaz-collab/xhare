-- Calificación visible: 5.00 hasta acumular 100; después, media de las últimas 100.
-- Incluye conductores/pasajeros sin calificaciones (count = 0).

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
  SELECT COUNT(*)::int INTO v_total FROM public.driver_ratings WHERE driver_id = p_profile_id;

  IF v_total >= 100 THEN
    SELECT COALESCE(ROUND(AVG(stars)::numeric, 2), 5.00)
    INTO v_avg
    FROM (
      SELECT stars FROM public.driver_ratings
      WHERE driver_id = p_profile_id
      ORDER BY created_at DESC
      LIMIT 100
    ) recent;
  ELSE
    v_avg := 5.00;
  END IF;

  UPDATE public.profiles
  SET
    rating_average = v_avg,
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
  SELECT COUNT(*)::int INTO v_total FROM public.passenger_ratings WHERE passenger_id = p_profile_id;

  IF v_total >= 100 THEN
    SELECT COALESCE(ROUND(AVG(stars)::numeric, 2), 5.00)
    INTO v_avg
    FROM (
      SELECT stars FROM public.passenger_ratings
      WHERE passenger_id = p_profile_id
      ORDER BY created_at DESC
      LIMIT 100
    ) recent;
  ELSE
    v_avg := 5.00;
  END IF;

  UPDATE public.profiles
  SET
    rating_average = v_avg,
    rating_count = v_total
  WHERE id = p_profile_id;
END;
$$;

UPDATE public.profiles
SET rating_average = 5.00
WHERE COALESCE(rating_count, 0) < 100;

SELECT public.sync_profile_rating_from_driver_ratings(driver_id)
FROM (SELECT DISTINCT driver_id FROM public.driver_ratings) d;

SELECT public.sync_profile_rating_from_passenger_ratings(passenger_id)
FROM (SELECT DISTINCT passenger_id FROM public.passenger_ratings) p;
