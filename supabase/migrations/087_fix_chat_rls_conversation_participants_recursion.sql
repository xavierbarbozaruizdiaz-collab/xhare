-- Fix 42P17: infinite recursion in policy for relation "conversation_participants".
-- Root cause: existing policies reference `conversation_participants` from inside
-- policies on the same table; Postgres re-enters policy evaluation recursively.
--
-- Strategy:
-- 1) Add SECURITY DEFINER helper that checks membership bypassing RLS recursion.
-- 2) Recreate SELECT policies on conversations / conversation_participants / chat_messages
--    using that helper.

CREATE OR REPLACE FUNCTION public.is_conversation_participant(
  p_conversation_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = p_conversation_id
      AND cp.user_id = p_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_conversation_participant(uuid, uuid) TO authenticated;

DROP POLICY IF EXISTS "Participants can view conversation" ON public.conversations;
CREATE POLICY "Participants can view conversation"
  ON public.conversations
  FOR SELECT
  USING (public.is_conversation_participant(id, auth.uid()));

DROP POLICY IF EXISTS "Participants can view conversation_participants" ON public.conversation_participants;
CREATE POLICY "Participants can view conversation_participants"
  ON public.conversation_participants
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_conversation_participant(conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS "Participants can view chat_messages" ON public.chat_messages;
CREATE POLICY "Participants can view chat_messages"
  ON public.chat_messages
  FOR SELECT
  USING (public.is_conversation_participant(conversation_id, auth.uid()));

DROP POLICY IF EXISTS "Participants can send chat_messages" ON public.chat_messages;
CREATE POLICY "Participants can send chat_messages"
  ON public.chat_messages
  FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_conversation_participant(conversation_id, auth.uid())
  );
