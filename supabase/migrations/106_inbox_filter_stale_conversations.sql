-- Inbox: no listar chats de contextos cerrados ni hilos sin mensajes.
-- Alineado con get_or_create_ride_contact_conversation (contacto cerrado al completar/cancelar viaje).

CREATE OR REPLACE FUNCTION public.conversation_visible_in_inbox(
  p_context_type text,
  p_context_id uuid,
  p_conversation_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.chat_messages m
      WHERE m.conversation_id = p_conversation_id
    )
    AND CASE
      WHEN p_context_type IS NULL
        OR p_context_type = 'direct'
        OR p_context_id IS NULL THEN true
      WHEN p_context_type = 'ride' THEN EXISTS (
        SELECT 1
        FROM public.rides r
        WHERE r.id = p_context_id
          AND r.status NOT IN ('completed', 'cancelled')
      )
      WHEN p_context_type = 'passenger_request' THEN EXISTS (
        SELECT 1
        FROM public.passenger_ride_requests prr
        WHERE prr.id = p_context_id
          AND prr.status = 'open'
      )
      WHEN p_context_type = 'driver_availability' THEN EXISTS (
        SELECT 1
        FROM public.driver_ride_availability dra
        WHERE dra.id = p_context_id
          AND dra.status = 'open'
      )
      WHEN p_context_type = 'driver_offer' THEN EXISTS (
        SELECT 1
        FROM public.driver_offers dfo
        WHERE dfo.id = p_context_id
          AND dfo.status = 'pending'
      )
      WHEN p_context_type = 'passenger_offer' THEN EXISTS (
        SELECT 1
        FROM public.passenger_offers pfo
        WHERE pfo.id = p_context_id
          AND pfo.status = 'pending'
      )
      ELSE false
    END;
$$;

COMMENT ON FUNCTION public.conversation_visible_in_inbox(text, uuid, uuid) IS
  'True si la conversación debe aparecer en el inbox: al menos un mensaje y contexto operativo (viaje no finalizado, oferta abierta, etc.).';

GRANT EXECUTE ON FUNCTION public.conversation_visible_in_inbox(text, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_conversations(p_user_id uuid)
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
    (
      SELECT cp2.user_id
      FROM public.conversation_participants cp2
      WHERE cp2.conversation_id = c.id
        AND cp2.user_id != p_user_id
      LIMIT 1
    ) AS other_user_id,
    (
      SELECT p.full_name
      FROM public.conversation_participants cp2
      JOIN public.profiles p ON p.id = cp2.user_id
      WHERE cp2.conversation_id = c.id
        AND cp2.user_id != p_user_id
      LIMIT 1
    ) AS other_user_name,
    (
      SELECT p.avatar_url
      FROM public.conversation_participants cp2
      JOIN public.profiles p ON p.id = cp2.user_id
      WHERE cp2.conversation_id = c.id
        AND cp2.user_id != p_user_id
      LIMIT 1
    ) AS other_user_avatar,
    c.context_type,
    c.context_id,
    (
      SELECT MAX(m.created_at)
      FROM public.chat_messages m
      WHERE m.conversation_id = c.id
    ) AS last_message_at,
    (
      SELECT LEFT(m.body, 60)
      FROM public.chat_messages m
      WHERE m.conversation_id = c.id
      ORDER BY m.created_at DESC
      LIMIT 1
    ) AS last_message_preview,
    (
      SELECT COUNT(*)::bigint
      FROM public.chat_messages m
      JOIN public.conversation_participants cp_read
        ON cp_read.conversation_id = m.conversation_id
       AND cp_read.user_id = p_user_id
      WHERE m.conversation_id = c.id
        AND m.sender_id != p_user_id
        AND (
          cp_read.last_read_at IS NULL
          OR m.created_at > cp_read.last_read_at
        )
    ) AS unread_count
  FROM public.conversations c
  JOIN public.conversation_participants cp
    ON cp.conversation_id = c.id
   AND cp.user_id = p_user_id
  WHERE p_user_id = auth.uid()
    AND public.conversation_visible_in_inbox(c.context_type, c.context_id, c.id)
  ORDER BY last_message_at DESC NULLS LAST;
$$;

COMMENT ON FUNCTION public.get_my_conversations(uuid) IS
  'Inbox del usuario: solo conversaciones con mensajes y contexto activo (viaje no completado/cancelado, oferta/solicitud abierta).';

GRANT EXECUTE ON FUNCTION public.get_my_conversations(uuid) TO authenticated;
