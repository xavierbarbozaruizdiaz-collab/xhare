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
