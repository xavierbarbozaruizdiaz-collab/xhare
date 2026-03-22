/**
 * Register device for push notifications and send token to backend.
 * Reuses same API as web app: POST /api/push/register with token and platform.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { env } from '../core/env';
import { supabase } from '../backend/supabase';

export async function registerPushIfPossible(): Promise<void> {
  if (!env.apiBaseUrl?.trim()) return;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return;

  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let final = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      final = status;
    }
    if (final !== 'granted') return;

    const tokenRes = await Notifications.getExpoPushTokenAsync({
      projectId: (Notifications as unknown as { projectId?: string }).projectId ?? undefined,
    });
    const token = tokenRes?.data;
    if (!token) return;

    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    const url = `${env.apiBaseUrl.replace(/\/$/, '')}/api/push/register`;
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        token,
        platform,
      }),
    });
  } catch {
    // Silently ignore: push is optional
  }
}
