-- Rutas con demanda agrupadas (hasta 15 por grupo). Filtro por ciudad/barrio.
-- trip_requests: ciudad/departamento/barrio para origen y destino (reverse geocode o usuario).
-- demand_route_groups: base de cada agrupación (polyline, fecha, hora, ciudad, count).
-- demand_route_members: qué solicitudes pertenecen a cada grupo.

-- 1. Campos de lugar en trip_requests (para filtrado y etiquetado del grupo)
ALTER TABLE trip_requests
  ADD COLUMN IF NOT EXISTS origin_city text,
  ADD COLUMN IF NOT EXISTS origin_department text,
  ADD COLUMN IF NOT EXISTS origin_barrio text,
  ADD COLUMN IF NOT EXISTS destination_city text,
  ADD COLUMN IF NOT EXISTS destination_department text,
  ADD COLUMN IF NOT EXISTS destination_barrio text;

COMMENT ON COLUMN trip_requests.origin_city IS 'Ciudad del origen (filtro y etiqueta).';
COMMENT ON COLUMN trip_requests.origin_barrio IS 'Barrio del origen (opcional).';
COMMENT ON COLUMN trip_requests.destination_city IS 'Ciudad del destino (filtro).';

-- 2. Polyline y longitud por solicitud (OSRM); permite elegir base y revalidar sin llamar OSRM cada vez
ALTER TABLE trip_requests
  ADD COLUMN IF NOT EXISTS route_polyline jsonb,
  ADD COLUMN IF NOT EXISTS route_length_km double precision;

COMMENT ON COLUMN trip_requests.route_polyline IS 'Polyline OSRM origen→destino [{lat,lng},...].';
COMMENT ON COLUMN trip_requests.route_length_km IS 'Longitud en km de la ruta (para rebase por extensión).';

-- 3. Estado group_linked_pending: conductor publicó para el grupo, solicitud vinculada a ride pendiente de confirmar
ALTER TABLE trip_requests DROP CONSTRAINT IF EXISTS trip_requests_status_check;
ALTER TABLE trip_requests
  ADD CONSTRAINT trip_requests_status_check
  CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled', 'group_linked_pending'));

COMMENT ON COLUMN trip_requests.status IS 'pending | accepted | expired | cancelled | group_linked_pending (vinculada a grupo/ride en curso).';

-- 4. Tabla de grupos (rutas con demanda agrupadas)
CREATE TABLE IF NOT EXISTS demand_route_groups (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  base_polyline jsonb NOT NULL,
  base_length_km double precision NOT NULL,
  base_trip_request_id uuid REFERENCES trip_requests(id) ON DELETE SET NULL,
  requested_date date NOT NULL,
  requested_time time NOT NULL,
  origin_city text,
  origin_department text,
  origin_barrio text,
  destination_city text,
  destination_department text,
  destination_barrio text,
  passenger_count int NOT NULL DEFAULT 0 CHECK (passenger_count >= 0 AND passenger_count <= 15),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demand_route_groups_date ON demand_route_groups(requested_date);
CREATE INDEX IF NOT EXISTS idx_demand_route_groups_origin_city ON demand_route_groups(origin_city);
CREATE INDEX IF NOT EXISTS idx_demand_route_groups_dest_city ON demand_route_groups(destination_city);

COMMENT ON TABLE demand_route_groups IS 'Rutas con demanda agrupadas (base polyline, fecha, hora, ciudad, hasta 15 pasajeros).';

ALTER TABLE demand_route_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view demand_route_groups" ON demand_route_groups;
CREATE POLICY "Anyone can view demand_route_groups"
  ON demand_route_groups FOR SELECT
  USING (true);

-- Inserts/updates/deletes solo vía service role o funciones (backend); sin policy de insert para anon.
-- Los conductores y pasajeros solo leen; el backend agrupa al crear/cancelar trip_requests.

-- 5. Miembros de cada grupo
CREATE TABLE IF NOT EXISTS demand_route_members (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id uuid NOT NULL REFERENCES demand_route_groups(id) ON DELETE CASCADE,
  trip_request_id uuid NOT NULL REFERENCES trip_requests(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(trip_request_id)
);

CREATE INDEX IF NOT EXISTS idx_demand_route_members_group ON demand_route_members(group_id);
CREATE INDEX IF NOT EXISTS idx_demand_route_members_request ON demand_route_members(trip_request_id);

COMMENT ON TABLE demand_route_members IS 'Qué trip_requests pertenecen a cada demand_route_group.';

ALTER TABLE demand_route_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view demand_route_members" ON demand_route_members;
CREATE POLICY "Anyone can view demand_route_members"
  ON demand_route_members FOR SELECT
  USING (true);
