-- Permitir APK oficiales en el bucket publico de /descargar.
-- El bucket nacio solo para imagenes (8 MB). El tope del proyecto es 50 MB.

UPDATE storage.buckets
SET
  public = true,
  file_size_limit = 52428800,
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/avif',
    'application/vnd.android.package-archive',
    'application/octet-stream'
  ]
WHERE id = 'app-releases';
