-- Habilitar Realtime para driver_offers (notificación en app cuando aceptan tu oferta).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'driver_offers'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE driver_offers;
  END IF;
END $$;
