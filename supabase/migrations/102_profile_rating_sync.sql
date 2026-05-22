-- Sincroniza profiles.rating_* desde driver_ratings / passenger_ratings.
-- Antes solo existía trigger sobre la tabla legacy `reviews` (004).

CREATE OR REPLACE FUNCTION public.sync_profile_rating_from_driver_ratings(p_profile_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_avg numeric(3, 2);
  v_cnt int;
BEGIN
  SELECT COALESCE(ROUND(AVG(stars)::numeric, 2), 0), COUNT(*)::int
  INTO v_avg, v_cnt
  FROM driver_ratings
  WHERE driver_id = p_profile_id;

  UPDATE profiles
  SET
    rating_average = CASE WHEN v_cnt > 0 THEN v_avg ELSE 0 END,
    rating_count = v_cnt
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
  v_cnt int;
BEGIN
  SELECT COALESCE(ROUND(AVG(stars)::numeric, 2), 0), COUNT(*)::int
  INTO v_avg, v_cnt
  FROM passenger_ratings
  WHERE passenger_id = p_profile_id;

  UPDATE profiles
  SET
    rating_average = CASE WHEN v_cnt > 0 THEN v_avg ELSE 0 END,
    rating_count = v_cnt
  WHERE id = p_profile_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_driver_ratings_sync_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_profile_rating_from_driver_ratings(OLD.driver_id);
    RETURN OLD;
  END IF;

  PERFORM public.sync_profile_rating_from_driver_ratings(NEW.driver_id);

  IF TG_OP = 'UPDATE' AND OLD.driver_id IS DISTINCT FROM NEW.driver_id THEN
    PERFORM public.sync_profile_rating_from_driver_ratings(OLD.driver_id);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_passenger_ratings_sync_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.sync_profile_rating_from_passenger_ratings(OLD.passenger_id);
    RETURN OLD;
  END IF;

  PERFORM public.sync_profile_rating_from_passenger_ratings(NEW.passenger_id);

  IF TG_OP = 'UPDATE' AND OLD.passenger_id IS DISTINCT FROM NEW.passenger_id THEN
    PERFORM public.sync_profile_rating_from_passenger_ratings(OLD.passenger_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_driver_ratings_sync_profile ON driver_ratings;
CREATE TRIGGER trigger_driver_ratings_sync_profile
  AFTER INSERT OR UPDATE OR DELETE ON driver_ratings
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_driver_ratings_sync_profile();

DROP TRIGGER IF EXISTS trigger_passenger_ratings_sync_profile ON passenger_ratings;
CREATE TRIGGER trigger_passenger_ratings_sync_profile
  AFTER INSERT OR UPDATE OR DELETE ON passenger_ratings
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_passenger_ratings_sync_profile();

-- Backfill conductores calificados
SELECT public.sync_profile_rating_from_driver_ratings(driver_id)
FROM (SELECT DISTINCT driver_id FROM driver_ratings) d;

-- Backfill pasajeros calificados
SELECT public.sync_profile_rating_from_passenger_ratings(passenger_id)
FROM (SELECT DISTINCT passenger_id FROM passenger_ratings) p;
