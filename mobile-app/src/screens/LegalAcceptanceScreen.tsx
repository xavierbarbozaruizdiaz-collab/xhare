import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../backend/supabase';
import { env } from '../core/env';
import { useAuth } from '../auth/AuthContext';

type LegalVersionResponse = {
  version?: string;
};

async function fetchLegalVersion(type: 'terms' | 'privacy'): Promise<string> {
  const base = env.apiBaseUrl?.trim().replace(/\/$/, '');
  if (!base) return 'v1.0';
  try {
    const res = await fetch(`${base}/api/legal/document?type=${type}`);
    if (!res.ok) return 'v1.0';
    const data = (await res.json()) as LegalVersionResponse;
    return typeof data.version === 'string' && data.version.trim() ? data.version.trim() : 'v1.0';
  } catch {
    return 'v1.0';
  }
}

export function LegalAcceptanceScreen() {
  const { refreshSession, signOut } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const termsUrl = useMemo(() => {
    const base = env.apiBaseUrl?.trim().replace(/\/$/, '');
    return base ? `${base}/legal/terms` : '';
  }, []);
  const privacyUrl = useMemo(() => {
    const base = env.apiBaseUrl?.trim().replace(/\/$/, '');
    return base ? `${base}/legal/privacy` : '';
  }, []);

  async function handleAccept() {
    setLoading(true);
    setError('');
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        await signOut();
        return;
      }
      const [termsVersion, privacyVersion] = await Promise.all([
        fetchLegalVersion('terms'),
        fetchLegalVersion('privacy'),
      ]);
      const base = env.apiBaseUrl?.trim().replace(/\/$/, '');
      if (!base) throw new Error('EXPO_PUBLIC_API_BASE_URL no configurado');
      const res = await fetch(`${base}/api/legal/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ source: 'mobile', termsVersion, privacyVersion }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error || 'No se pudo registrar la aceptación legal.');
      }

      const payload = (await res.json().catch(() => ({}))) as {
        accepted_at?: string;
        terms_version?: string;
        privacy_version?: string;
      };
      const acceptedAt =
        typeof payload.accepted_at === 'string' && payload.accepted_at.trim()
          ? payload.accepted_at
          : new Date().toISOString();
      const termsVer =
        typeof payload.terms_version === 'string' && payload.terms_version.trim()
          ? payload.terms_version.trim()
          : termsVersion;
      const privacyVer =
        typeof payload.privacy_version === 'string' && payload.privacy_version.trim()
          ? payload.privacy_version.trim()
          : privacyVersion;

      const patchedSession = {
        ...session,
        user: {
          ...session.user,
          user_metadata: {
            ...(session.user as any)?.user_metadata,
            terms_accepted_at: acceptedAt,
            privacy_accepted_at: acceptedAt,
            terms_version: termsVer,
            privacy_version: privacyVer,
          },
        },
      } as any;

      await refreshSession(patchedSession);
    } catch (e) {
      const msg =
        e instanceof Error && e.message ? e.message : 'No se pudo guardar la aceptación. Verificá conexión e intentá de nuevo.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Antes de continuar</Text>
        <Text style={styles.description}>
          Para usar Xhare, tenés que aceptar los Términos y Condiciones y la Política de Privacidad.
        </Text>

        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => {
            if (termsUrl) void Linking.openURL(termsUrl);
          }}
        >
          <Text style={styles.linkButtonText}>Ver Términos y Condiciones</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.linkButton}
          onPress={() => {
            if (privacyUrl) void Linking.openURL(privacyUrl);
          }}
        >
          <Text style={styles.linkButtonText}>Ver Política de Privacidad</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.acceptButton, loading && styles.acceptButtonDisabled]}
          onPress={handleAccept}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.acceptButtonText}>Acepto y continuar</Text>
          )}
        </TouchableOpacity>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#166534',
    marginBottom: 10,
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    color: '#374151',
    marginBottom: 16,
    textAlign: 'center',
    lineHeight: 20,
  },
  linkButton: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  linkButtonText: {
    color: '#166534',
    fontWeight: '600',
    textAlign: 'center',
  },
  acceptButton: {
    marginTop: 8,
    backgroundColor: '#166534',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  acceptButtonDisabled: {
    opacity: 0.7,
  },
  acceptButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  errorText: {
    marginTop: 10,
    color: '#b91c1c',
    fontSize: 13,
    textAlign: 'center',
  },
});
