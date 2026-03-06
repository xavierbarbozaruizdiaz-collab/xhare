-- Cuentas de chofer (deuda, límite, suspensión) y cargos por viaje completado.

CREATE TABLE IF NOT EXISTS driver_accounts (
  driver_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  account_status text NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'suspended')),
  debt_pyg int NOT NULL DEFAULT 0 CHECK (debt_pyg >= 0),
  debt_limit_pyg int NOT NULL DEFAULT 50000 CHECK (debt_limit_pyg >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE driver_accounts IS 'Una fila por conductor; se crea on-demand al completar el primer viaje. debt_pyg = suma de cargos pending.';

CREATE TABLE IF NOT EXISTS driver_charges (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  ride_id uuid NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount_pyg int NOT NULL CHECK (amount_pyg >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(ride_id, driver_id)
);

COMMENT ON TABLE driver_charges IS 'Un cargo por viaje completado (ride_id + driver_id). Idempotente por unique.';

CREATE INDEX IF NOT EXISTS idx_driver_charges_driver_status ON driver_charges(driver_id, status);

ALTER TABLE driver_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE driver_charges ENABLE ROW LEVEL SECURITY;

-- Conductor ve solo su cuenta.
CREATE POLICY "Driver can view own driver_accounts"
  ON driver_accounts FOR SELECT
  TO authenticated
  USING (driver_id = auth.uid());

-- Admin ve y puede actualizar todas (suspender/reactivar, etc.).
CREATE POLICY "Admin can manage driver_accounts"
  ON driver_accounts FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- Conductor ve solo sus cargos.
CREATE POLICY "Driver can view own driver_charges"
  ON driver_charges FOR SELECT
  TO authenticated
  USING (driver_id = auth.uid());

-- Admin ve todos y puede actualizar (marcar pagado).
CREATE POLICY "Admin can manage driver_charges"
  ON driver_charges FOR ALL
  TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));
