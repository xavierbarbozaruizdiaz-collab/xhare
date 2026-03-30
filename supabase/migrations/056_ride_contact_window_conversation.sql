-- Contacto pasajero→conductor solo desde 20 min antes de salida hasta finalizar/cancelar.
-- Devuelve/crea conversación de contexto ride de forma idempotente.

CREATE OR REPLACE FUNCTION public.get_or_create_ride_contact_conversation(p_ride_id uuid)
RETURNS TABLE (
  conversation_id uuid,
  error_code text,
  error_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_driver_id uuid;
  v_ride_status text;
  v_departure timestamptz;
  v_booking_status text;
  v_conv_id uuid;
BEGIN
  IF v_me IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 'unauthorized'::text, 'Sesión inválida.';
    RETURN;
  END IF;

  SELECT r.driver_id, r.status, r.departure_time
    INTO v_driver_id, v_ride_status, v_departure
    FROM rides r
   WHERE r.id = p_ride_id
   LIMIT 1;

  IF v_driver_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 'ride_not_found'::text, 'Viaje no encontrado.';
    RETURN;
  END IF;

  IF v_ride_status IN ('completed', 'cancelled') THEN
    RETURN QUERY SELECT NULL::uuid, 'contact_closed'::text, 'El contacto ya no está disponible para este viaje.';
    RETURN;
  END IF;

  IF v_driver_id = v_me THEN
    RETURN QUERY SELECT NULL::uuid, 'driver_self'::text, 'El conductor no puede iniciar este contacto como pasajero.';
    RETURN;
  END IF;

  SELECT b.status
    INTO v_booking_status
    FROM bookings b
   WHERE b.ride_id = p_ride_id
     AND b.passenger_id = v_me
     AND b.status <> 'cancelled'
   ORDER BY b.created_at DESC
   LIMIT 1;

  IF v_booking_status IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 'no_active_booking'::text, 'No tenés una reserva activa en este viaje.';
    RETURN;
  END IF;

  IF v_booking_status NOT IN ('pending', 'confirmed') THEN
    RETURN QUERY SELECT NULL::uuid, 'booking_not_contactable'::text, 'Tu reserva ya no permite contacto.';
    RETURN;
  END IF;

  IF v_ride_status <> 'en_route' THEN
    IF v_departure IS NULL THEN
      RETURN QUERY SELECT NULL::uuid, 'schedule_missing'::text, 'El viaje no tiene hora de salida válida.';
      RETURN;
    END IF;
    IF now() < (v_departure - interval '20 minutes') THEN
      RETURN QUERY SELECT NULL::uuid, 'too_early'::text, 'El contacto se habilita desde 20 minutos antes de la salida.';
      RETURN;
    END IF;
  END IF;

  v_conv_id := get_or_create_conversation(v_driver_id, 'ride', p_ride_id);
  IF v_conv_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 'conversation_failed'::text, 'No se pudo preparar la conversación.';
    RETURN;
  END IF;

  RETURN QUERY SELECT v_conv_id, NULL::text, NULL::text;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_or_create_ride_contact_conversation(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_or_create_ride_contact_conversation(uuid) IS
  'Pasajero con reserva activa: habilita chat con conductor solo desde 20 min antes hasta que el viaje finaliza/cancela.';
