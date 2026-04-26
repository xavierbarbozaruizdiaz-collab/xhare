-- Auditoría legal de aceptación de TyC/Privacidad.

CREATE TABLE IF NOT EXISTS public.legal_acceptance_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('web', 'mobile')),
  terms_version text NOT NULL,
  privacy_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_legal_acceptance_events_user
  ON public.legal_acceptance_events(user_id, accepted_at DESC);

ALTER TABLE public.legal_acceptance_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own legal acceptance events" ON public.legal_acceptance_events;
CREATE POLICY "Users can view own legal acceptance events"
  ON public.legal_acceptance_events
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all legal acceptance events" ON public.legal_acceptance_events;
CREATE POLICY "Admins can view all legal acceptance events"
  ON public.legal_acceptance_events
  FOR SELECT
  USING (is_admin(auth.uid()));

DROP POLICY IF EXISTS "Service can insert legal acceptance events" ON public.legal_acceptance_events;
CREATE POLICY "Service can insert legal acceptance events"
  ON public.legal_acceptance_events
  FOR INSERT
  WITH CHECK (true);
