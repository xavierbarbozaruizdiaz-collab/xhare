-- Idempotencia al aceptar ofertas (evitar doble ride por doble clic o reintento).
-- Índices compuestos para búsquedas/listados con ~2000 usuarios.

-- 1) passenger_offers.ride_id para idempotencia en Tengo lugar
ALTER TABLE passenger_offers
  ADD COLUMN IF NOT EXISTS ride_id uuid REFERENCES rides(id) ON DELETE SET NULL;

-- 2) create_ride_from_accepted_driver_offer: FOR UPDATE + devolver ride_id si ya existe
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
  SELECT * INTO v_offer FROM driver_offers WHERE id = p_offer_id AND status = 'accepted' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offer not found or not accepted';
  END IF;
  IF v_offer.ride_id IS NOT NULL THEN
    SELECT * INTO v_request FROM passenger_ride_requests WHERE id = v_offer.passenger_request_id;
    IF FOUND AND EXISTS (SELECT 1 FROM bookings WHERE ride_id = v_offer.ride_id AND passenger_id = v_request.user_id) THEN
      RETURN v_offer.ride_id;
    END IF;
    IF FOUND THEN
      v_price_paid := v_offer.proposed_price_per_seat * v_request.seats;
      INSERT INTO bookings (ride_id, passenger_id, seats_count, price_paid, status, payment_status,
        pickup_lat, pickup_lng, pickup_label, dropoff_lat, dropoff_lng, dropoff_label)
      VALUES (v_offer.ride_id, v_request.user_id, v_request.seats, v_price_paid, 'pending', 'pending',
        v_request.origin_lat, v_request.origin_lng, v_request.origin_label,
        v_request.destination_lat, v_request.destination_lng, v_request.destination_label)
      ON CONFLICT (ride_id, passenger_id) DO NOTHING;
    END IF;
    RETURN v_offer.ride_id;
  END IF;

  SELECT * INTO v_request FROM passenger_ride_requests WHERE id = v_offer.passenger_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found';
  END IF;

  v_departure := (v_request.requested_date + COALESCE(v_request.requested_time, '08:00'::time))::timestamptz;
  v_price_paid := v_offer.proposed_price_per_seat * v_request.seats;

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

-- 3) create_ride_from_accepted_passenger_offer: FOR UPDATE + ride_id en passenger_offers
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
  SELECT * INTO v_offer FROM passenger_offers WHERE id = p_offer_id AND status = 'accepted' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offer not found or not accepted';
  END IF;
  IF v_offer.ride_id IS NOT NULL THEN
    RETURN v_offer.ride_id;
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

  UPDATE passenger_offers SET ride_id = v_ride_id, updated_at = now() WHERE id = p_offer_id;

  INSERT INTO bookings (ride_id, passenger_id, seats_count, price_paid, status, payment_status,
    pickup_lat, pickup_lng, pickup_label, dropoff_lat, dropoff_lng, dropoff_label)
  VALUES (v_ride_id, v_offer.passenger_id, v_offer.seats, v_price_paid, 'pending', 'pending',
    v_avail.origin_lat, v_avail.origin_lng, v_avail.origin_label,
    v_avail.destination_lat, v_avail.destination_lng, v_avail.destination_label);

  RETURN v_ride_id;
END;
$$;

-- 4) Un solo booking por (ride, passenger) para evitar duplicados en idempotencia
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_ride_passenger_unique ON bookings(ride_id, passenger_id);

-- 5) Índices compuestos para búsqueda y listados (escala ~2000 usuarios)
CREATE INDEX IF NOT EXISTS idx_rides_status_departure
  ON rides(status, departure_time)
  WHERE status IN ('published', 'booked', 'en_route');

CREATE INDEX IF NOT EXISTS idx_passenger_ride_requests_status_date
  ON passenger_ride_requests(status, requested_date)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_driver_ride_availability_status_departure
  ON driver_ride_availability(status, departure_time)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_bookings_ride_status
  ON bookings(ride_id, status);

CREATE INDEX IF NOT EXISTS idx_rides_driver_departure
  ON rides(driver_id, departure_time DESC);
