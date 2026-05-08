-- Documentos de conductor cargados desde dispositivo.
-- Flujo: conductor sube/actualiza, admin revisa (aprobar/rechazar).

CREATE TABLE IF NOT EXISTS public.driver_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN ('passenger_insurance', 'dinatran_permit', 'cedula_verde')),
  storage_bucket text NOT NULL DEFAULT 'driver-documents',
  storage_path text NOT NULL,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_notes text,
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  expires_at date,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, doc_type)
);

CREATE INDEX IF NOT EXISTS idx_driver_documents_driver_id ON public.driver_documents(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_documents_status ON public.driver_documents(status);

CREATE OR REPLACE FUNCTION public.driver_documents_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_driver_documents_updated_at ON public.driver_documents;
CREATE TRIGGER trg_driver_documents_updated_at
BEFORE UPDATE ON public.driver_documents
FOR EACH ROW
EXECUTE FUNCTION public.driver_documents_set_updated_at();

ALTER TABLE public.driver_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Drivers select own documents" ON public.driver_documents;
CREATE POLICY "Drivers select own documents"
  ON public.driver_documents
  FOR SELECT
  TO authenticated
  USING (
    driver_id = auth.uid()
    OR public.is_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Drivers upsert own documents as pending" ON public.driver_documents;
CREATE POLICY "Drivers upsert own documents as pending"
  ON public.driver_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    driver_id = auth.uid()
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
  );

DROP POLICY IF EXISTS "Drivers update own documents as pending" ON public.driver_documents;
CREATE POLICY "Drivers update own documents as pending"
  ON public.driver_documents
  FOR UPDATE
  TO authenticated
  USING (driver_id = auth.uid())
  WITH CHECK (
    driver_id = auth.uid()
    AND status = 'pending'
  );

DROP POLICY IF EXISTS "Admins update any driver document" ON public.driver_documents;
CREATE POLICY "Admins update any driver document"
  ON public.driver_documents
  FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'driver-documents',
  'driver-documents',
  false,
  5242880,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Drivers insert own driver documents objects" ON storage.objects;
CREATE POLICY "Drivers insert own driver documents objects"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'driver-documents'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR public.is_admin(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Drivers update own driver documents objects" ON storage.objects;
CREATE POLICY "Drivers update own driver documents objects"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'driver-documents'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR public.is_admin(auth.uid())
    )
  )
  WITH CHECK (
    bucket_id = 'driver-documents'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR public.is_admin(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Drivers select own driver documents objects" ON storage.objects;
CREATE POLICY "Drivers select own driver documents objects"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'driver-documents'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR public.is_admin(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Drivers delete own driver documents objects" ON storage.objects;
CREATE POLICY "Drivers delete own driver documents objects"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'driver-documents'
    AND (
      split_part(name, '/', 1) = auth.uid()::text
      OR public.is_admin(auth.uid())
    )
  );
