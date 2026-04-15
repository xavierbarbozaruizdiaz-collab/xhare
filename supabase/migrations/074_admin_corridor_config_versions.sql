-- Fase A: versionado/publicación de configuración de corredores para rollback seguro.

CREATE TABLE IF NOT EXISTS public.admin_corridor_config_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  note text,
  is_published boolean NOT NULL DEFAULT false,
  corridors_snapshot jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_corridor_config_versions_created_at
  ON public.admin_corridor_config_versions (created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_corridor_config_versions_published_true
  ON public.admin_corridor_config_versions (is_published)
  WHERE is_published = true;

COMMENT ON TABLE public.admin_corridor_config_versions IS
  'Versiones de configuración de corredores (snapshot completo) para publicar/rollback.';

ALTER TABLE public.admin_corridor_config_versions ENABLE ROW LEVEL SECURITY;
