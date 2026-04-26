-- Historial de corridas del pipeline de demanda (HEX-only en runtime).
-- Objetivo: visibilidad operativa desde panel admin sin depender de logs externos.

CREATE TABLE IF NOT EXISTS public.demand_grouping_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_source text NOT NULL CHECK (trigger_source IN ('cron_get', 'cron_post', 'manual', 'unknown')),
  engine_mode text NOT NULL DEFAULT 'hex_only' CHECK (engine_mode IN ('hex_only', 'legacy')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms int,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  trip_requests_grouped int NOT NULL DEFAULT 0,
  groups_created int NOT NULL DEFAULT 0,
  groups_merged int NOT NULL DEFAULT 0,
  http_status int,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_demand_grouping_runs_started_at_desc
  ON public.demand_grouping_runs (started_at DESC);

ALTER TABLE public.demand_grouping_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read demand grouping runs" ON public.demand_grouping_runs;
CREATE POLICY "Admins can read demand grouping runs"
  ON public.demand_grouping_runs
  FOR SELECT
  USING (is_admin(auth.uid()));

