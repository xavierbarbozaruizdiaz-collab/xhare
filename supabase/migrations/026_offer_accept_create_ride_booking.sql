-- Al aceptar una oferta (Busco viaje o Tengo lugar) se crea el ride y el booking.
-- Función para marcar como expiradas solicitudes/ofertas vencidas.

-- 1) Busco viaje: pasajero acepta oferta de conductor → crear ride (si no existe) + booking
CREATE OR REPLACE FUNCTION create_ride_from_accepted_driver_offer(p_offer_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offer driver_offers%ROWTYPE;
  v_request passenger_ride_requests%ROWTYPE;
  v_ride_id uuid;
  v_driver_seats int;
  v_departure timestamptz;
  v_price_paid numeric(10,2);
BEGIN
  SELECT * INTO v_offer FROM driver_offers WHERE id = p_offer_id AND status = 'accepted';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offer not found or not accepted';
  END IF;

  SELECT * INTO v_request FROM passenger_ride_requests WHERE id = v_offer.passenger_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  v_departure := (v_request.requested_date + COALESCE(v_request.requested_time, '08:00'::time))::timestamptz;
  v_price_paid := v_offer.proposed_price_per_seat * v_request.seats;

  IF v_offer.ride_id IS NOT NULL THEN
    -- El conductor ya tenía un ride vinculado; solo creamos el booking
    INSERT INTO bookings (ride_id, passenger_id, seats_count, price_paid, status, payment_status,
      pickup_lat, pickup_lng, pickup_label, dropoff_lat, dropoff_lng, dropoff_label)
    VALUES (v_offer.ride_id, v_request.user_id, v_request.seats, v_price_paid, 'pending', 'pending',
      v_request.origin_lat, v_request.origin_lng, v_request.origin_label,
      v_request.destination_lat, v_request.destination_lng, v_request.destination_label);
    RETURN v_offer.ride_id;
  END IF;

  SELECT COALESCE(vehicle_seat_count, 6) INTO v_driver_seats FROM profiles WHERE id = v_offer.driver_id;

  INSERT INTO rides (
    driver_id, origin_lat, origin_lng, origin_label,
    destination_lat, destination_lng, destination_label,
    departure_time, estimated_duration_minutes,
    price_per_seat, total_seats, available_seats, capacity,
    status, mode, vehicle_info, seat_layout
  )
  VALUES (
    v_offer.driver_id,
    v_request.origin_lat, v_request.origin_lng, v_request.origin_label,
    v_request.destination_lat, v_request.destination_lng, v_request.destination_label,
    v_departure, 60,
    v_offer.proposed_price_per_seat, v_driver_seats, v_driver_seats, v_driver_seats,
    'published', 'free',
    (SELECT jsonb_build_object('model', vehicle_model, 'year', vehicle_year) FROM profiles WHERE id = v_offer.driver_id),
    (SELECT vehicle_seat_layout FROM profiles WHERE id = v_offer.driver_id)
  )
  RETURNING id INTO v_ride_id;

  INSERT INTO ride_stops (ride_id, stop_order, lat, lng, label)
  VALUES
    (v_ride_id, 0, v_request.origin_lat, v_request.origin_lng, v_request.origin_label),
    (v_ride_id, 1, v_request.destination_lat, v_request.destination_lng, v_request.destination_label);

  UPDATE driver_offers SET ride_id = v_ride_id, updated_at = now() WHERE id = p_offer_id;

  INSERT INTO bookings (ride_id, passenger_id, seats_count, price_paid, status, payment_status,
    pickup_lat, pickup_lng, pickup_label, dropoff_lat, dropoff_lng, dropoff_label)
  VALUES (v_ride_id, v_request.user_id, v_request.seats, v_price_paid, 'pending', 'pending',
    v_request.origin_lat, v_request.origin_lng, v_request.origin_label,
    v_request.destination_lat, v_request.destination_lng, v_request.destination_label);

  RETURN v_ride_id;
END;
$$;

COMMENT ON FUNCTION create_ride_from_accepted_driver_offer(uuid) IS 'Crea ride y booking cuando el pasajero acepta una oferta de conductor (Busco viaje).';
GRANT EXECUTE ON FUNCTION create_ride_from_accepted_driver_offer(uuid) TO authenticated;

-- 2) Tengo lugar: conductor acepta oferta de pasajero → crear ride + booking
CREATE OR REPLACE FUNCTION create_ride_from_accepted_passenger_offer(p_offer_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offer passenger_offers%ROWTYPE;
  v_avail driver_ride_availability%ROWTYPE;
  v_ride_id uuid;
  v_driver_seats int;
  v_price_paid numeric(10,2);
BEGIN
  SELECT * INTO v_offer FROM passenger_offers WHERE id = p_offer_id AND status = 'accepted';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offer not found or not accepted';
  END IF;

  SELECT * INTO v_avail FROM driver_ride_availability WHERE id = v_offer.availability_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Availability not found';
  END IF;

  v_price_paid := v_offer.offered_price_per_seat * v_offer.seats;
  SELECT COALESCE(vehicle_seat_count, v_avail.available_seats, 6) INTO v_driver_seats FROM profiles WHERE id = v_avail.driver_id;

  INSERT INTO rides (
    driver_id, origin_lat, origin_lng, origin_label,
    destination_lat, destination_lng, destination_label,
    departure_time, estimated_duration_minutes,
    price_per_seat, total_seats, available_seats, capacity,
    status, mode, vehicle_info, seat_layout
  )
  VALUES (
    v_avail.driver_id,
    v_avail.origin_lat, v_avail.origin_lng, v_avail.origin_label,
    v_avail.destination_lat, v_avail.destination_lng, v_avail.destination_label,
    v_avail.departure_time, 60,
    v_offer.offered_price_per_seat, v_driver_seats, v_driver_seats, v_driver_seats,
    'published', 'free',
    (SELECT jsonb_build_object('model', vehicle_model, 'year', vehicle_year) FROM profiles WHERE id = v_avail.driver_id),
    (SELECT vehicle_seat_layout FROM profiles WHERE id = v_avail.driver_id)
  )
  RETURNING id INTO v_ride_id;

  INSERT INTO ride_stops (ride_id, stop_order, lat, lng, label)
  VALUES
    (v_ride_id, 0, v_avail.origin_lat, v_avail.origin_lng, v_avail.origin_label),
    (v_ride_id, 1, v_avail.destination_lat, v_avail.destination_lng, v_avail.destination_label);

  INSERT INTO bookings (ride_id, passenger_id, seats_count, price_paid, status, payment_status,
    pickup_lat, pickup_lng, pickup_label, dropoff_lat, dropoff_lng, dropoff_label)
  VALUES (v_ride_id, v_offer.passenger_id, v_offer.seats, v_price_paid, 'pending', 'pending',
    v_avail.origin_lat, v_avail.origin_lng, v_avail.origin_label,
    v_avail.destination_lat, v_avail.destination_lng, v_avail.destination_label);

  RETURN v_ride_id;
END;
$$;

COMMENT ON FUNCTION create_ride_from_accepted_passenger_offer(uuid) IS 'Crea ride y booking cuando el conductor acepta una oferta de pasajero (Tengo lugar).';
GRANT EXECUTE ON FUNCTION create_ride_from_accepted_passenger_offer(uuid) TO authenticated;

-- 3) Marcar como expiradas solicitudes y ofertas vencidas por tiempo
CREATE OR REPLACE FUNCTION expire_offer_flow_items()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE passenger_ride_requests
  SET status = 'expired', updated_at = now()
  WHERE status = 'open' AND accept_offers_until IS NOT NULL AND accept_offers_until < now();

  UPDATE driver_offers
  SET status = 'expired', updated_at = now()
  WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < now();

  UPDATE driver_ride_availability
  SET status = 'expired', updated_at = now()
  WHERE status = 'open' AND accept_offers_until IS NOT NULL AND accept_offers_until < now();

  UPDATE passenger_offers
  SET status = 'expired', updated_at = now()
  WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < now();
END;
$$;

COMMENT ON FUNCTION expire_offer_flow_items() IS 'Marca como expiradas solicitudes y ofertas cuyo plazo venció. Ejecutar al cargar listados o por cron.';
GRANT EXECUTE ON FUNCTION expire_offer_flow_items() TO authenticated;
