import { Capacitor } from '@capacitor/core';

export type PushRegisterResult = { ok: true; token: string } | { ok: false; error: string };

/**
 * Solicita permiso, registra el dispositivo en FCM/APNS y devuelve el token.
 * Solo tiene efecto en Android/iOS; en web retorna ok: false.
 */
export async function registerForPush(): Promise<PushRegisterResult> {
  if (!Capacitor.isNativePlatform()) {
    return { ok: false, error: 'not_native' };
  }

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    const perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') {
      return { ok: false, error: 'permission_denied' };
    }

    const token = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 15000);
      PushNotifications.addListener(
        'registration',
        (ev: { value?: string }) => {
          clearTimeout(timeout);
          resolve(ev?.value ?? '');
        },
      );
      PushNotifications.addListener(
        'registrationError',
        (err: { error?: unknown }) => {
          clearTimeout(timeout);
          reject(new Error(String(err?.error ?? 'registrationError')));
        },
      );
      PushNotifications.register();
    });

    if (!token) return { ok: false, error: 'no_token' };
    return { ok: true, token };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/**
 * Envía el token al backend para que pueda enviar notificaciones a este dispositivo.
 * platform: 'android' | 'ios' (en web no se llama).
 */
export async function sendTokenToBackend(
  token: string,
  platform: 'android' | 'ios',
  accessToken: string,
): Promise<boolean> {
  try {
    const res = await fetch('/api/push/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      credentials: 'include',
      body: JSON.stringify({ token, platform }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
