-- Atajos de Inicio (Casa↔Trabajo) con switch activo: visibles en mapa admin para despacho.
-- El pasajero sigue usando AsyncStorage; la app sincroniza acá cuando guarda / activa / borra.

CREATE TABLE IF NOT EXISTS passenger_home_map_shortcuts (
  user_id uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  slot text NOT NULL CHECK (slot IN ('home_to_work', 'work_to_home')),
  enabled boolean NOT NULL DEFAULT false,
  origin_label text,
  destination_label text,
  origin_lat double precision,
  origin_lng double precision,
  destination_lat double precision,
  destination_lng double precision,
  scheduled_date date NOT NULL,
  scheduled_time text NOT NULL DEFAULT '08:00',
  schedule_daily boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_passenger_home_map_shortcuts_enabled
  ON passenger_home_map_shortcuts (enabled)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_passenger_home_map_shortcuts_date
  ON passenger_home_map_shortcuts (scheduled_date);

ALTER TABLE passenger_home_map_shortcuts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own passenger_home_map_shortcuts"
  ON passenger_home_map_shortcuts
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

COMMENT ON TABLE passenger_home_map_shortcuts IS
  'Sincronizado desde la app: favoritos de Inicio activos para mostrar en mapa admin (no reemplaza trip_requests).';
