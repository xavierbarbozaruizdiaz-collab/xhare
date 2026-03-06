-- Admin pricing: valores 100% + descuento para derivar tarifa efectiva.
-- Fallback en app: si no hay fila activa, usar MIN_FARE_PYG=7140, PYG_PER_KM=2780, block 4, 1.5, round 100.

CREATE TABLE IF NOT EXISTS pricing_settings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  min_fare_100 int NOT NULL CHECK (min_fare_100 >= 0),
  pyg_per_km_100 int NOT NULL CHECK (pyg_per_km_100 >= 0),
  discount_percent int NOT NULL DEFAULT 0 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  round_to int NOT NULL DEFAULT 100 CHECK (round_to > 0),
  block_size int NOT NULL DEFAULT 4 CHECK (block_size > 0),
  block_multiplier numeric(5,2) NOT NULL DEFAULT 1.5 CHECK (block_multiplier > 0),
  driver_fee_per_completed_ride int NOT NULL DEFAULT 2000 CHECK (driver_fee_per_completed_ride >= 0),
  driver_debt_limit_default int NOT NULL DEFAULT 50000 CHECK (driver_debt_limit_default >= 0),
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE pricing_settings IS 'Configuración de tarifas admin: valores 100%, descuento y fee por viaje completado. Solo una fila con is_active=true.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_pricing_settings_single_active
  ON pricing_settings ((1)) WHERE (is_active = true);

ALTER TABLE pricing_settings ENABLE ROW LEVEL SECURITY;

-- Authenticated puede leer solo el settings activo (para cálculo de precio en reserva).
CREATE POLICY "Authenticated can read active pricing_settings"
  ON pricing_settings FOR SELECT
  TO authenticated
  USING (is_active = true);

-- Solo admin puede insertar/actualizar/eliminar.
CREATE POLICY "Admin can manage pricing_settings"
  ON pricing_settings FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));
