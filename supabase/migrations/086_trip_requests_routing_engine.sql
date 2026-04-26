-- Trazabilidad explícita del enrutamiento por motor para trip_requests.
-- Objetivo: saber por qué pipeline debería pasar cada solicitud.

ALTER TABLE public.trip_requests
  ADD COLUMN IF NOT EXISTS routing_engine text;

ALTER TABLE public.trip_requests DROP CONSTRAINT IF EXISTS trip_requests_routing_engine_check;
ALTER TABLE public.trip_requests
  ADD CONSTRAINT trip_requests_routing_engine_check
  CHECK (routing_engine IN ('hex', 'corridor', 'geo', 'unknown'));

COMMENT ON COLUMN public.trip_requests.routing_engine IS
  'Motor objetivo de enrutamiento: hex | corridor | geo | unknown.';

-- Backfill inicial con reglas compatibles con el estado actual:
-- 1) Si tiene etiquetas super-hex completas -> hex
-- 2) Si está clasificada y tiene corredor -> corridor
-- 3) Si está sin clasificar -> geo
-- 4) Caso residual -> unknown
UPDATE public.trip_requests tr
SET routing_engine = CASE
  WHEN tr.origin_super_hex IS NOT NULL AND tr.dest_super_hex IS NOT NULL THEN 'hex'
  WHEN tr.classification_status = 'classified' AND tr.corridor_id IS NOT NULL THEN 'corridor'
  WHEN tr.classification_status IS NULL OR tr.classification_status = 'unclassified' THEN 'geo'
  ELSE 'unknown'
END
WHERE tr.routing_engine IS NULL;

ALTER TABLE public.trip_requests
  ALTER COLUMN routing_engine SET DEFAULT 'unknown';

ALTER TABLE public.trip_requests
  ALTER COLUMN routing_engine SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trip_requests_routing_engine_status
  ON public.trip_requests (routing_engine, status);

CREATE OR REPLACE FUNCTION public.z_trip_requests_set_routing_engine_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.routing_engine IS NULL OR trim(NEW.routing_engine) = '' THEN
    IF NEW.origin_super_hex IS NOT NULL AND NEW.dest_super_hex IS NOT NULL THEN
      NEW.routing_engine := 'hex';
    ELSIF NEW.classification_status = 'classified' AND NEW.corridor_id IS NOT NULL THEN
      NEW.routing_engine := 'corridor';
    ELSIF NEW.classification_status IS NULL OR NEW.classification_status = 'unclassified' THEN
      NEW.routing_engine := 'geo';
    ELSE
      NEW.routing_engine := 'unknown';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS z_trip_requests_set_routing_engine_before_insert ON public.trip_requests;
CREATE TRIGGER z_trip_requests_set_routing_engine_before_insert
  BEFORE INSERT ON public.trip_requests
  FOR EACH ROW
  EXECUTE PROCEDURE public.z_trip_requests_set_routing_engine_before_insert();

