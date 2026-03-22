/**
 * Chat con un usuario: mensajes + enviar + realtime.
 */
import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../backend/supabase';
import {
  fetchChatMessages,
  sendChatMessage,
  markConversationRead,
  type ChatMessage,
} from '../api/messages';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'Chat'>;

export function ChatScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<MainStackParamList, 'Chat'>>();
  const { session } = useAuth();
  const conversationId = route.params?.conversationId ?? '';
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [otherUser, setOtherUser] = useState<{ id: string; full_name: string; avatar_url?: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [newBody, setNewBody] = useState('');
  const listRef = useRef<FlatList>(null);

  const load = useCallback(async () => {
    if (!conversationId || !session?.id) return;
    const [msgs, participantsRes] = await Promise.all([
      fetchChatMessages(conversationId),
      supabase.from('conversation_participants').select('user_id').eq('conversation_id', conversationId),
    ]);
    setMessages(msgs);
    const otherId = (participantsRes.data ?? []).find((p: { user_id: string }) => p.user_id !== session.id)?.user_id;
    if (otherId) {
      const { data: profile } = await supabase.from('profiles').select('id, full_name, avatar_url').eq('id', otherId).maybeSingle();
      setOtherUser(profile ? { id: profile.id, full_name: (profile.full_name as string) || 'Usuario', avatar_url: profile.avatar_url } : { id: otherId, full_name: 'Usuario' });
      await markConversationRead(conversationId, session.id);
    }
    setLoading(false);
  }, [conversationId, session?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel('chat:' + conversationId)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as ChatMessage]);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  useEffect(() => {
    if (messages.length > 0) listRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    const body = newBody.trim();
    if (!body || !session?.id || sending) return;
    setSending(true);
    setNewBody('');
    const { error } = await sendChatMessage(conversationId, session.id, body);
    if (error) setNewBody(body);
    setSending(false);
  }, [conversationId, session?.id, newBody, sending]);

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => {
      const isMe = item.sender_id === session?.id;
      return (
        <View style={[styles.messageRow, isMe ? styles.messageRowMe : styles.messageRowThem]}>
          <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
            <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.body}</Text>
            <Text style={[styles.bubbleTime, isMe ? styles.bubbleTimeMe : styles.bubbleTimeThem]}>
              {new Date(item.created_at).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        </View>
      );
    },
    [session?.id]
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  if (!otherUser) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>No podés acceder a esta conversación.</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Volver a Mensajes</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBack}>
          <Text style={styles.headerBackText}>←</Text>
        </TouchableOpacity>
        {otherUser.avatar_url ? (
          <Image source={{ uri: otherUser.avatar_url }} style={styles.headerAvatar} />
        ) : (
          <View style={[styles.headerAvatar, styles.headerAvatarPlaceholder]}>
            <Text style={styles.headerAvatarLetter}>{otherUser.full_name.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <Text style={styles.headerName} numberOfLines={1}>{otherUser.full_name}</Text>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.emptyMsg}>No hay mensajes aún.</Text>}
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={newBody}
          onChangeText={setNewBody}
          placeholder="Escribí un mensaje..."
          placeholderTextColor="#9ca3af"
          maxLength={2000}
          multiline
          onSubmitEditing={handleSend}
          accessibilityLabel="Escribir mensaje"
          accessibilityHint="Máximo 2000 caracteres"
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!newBody.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!newBody.trim() || sending}
          accessibilityLabel="Enviar mensaje"
          accessibilityRole="button"
        >
          <Text style={styles.sendBtnText}>{sending ? '…' : 'Enviar'}</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  errorText: { color: '#6b7280', marginBottom: 16 },
  backBtn: { paddingVertical: 10, paddingHorizontal: 16 },
  backBtnText: { color: '#166534', fontWeight: '600' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerBack: { padding: 8, marginRight: 4 },
  headerBackText: { fontSize: 18, color: '#166534', fontWeight: '600' },
  headerAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10 },
  headerAvatarPlaceholder: { backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' },
  headerAvatarLetter: { fontSize: 16, fontWeight: '700', color: '#6b7280' },
  headerName: { flex: 1, fontSize: 16, fontWeight: '600', color: '#111' },
  listContent: { padding: 16, paddingBottom: 24 },
  emptyMsg: { color: '#9ca3af', textAlign: 'center', marginTop: 24 },
  messageRow: { marginBottom: 8 },
  messageRowMe: { alignItems: 'flex-end' },
  messageRowThem: { alignItems: 'flex-start' },
  bubble: { maxWidth: '85%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8 },
  bubbleMe: { backgroundColor: '#166534' },
  bubbleThem: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb' },
  bubbleText: { fontSize: 15, color: '#111' },
  bubbleTextMe: { color: '#fff' },
  bubbleTime: { fontSize: 11, marginTop: 4 },
  bubbleTimeMe: { color: 'rgba(255,255,255,0.8)' },
  bubbleTimeThem: { color: '#9ca3af' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    gap: 8,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    maxHeight: 100,
    color: '#111',
  },
  sendBtn: {
    backgroundColor: '#166534',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    justifyContent: 'center',
    minHeight: 40,
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
