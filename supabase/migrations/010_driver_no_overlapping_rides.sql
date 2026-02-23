-- El chofer no puede tener más de un viaje con horarios que se solapen.
-- Duración estimada se calcula desde la ruta (origen, destino, paradas); sin default fijo.
-- Incluye borradores (draft) en la validación de solapamiento.

ALTER TABLE rides
  ADD COLUMN IF NOT EXISTS estimated_duration_minutes int;

COMMENT ON COLUMN rides.estimated_duration_minutes IS 'Duración estimada en minutos (desde ruta: origen, destino, paradas, pasajeros). Usada para detectar solapamiento.';

-- Función que verifica que el chofer no tenga otro viaje (incl. draft) en el mismo horario
CREATE OR REPLACE FUNCTION check_driver_ride_no_overlap()
RETURNS TRIGGER AS $$
DECLARE
  new_start timestamptz;
  new_end   timestamptz;
  conflict_count int;
  fallback_min int := 60;
BEGIN
  -- Solo validar viajes que "ocupan" horario: publicado, con reservas, en camino o borrador
  IF NEW.status IN ('cancelled', 'completed') THEN
    RETURN NEW;
  END IF;

  new_start := NEW.departure_time;
  new_end   := NEW.departure_time + (COALESCE(NEW.estimated_duration_minutes, fallback_min) || ' minutes')::interval;

  SELECT COUNT(*) INTO conflict_count
  FROM rides r
  WHERE r.driver_id = NEW.driver_id
    AND r.id IS DISTINCT FROM COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND r.status NOT IN ('cancelled', 'completed')
    AND (new_start, new_end)
        OVERLAPS (
          r.departure_time,
          r.departure_time + (COALESCE(r.estimated_duration_minutes, fallback_min) || ' minutes')::interval
        );

  IF conflict_count > 0 THEN
    RAISE EXCEPTION 'driver_ride_overlap: El chofer ya tiene un viaje en ese horario. No podés tener dos viajes con la misma salida o que se solapen en tiempo.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_check_driver_ride_no_overlap ON rides;
CREATE TRIGGER trigger_check_driver_ride_no_overlap
  BEFORE INSERT OR UPDATE OF driver_id, departure_time, estimated_duration_minutes, status
  ON rides
  FOR EACH ROW
  EXECUTE FUNCTION check_driver_ride_no_overlap();
