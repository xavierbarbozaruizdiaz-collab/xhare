-- Solicitudes de trayecto: pasajeros guardan origen/destino/fecha cuando no hay viajes.
-- Los conductores pueden verlas y crear un viaje para una solicitud (se vincula ride_id).

CREATE TABLE IF NOT EXISTS trip_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  origin_lat double precision NOT NULL,
  origin_lng double precision NOT NULL,
  origin_label text,
  destination_lat double precision NOT NULL,
  destination_lng double precision NOT NULL,
  destination_label text,
  requested_date date NOT NULL,
  seats int NOT NULL DEFAULT 1 CHECK (seats >= 1 AND seats <= 50),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  ride_id uuid REFERENCES rides(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trip_requests_user ON trip_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_trip_requests_status ON trip_requests(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_trip_requests_date ON trip_requests(requested_date);
CREATE INDEX IF NOT EXISTS idx_trip_requests_ride ON trip_requests(ride_id) WHERE ride_id IS NOT NULL;

ALTER TABLE trip_requests ENABLE ROW LEVEL SECURITY;

-- El autor puede ver y crear sus solicitudes; puede actualizar solo las propias (cancelar).
CREATE POLICY "Users can view own trip_requests"
  ON trip_requests FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own trip_requests"
  ON trip_requests FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own pending trip_requests"
  ON trip_requests FOR UPDATE
  USING (user_id = auth.uid() AND status = 'pending')
  WITH CHECK (user_id = auth.uid());

-- Conductores y admins pueden ver todas las solicitudes pendientes (para ofrecer viajes).
CREATE POLICY "Drivers and admins can view pending trip_requests"
  ON trip_requests FOR SELECT
  USING (
    status = 'pending'
    AND (
      EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'driver')
      OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
    )
  );

-- Solo el sistema (o un conductor al crear el viaje) puede vincular ride_id y poner status = accepted.
-- Lo hacemos vía service role o función SECURITY DEFINER, o permitir update cuando el usuario es conductor
-- y está actualizando ride_id/status. Para que el front pueda hacerlo: policy que permita update
-- si el usuario es conductor y la solicitud está pending (el backend asigna ride_id tras crear el ride).
CREATE POLICY "Drivers can accept trip_requests (set ride_id and status)"
  ON trip_requests FOR UPDATE
  USING (
    status = 'pending'
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('driver', 'admin'))
  )
  WITH CHECK (true);

COMMENT ON TABLE trip_requests IS 'Solicitudes de trayecto cuando no hay viajes; conductores pueden crear viaje y vincular.';
