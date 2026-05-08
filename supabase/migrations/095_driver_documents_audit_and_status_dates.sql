-- Hardening de documentos: marcas temporales por estado + auditoría de acciones.

ALTER TABLE public.driver_documents
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz;

CREATE TABLE IF NOT EXISTS public.driver_document_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_document_id uuid NOT NULL REFERENCES public.driver_documents(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id),
  action text NOT NULL CHECK (action IN ('uploaded', 'replaced', 'approved', 'rejected', 'expiry_set')),
  prev_status text,
  new_status text,
  prev_expires_at date,
  new_expires_at date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_doc_audit_driver_id ON public.driver_document_audit_logs(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_doc_audit_doc_id ON public.driver_document_audit_logs(driver_document_id);

ALTER TABLE public.driver_document_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Drivers and admins read driver document audit logs" ON public.driver_document_audit_logs;
CREATE POLICY "Drivers and admins read driver document audit logs"
  ON public.driver_document_audit_logs
  FOR SELECT
  TO authenticated
  USING (
    driver_id = auth.uid()
    OR public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Admins insert driver document audit logs" ON public.driver_document_audit_logs;
CREATE POLICY "Admins insert driver document audit logs"
  ON public.driver_document_audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));
