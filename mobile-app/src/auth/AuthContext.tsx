/**
 * Auth context: session, profile, loading, signOut.
 * Drives navigation: no session → Login; session → Main (tabs).
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../backend/supabase';
import { raceWithTimeout } from '../backend/withTimeout';
import { getSessionProfile, getSessionProfileFromSession, type SessionProfile } from './session';

const GET_SESSION_TIMEOUT_MS = 12_000;

type AuthContextValue = {
  session: SessionProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshSession: (nextSession?: Session | null) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function minimalProfileFromSession(s: Session | null): SessionProfile | null {
  const userId = s?.user?.id ? String(s.user.id) : '';
  const access_token = (s as any)?.access_token ? String((s as any).access_token) : '';
  if (!userId || !access_token) return null;
  return {
    id: userId,
    role: null,
    access_token,
    email: s?.user?.email ?? null,
    full_name: null,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async (nextSession?: Session | null) => {
    console.log('[AUTH_DEBUG] refreshSession.start');
    const profile = nextSession ? await getSessionProfileFromSession(nextSession) : await getSessionProfile();
    console.log('[AUTH_DEBUG] refreshSession.result', {
      hasSession: !!profile,
      userId: profile?.id,
      role: profile?.role,
    });
    // Si el login ya devolvió sesión pero falló cargar el perfil (p.ej. timeout en `profiles`),
    // dejamos una sesión mínima para permitir entrar y reintentar la carga luego.
    if (!profile && nextSession) {
      const fallback = minimalProfileFromSession(nextSession);
      setSession(fallback);
      return;
    }
    setSession(profile);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const TIMEOUT_MS = 15000; // Solo dejar de mostrar "Cargando..."; no forzar sesión a null para no perder sesión en arranques lentos

    console.log('[AUTH_DEBUG] AuthProvider.init');
    const timeoutId = setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, TIMEOUT_MS);

    let subscription: { unsubscribe: () => void } | null = null;

    (async () => {
      try {
        const {
          data: { session },
        } = await raceWithTimeout(supabase.auth.getSession(), GET_SESSION_TIMEOUT_MS, () => ({
          data: { session: null },
          error: null,
        }));
        const profile = await getSessionProfileFromSession(session);
        if (!cancelled) {
          clearTimeout(timeoutId);
          console.log('[AUTH_DEBUG] AuthProvider.init.result', {
            hasSession: !!profile,
            userId: profile?.id,
            role: profile?.role,
          });
          setSession(profile ?? minimalProfileFromSession(session));
        }
      } catch {
        console.log('[AUTH_DEBUG] AuthProvider.init.error');
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) {
          clearTimeout(timeoutId);
          setLoading(false);
        }
      }
    })();

    try {
      const { data } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
        if (cancelled) return;
        try {
          console.log('[AUTH_DEBUG] onAuthStateChange', { event });
          const profile = await getSessionProfileFromSession(nextSession);
          console.log('[AUTH_DEBUG] onAuthStateChange.result', {
            hasSession: !!profile,
            userId: profile?.id,
            role: profile?.role,
          });
          setSession(profile ?? minimalProfileFromSession(nextSession));
        } catch {
          console.log('[AUTH_DEBUG] onAuthStateChange.error');
          setSession(minimalProfileFromSession(nextSession));
        }
      });

      subscription = data?.subscription ?? null;
    } catch {
      // Si algo falla al suscribir, igual dejamos la app andando:
      // el usuario igual verá Login si no hay sesión.
      console.log('[AUTH_DEBUG] onAuthStateChange.setup.error');
    }

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      subscription?.unsubscribe();
    };
  }, []);

  /**
   * React Native: el refresco de JWT por timer no es fiable en background.
   * Con web u otra app en primer plano, la sesión móvil podía quedar “vieja” al volver.
   * Supabase recomienda start/stop según AppState (una sola suscripción global).
   */
  useEffect(() => {
    const onState = (next: AppStateStatus) => {
      if (next === 'active') {
        void supabase.auth.startAutoRefresh();
      } else {
        void supabase.auth.stopAutoRefresh();
      }
    };
    const sub = AppState.addEventListener('change', onState);
    if (AppState.currentState === 'active') {
      void supabase.auth.startAutoRefresh();
    }
    return () => {
      sub.remove();
      void supabase.auth.stopAutoRefresh();
    };
  }, []);

  const signOut = useCallback(async () => {
    console.log('[AUTH_DEBUG] signOut.start');
    setSession(null);
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // Limpiamos sesión en UI ya; si falla el signOut igual el usuario salió
    }
  }, []);

  const value: AuthContextValue = {
    session,
    loading,
    signOut,
    refreshSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
