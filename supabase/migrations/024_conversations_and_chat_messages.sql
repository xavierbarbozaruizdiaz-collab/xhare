-- Mensajería para toda la app: conversaciones entre usuarios, opcionalmente ligadas a un viaje, oferta o solicitud.
-- No reemplaza la tabla messages (ride-scoped); esta es la mensajería unificada para rides, ofertas y uso general.

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  context_type text CHECK (context_type IN ('ride', 'passenger_request', 'driver_offer', 'driver_availability', 'passenger_offer', 'direct')),
  context_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_context ON conversations(context_type, context_id) WHERE context_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  last_read_at timestamptz,
  joined_at timestamptz DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_participants_user ON conversation_participants(user_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(conversation_id, created_at);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Solo participantes pueden ver la conversación
CREATE POLICY "Participants can view conversation"
  ON conversations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = conversations.id AND cp.user_id = auth.uid()
    )
  );

-- Cualquier usuario puede crear una conversación (el flujo crea conversación + participantes en una transacción)
CREATE POLICY "Authenticated can create conversation"
  ON conversations FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Solo participantes pueden insertar en conversation_participants (evitar que alguien se agregue a cualquier chat)
-- En la práctica la creación la hace quien inicia el chat; permitimos insert si auth.uid() es uno de los que se agrega
CREATE POLICY "Users can add self to conversation"
  ON conversation_participants FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Participants can view conversation_participants"
  ON conversation_participants FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM conversation_participants cp2
      WHERE cp2.conversation_id = conversation_participants.conversation_id AND cp2.user_id = auth.uid()
    )
  );

CREATE POLICY "Participants can update own last_read_at"
  ON conversation_participants FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Mensajes: solo participantes pueden ver e insertar
CREATE POLICY "Participants can view chat_messages"
  ON chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = chat_messages.conversation_id AND cp.user_id = auth.uid()
    )
  );

CREATE POLICY "Participants can send chat_messages"
  ON chat_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM conversation_participants cp
      WHERE cp.conversation_id = chat_messages.conversation_id AND cp.user_id = auth.uid()
    )
  );

-- Función para crear conversación entre dos usuarios (y opcionalmente vincular contexto)
CREATE OR REPLACE FUNCTION create_conversation(
  p_other_user_id uuid,
  p_context_type text DEFAULT 'direct',
  p_context_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conv_id uuid;
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL OR p_other_user_id IS NULL OR v_me = p_other_user_id THEN
    RETURN NULL;
  END IF;
  INSERT INTO conversations (context_type, context_id)
  VALUES (COALESCE(NULLIF(p_context_type, ''), 'direct'), p_context_id)
  RETURNING id INTO v_conv_id;
  INSERT INTO conversation_participants (conversation_id, user_id)
  VALUES (v_conv_id, v_me), (v_conv_id, p_other_user_id);
  RETURN v_conv_id;
END;
$$;

COMMENT ON FUNCTION create_conversation(uuid, text, uuid) IS 'Crea una conversación entre el usuario actual y otro; opcionalmente ligada a ride/offer/request.';
GRANT EXECUTE ON FUNCTION create_conversation(uuid, text, uuid) TO authenticated;

-- Obtener o crear conversación (evita duplicados por mismo par + contexto)
CREATE OR REPLACE FUNCTION get_or_create_conversation(
  p_other_user_id uuid,
  p_context_type text DEFAULT 'direct',
  p_context_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
  v_conv_id uuid;
BEGIN
  IF v_me IS NULL OR p_other_user_id IS NULL OR v_me = p_other_user_id THEN
    RETURN NULL;
  END IF;
  SELECT c.id INTO v_conv_id
  FROM conversations c
  JOIN conversation_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = v_me
  JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = p_other_user_id
  WHERE (c.context_type IS NOT DISTINCT FROM NULLIF(TRIM(p_context_type), '') OR (c.context_type = COALESCE(NULLIF(TRIM(p_context_type), ''), 'direct')))
    AND (c.context_id IS NOT DISTINCT FROM p_context_id)
  LIMIT 1;
  IF v_conv_id IS NOT NULL THEN
    RETURN v_conv_id;
  END IF;
  INSERT INTO conversations (context_type, context_id)
  VALUES (COALESCE(NULLIF(TRIM(p_context_type), ''), 'direct'), p_context_id)
  RETURNING id INTO v_conv_id;
  INSERT INTO conversation_participants (conversation_id, user_id)
  VALUES (v_conv_id, v_me), (v_conv_id, p_other_user_id);
  RETURN v_conv_id;
END;
$$;
GRANT EXECUTE ON FUNCTION get_or_create_conversation(uuid, text, uuid) TO authenticated;

-- Listar conversaciones del usuario con último mensaje y sin leer
CREATE OR REPLACE FUNCTION get_my_conversations(p_user_id uuid)
RETURNS TABLE(
  conversation_id uuid,
  other_user_id uuid,
  other_user_name text,
  other_user_avatar text,
  context_type text,
  context_id uuid,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    c.id AS conversation_id,
    (SELECT cp2.user_id FROM conversation_participants cp2 WHERE cp2.conversation_id = c.id AND cp2.user_id != p_user_id LIMIT 1) AS other_user_id,
    (SELECT p.full_name FROM conversation_participants cp2 JOIN profiles p ON p.id = cp2.user_id WHERE cp2.conversation_id = c.id AND cp2.user_id != p_user_id LIMIT 1) AS other_user_name,
    (SELECT p.avatar_url FROM conversation_participants cp2 JOIN profiles p ON p.id = cp2.user_id WHERE cp2.conversation_id = c.id AND cp2.user_id != p_user_id LIMIT 1) AS other_user_avatar,
    c.context_type,
    c.context_id,
    (SELECT MAX(m.created_at) FROM chat_messages m WHERE m.conversation_id = c.id) AS last_message_at,
    (SELECT LEFT(m.body, 60) FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_preview,
    (SELECT COUNT(*)::bigint FROM chat_messages m
     JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = p_user_id
     WHERE m.conversation_id = c.id AND m.sender_id != p_user_id
       AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)) AS unread_count
  FROM conversations c
  JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = p_user_id
  ORDER BY last_message_at DESC NULLS LAST;
$$;
GRANT EXECUTE ON FUNCTION get_my_conversations(uuid) TO authenticated;

COMMENT ON TABLE conversations IS 'Conversaciones de la app (rides, ofertas, directo).';
COMMENT ON TABLE chat_messages IS 'Mensajes dentro de una conversación; uso en toda la app.';
