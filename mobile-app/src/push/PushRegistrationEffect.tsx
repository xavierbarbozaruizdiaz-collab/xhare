/**
 * Runs push registration when user is logged in (and apiBaseUrl is set).
 * When user taps a notification: if payload has rideId, conversationId or url, opens deep link (xhare://).
 */
import React, { useEffect, useRef } from 'react';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { useAuth } from '../auth/AuthContext';
import { registerPushIfPossible } from './registerPush';

function getDeepLinkFromNotificationData(data: Record<string, unknown>): string | null {
  if (typeof data?.url === 'string' && (data.url.startsWith('xhare://') || data.url.startsWith('https://'))) {
    return data.url.startsWith('xhare://') ? data.url : null;
  }
  if (typeof data?.rideId === 'string' && data.rideId) return `xhare://ride/${data.rideId}`;
  if (typeof data?.conversationId === 'string' && data.conversationId) return `xhare://chat/${data.conversationId}`;
  return null;
}

export function PushRegistrationEffect() {
  const { session } = useAuth();
  const done = useRef(false);

  useEffect(() => {
    if (!session?.id || done.current) return;
    done.current = true;
    registerPushIfPossible();
  }, [session?.id]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = (response.notification.request.content.data as Record<string, unknown>) ?? {};
      const url = getDeepLinkFromNotificationData(data);
      if (url) Linking.openURL(url);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = (response.notification.request.content.data as Record<string, unknown>) ?? {};
      const url = getDeepLinkFromNotificationData(data);
      if (url) Linking.openURL(url);
    });
  }, [session?.id]);

  return null;
}
