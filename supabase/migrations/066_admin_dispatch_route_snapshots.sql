-- Registros de ruta manual armada en /admin/dispatch-map (auditoría; la app conductor/pasajero aún no lee esta tabla).
CREATE TABLE IF NOT EXISTS public.admin_dispatch_route_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  map_date_from date,
  map_date_to date,
  duration_minutes integer,
  polyline jsonb NOT NULL DEFAULT '[]'::jsonb,
  stops jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL DEFAULT 'dispatch_map'
);

CREATE INDEX IF NOT EXISTS idx_admin_dispatch_route_snapshots_created_at
  ON public.admin_dispatch_route_snapshots (created_at DESC);

COMMENT ON TABLE public.admin_dispatch_route_snapshots IS
  'Snapshot de polilínea + paradas desde el mapa de despacho admin. Insertado solo vía API Next (service role).';

ALTER TABLE public.admin_dispatch_route_snapshots ENABLE ROW LEVEL SECURITY;
