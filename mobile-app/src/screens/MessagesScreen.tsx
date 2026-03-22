/**
 * Lista de conversaciones (inbox). get_my_conversations → tap abre Chat.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../auth/AuthContext';
import { fetchMyConversations, type ConversationRow } from '../api/messages';
import type { MainStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<MainStackParamList, 'Messages'>;

function formatMessageTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('es-PY', { day: 'numeric', month: 'short' });
}

export function MessagesScreen() {
  const navigation = useNavigation<Nav>();
  const { session } = useAuth();
  const [list, setList] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!session?.id) return;
    const data = await fetchMyConversations(session.id);
    setList(data);
    setLoading(false);
    setRefreshing(false);
  }, [session?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      if (session?.id) load();
    }, [session?.id, load])
  );

  const parentNav = navigation.getParent() as { navigate: (a: string, b: object) => void } | undefined;

  const renderItem = ({ item }: { item: ConversationRow }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => parentNav?.navigate('Chat', { conversationId: item.conversation_id })}
      activeOpacity={0.7}
      accessibilityLabel={`Conversación con ${item.other_user_name || 'Usuario'}`}
      accessibilityHint="Toca para abrir el chat"
      accessibilityRole="button"
    >
      <View style={styles.avatarWrap}>
        {item.other_user_avatar ? (
          <Image source={{ uri: item.other_user_avatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarLetter}>{(item.other_user_name || '?').charAt(0).toUpperCase()}</Text>
          </View>
        )}
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{item.other_user_name || 'Usuario'}</Text>
        <Text style={styles.preview} numberOfLines={1}>{item.last_message_preview || 'Sin mensajes'}</Text>
      </View>
      <View style={styles.right}>
        <Text style={styles.time}>{formatMessageTime(item.last_message_at)}</Text>
        {Number(item.unread_count) > 0 && (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>{Number(item.unread_count) > 99 ? '99+' : item.unread_count}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  if (loading && list.length === 0) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#166534" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {list.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Aún no tenés conversaciones.</Text>
          <Text style={styles.emptyHint}>Los mensajes aparecen cuando hables con un conductor o pasajero desde un viaje o una oferta.</Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(item) => item.conversation_id}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { padding: 16, paddingBottom: 24 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  avatarWrap: { marginRight: 12 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarPlaceholder: { backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { fontSize: 20, fontWeight: '700', color: '#6b7280' },
  body: { flex: 1, minWidth: 0 },
  name: { fontSize: 16, fontWeight: '600', color: '#111' },
  preview: { fontSize: 14, color: '#6b7280', marginTop: 2 },
  right: { alignItems: 'flex-end', marginLeft: 8 },
  time: { fontSize: 12, color: '#9ca3af' },
  unreadBadge: { marginTop: 4, backgroundColor: '#166534', minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  empty: { flex: 1, padding: 24, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 16, color: '#374151', marginBottom: 8 },
  emptyHint: { fontSize: 14, color: '#6b7280', textAlign: 'center' },
});
