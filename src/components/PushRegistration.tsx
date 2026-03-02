'use client';

import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabase/client';
import { registerForPush, sendTokenToBackend } from '@/lib/capacitor/pushNotifications';

/** En emulador/dev (10.0.2.2 o localhost) no registrar push para evitar crash si FCM no está configurado. */
function isLikelyDevOrEmulator(): boolean {
  if (typeof window === 'undefined') return true;
  const o = window.location?.origin ?? '';
  return o.includes('10.0.2.2') || o.includes('localhost') || o.includes('127.0.0.1');
}

/**
 * En dispositivos nativos (Android/iOS), al haber sesión registra el token FCM/APNS
 * en el backend para poder enviar notificaciones push. Se omite en emulador/dev.
 */
export default function PushRegistration() {
  const registeredForUser = useRef<string | null>(null);

  const register = async () => {
    if (!Capacitor.isNativePlatform() || isLikelyDevOrEmulator()) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token || session.user.id === registeredForUser.current) return;

    const result = await registerForPush();
    if (!result.ok || !result.token) return;

    const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
    const sent = await sendTokenToBackend(result.token, platform, session.access_token);
    if (sent) registeredForUser.current = session.user.id;
  };

  useEffect(() => {
    // Retrasar push para no bloquear/crashear el arranque (p. ej. sin google-services.json en emulador)
    const t = setTimeout(() => {
      register().catch(() => {});
    }, 3000);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) register().catch(() => {});
    });
    return () => {
      clearTimeout(t);
      subscription.unsubscribe();
    };
  }, []);

  return null;
}
