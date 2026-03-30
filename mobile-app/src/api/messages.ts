/**
 * Messages: conversations list and chat. Uses Supabase RPC get_my_conversations and chat_messages.
 */
import { supabase } from '../backend/supabase';

export type ConversationRow = {
  conversation_id: string;
  other_user_id: string;
  other_user_name: string | null;
  other_user_avatar: string | null;
  context_type: string | null;
  context_id: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
};

export async function fetchMyConversations(userId: string): Promise<ConversationRow[]> {
  const { data, error } = await supabase.rpc('get_my_conversations', { p_user_id: userId });
  if (error) return [];
  return Array.isArray(data) ? (data as ConversationRow[]) : [];
}

export type ChatMessage = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export async function fetchChatMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, sender_id, body, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) return [];
  return (data ?? []) as ChatMessage[];
}

export async function sendChatMessage(conversationId: string, senderId: string, body: string): Promise<{ error: Error | null }> {
  const { error } = await supabase.from('chat_messages').insert({
    conversation_id: conversationId,
    sender_id: senderId,
    body: body.trim().slice(0, 2000),
  });
  return { error: error ? new Error(error.message) : null };
}

export async function markConversationRead(conversationId: string, userId: string): Promise<void> {
  await supabase
    .from('conversation_participants')
    .update({ last_read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('user_id', userId);
}

export async function ensureRideContactConversation(rideId: string): Promise<{
  conversationId: string | null;
  errorCode?: string;
  errorMessage?: string;
}> {
  const { data, error } = await supabase.rpc('get_or_create_ride_contact_conversation', {
    p_ride_id: rideId,
  });
  if (error) {
    return {
      conversationId: null,
      errorCode: 'rpc_error',
      errorMessage: error.message || 'No se pudo preparar el contacto.',
    };
  }
  const row = Array.isArray(data) ? data[0] : data;
  const conversationId =
    row && typeof row === 'object' && row.conversation_id
      ? String((row as { conversation_id: string }).conversation_id)
      : null;
  if (conversationId) return { conversationId };
  return {
    conversationId: null,
    errorCode:
      row && typeof row === 'object' && (row as { error_code?: string }).error_code
        ? String((row as { error_code: string }).error_code)
        : 'unknown',
    errorMessage:
      row && typeof row === 'object' && (row as { error_message?: string }).error_message
        ? String((row as { error_message: string }).error_message)
        : 'No se pudo abrir el chat con el conductor.',
  };
}
