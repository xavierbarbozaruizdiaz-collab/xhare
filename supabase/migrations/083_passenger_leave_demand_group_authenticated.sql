-- Pasajero sale del grupo usando solo el JWT de Supabase (rol authenticated).
-- Encola notificaciones push para el cron de Next (service role), sin depender de que Vercel comparta el mismo JWT.

CREATE TABLE IF NOT EXISTS public.driver_demand_passenger_left_push_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL,
  group_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS driver_demand_passenger_left_push_queue_pending_idx
  ON public.driver_demand_passenger_left_push_queue (created_at)
  WHERE processed_at IS NULL;

ALTER TABLE public.driver_demand_passenger_left_push_queue ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.driver_demand_passenger_left_push_queue IS
  'Cola: ride/group para avisar al conductor vía Expo; la consume el cron Next con service role.';

CREATE OR REPLACE FUNCTION public.detach_trip_request_from_demand_group_for_passenger(
  p_trip_request_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_result jsonb;
  e jsonb;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'NOT_AUTHENTICATED',
      'message', 'Sesión requerida.'
    );
  END IF;

  v_result := public.detach_trip_request_from_demand_group(p_trip_request_id, v_uid);

  IF coalesce((v_result->>'ok')::boolean, false) THEN
    INSERT INTO public.driver_demand_passenger_left_push_queue (ride_id, group_id)
    SELECT DISTINCT (t.elem->>'ride_id')::uuid, (t.elem->>'group_id')::uuid
    FROM jsonb_array_elements(coalesce(v_result->'notify_driver_rides', '[]'::jsonb)) AS t(elem)
    WHERE coalesce(t.elem->>'ride_id', '') <> ''
      AND coalesce(t.elem->>'group_id', '') <> '';
  END IF;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.detach_trip_request_from_demand_group_for_passenger(uuid) IS
  'Pasajero autenticado: sale del grupo (misma lógica que por service) y encola push al conductor.';

REVOKE ALL ON FUNCTION public.detach_trip_request_from_demand_group_for_passenger(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detach_trip_request_from_demand_group_for_passenger(uuid) TO authenticated;
