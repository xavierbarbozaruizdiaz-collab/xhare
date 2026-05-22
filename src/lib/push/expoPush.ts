const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_PUSH_BATCH = 100;

export type ExpoPushPayload = {
  to: string;
  sound: 'default';
  title: string;
  body: string;
  data: Record<string, unknown>;
};

export async function sendExpoPushMessages(messages: ExpoPushPayload[]): Promise<void> {
  if (!messages.length) return;

  const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
  for (let i = 0; i < messages.length; i += EXPO_PUSH_BATCH) {
    const chunk = messages.slice(i, i + EXPO_PUSH_BATCH);
    const payload = chunk.length === 1 ? chunk[0] : chunk;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('[expoPush] HTTP', res.status, text);
      }
    } catch (e) {
      console.error('[expoPush] fetch', e);
    }
  }
}

export async function fetchExpoTokensForUsers(
  service: import('@supabase/supabase-js').SupabaseClient,
  userIds: string[]
): Promise<string[]> {
  if (!userIds.length) return [];
  const { data: rows, error } = await service
    .from('push_tokens')
    .select('token')
    .in('user_id', userIds);
  if (error || !rows?.length) return [];
  return Array.from(
    new Set(
      rows
        .map((r) => r.token)
        .filter((t): t is string => typeof t === 'string' && t.startsWith('ExponentPushToken'))
    )
  );
}
