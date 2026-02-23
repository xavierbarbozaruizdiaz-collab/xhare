-- Flujo tipo InDrive, separado del flujo actual (precio fijo).
-- 1) Pasajero publica "Busco viaje" → conductores envían ofertas.
-- 2) Conductor publica "Tengo lugar" → pasajeros envían ofertas.
-- Incluye tiempo límite para aceptar ofertas (expires_at).

-- Solicitudes de pasajero "Busco viaje" (origen, destino, fecha/hora, precio sugerido opcional)
CREATE TABLE IF NOT EXISTS passenger_ride_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  origin_lat double precision NOT NULL,
  origin_lng double precision NOT NULL,
  origin_label text,
  destination_lat double precision NOT NULL,
  destination_lng double precision NOT NULL,
  destination_label text,
  requested_date date NOT NULL,
  requested_time time,
  seats int NOT NULL DEFAULT 1 CHECK (seats >= 1 AND seats <= 20),
  suggested_price_per_seat numeric(10, 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'expired', 'cancelled')),
  accept_offers_until timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_passenger_ride_requests_user ON passenger_ride_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_passenger_ride_requests_status ON passenger_ride_requests(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_passenger_ride_requests_date ON passenger_ride_requests(requested_date);

-- Ofertas de conductores a una solicitud "Busco viaje"
CREATE TABLE IF NOT EXISTS driver_offers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  passenger_request_id uuid NOT NULL REFERENCES passenger_ride_requests(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  proposed_price_per_seat numeric(10, 0) NOT NULL,
  message text,
  ride_id uuid REFERENCES rides(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired', 'cancelled')),
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(passenger_request_id, driver_id)
);

CREATE INDEX IF NOT EXISTS idx_driver_offers_request ON driver_offers(passenger_request_id);
CREATE INDEX IF NOT EXISTS idx_driver_offers_driver ON driver_offers(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_offers_status ON driver_offers(status) WHERE status = 'pending';

-- Conductor publica "Tengo lugar" (origen, destino, horario, asientos, precio sugerido opcional)
CREATE TABLE IF NOT EXISTS driver_ride_availability (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  origin_lat double precision NOT NULL,
  origin_lng double precision NOT NULL,
  origin_label text,
  destination_lat double precision NOT NULL,
  destination_lng double precision NOT NULL,
  destination_label text,
  departure_time timestamptz NOT NULL,
  available_seats int NOT NULL DEFAULT 1 CHECK (available_seats >= 1 AND available_seats <= 20),
  suggested_price_per_seat numeric(10, 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'expired', 'cancelled')),
  accept_offers_until timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_ride_availability_driver ON driver_ride_availability(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_ride_availability_status ON driver_ride_availability(status) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_driver_ride_availability_departure ON driver_ride_availability(departure_time);

-- Ofertas de pasajeros a "Tengo lugar"
CREATE TABLE IF NOT EXISTS passenger_offers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  availability_id uuid NOT NULL REFERENCES driver_ride_availability(id) ON DELETE CASCADE,
  passenger_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  offered_price_per_seat numeric(10, 0) NOT NULL,
  seats int NOT NULL DEFAULT 1 CHECK (seats >= 1 AND seats <= 20),
  message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'expired', 'cancelled')),
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(availability_id, passenger_id)
);

CREATE INDEX IF NOT EXISTS idx_passenger_offers_availability ON passenger_offers(availability_id);
CREATE INDEX IF NOT EXISTS idx_passenger_offers_passenger ON passenger_offers(passenger_id);
CREATE INDEX IF NOT EXISTS idx_passenger_offers_status ON passenger_offers(status) WHERE status = 'pending';

ALTER TABLE passenger_ride_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_ride_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE passenger_offers ENABLE ROW LEVEL SECURITY;

-- RLS passenger_ride_requests: autor ve las suyas; conductores y cualquiera pueden ver open (para listar)
CREATE POLICY "Users view own passenger_ride_requests"
  ON passenger_ride_requests FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Drivers and all view open passenger_ride_requests"
  ON passenger_ride_requests FOR SELECT
  USING (
    status = 'open'
    AND (auth.uid() IS NOT NULL)
  );

CREATE POLICY "Users insert own passenger_ride_requests"
  ON passenger_ride_requests FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own passenger_ride_requests"
  ON passenger_ride_requests FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- RLS driver_offers: pasajero (dueño del request) ve ofertas a su request; conductor ve las suyas
CREATE POLICY "Passenger views driver_offers to own request"
  ON driver_offers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM passenger_ride_requests prr
      WHERE prr.id = driver_offers.passenger_request_id AND prr.user_id = auth.uid()
    )
  );

CREATE POLICY "Driver views own driver_offers"
  ON driver_offers FOR SELECT
  USING (driver_id = auth.uid());

CREATE POLICY "Drivers insert driver_offers"
  ON driver_offers FOR INSERT
  WITH CHECK (
    driver_id = auth.uid()
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'driver')
  );

CREATE POLICY "Driver can update own offer"
  ON driver_offers FOR UPDATE
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());

CREATE POLICY "Passenger can update driver_offers for own request (accept/reject)"
  ON driver_offers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM passenger_ride_requests prr
      WHERE prr.id = driver_offers.passenger_request_id AND prr.user_id = auth.uid()
    )
  )
  WITH CHECK (true);

-- RLS driver_ride_availability: conductor ve las suyas; pasajeros ven open
CREATE POLICY "Driver views own driver_ride_availability"
  ON driver_ride_availability FOR SELECT
  USING (driver_id = auth.uid());

CREATE POLICY "All view open driver_ride_availability"
  ON driver_ride_availability FOR SELECT
  USING (status = 'open' AND auth.uid() IS NOT NULL);

CREATE POLICY "Drivers insert driver_ride_availability"
  ON driver_ride_availability FOR INSERT
  WITH CHECK (driver_id = auth.uid() AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'driver'));

CREATE POLICY "Driver updates own driver_ride_availability"
  ON driver_ride_availability FOR UPDATE
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());

-- RLS passenger_offers: conductor (dueño de availability) ve ofertas; pasajero ve las suyas
CREATE POLICY "Driver views passenger_offers to own availability"
  ON passenger_offers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM driver_ride_availability dra
      WHERE dra.id = passenger_offers.availability_id AND dra.driver_id = auth.uid()
    )
  );

CREATE POLICY "Passenger views own passenger_offers"
  ON passenger_offers FOR SELECT
  USING (passenger_id = auth.uid());

CREATE POLICY "Passengers insert passenger_offers"
  ON passenger_offers FOR INSERT
  WITH CHECK (passenger_id = auth.uid());

CREATE POLICY "Passenger can update own offer"
  ON passenger_offers FOR UPDATE
  USING (passenger_id = auth.uid())
  WITH CHECK (passenger_id = auth.uid());

CREATE POLICY "Driver can update passenger_offers for own availability (accept/reject)"
  ON passenger_offers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM driver_ride_availability dra
      WHERE dra.id = passenger_offers.availability_id AND dra.driver_id = auth.uid()
    )
  )
  WITH CHECK (true);

COMMENT ON TABLE passenger_ride_requests IS 'Flujo oferta: pasajero publica "Busco viaje".';
COMMENT ON TABLE driver_offers IS 'Flujo oferta: ofertas de conductores a una solicitud Busco viaje.';
COMMENT ON TABLE driver_ride_availability IS 'Flujo oferta: conductor publica "Tengo lugar".';
COMMENT ON TABLE passenger_offers IS 'Flujo oferta: ofertas de pasajeros a un Tengo lugar.';
