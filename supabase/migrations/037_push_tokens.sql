-- Tokens FCM/APNS para enviar notificaciones push a la app.
-- Un usuario puede tener varios dispositivos (varios tokens).

CREATE TABLE IF NOT EXISTS push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id);

COMMENT ON TABLE push_tokens IS 'Tokens de dispositivos para notificaciones push (FCM/APNS).';

-- RLS: cada usuario solo puede insertar/ver/borrar sus propios tokens.
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own push tokens" ON push_tokens;
CREATE POLICY "Users can manage own push tokens"
  ON push_tokens
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
