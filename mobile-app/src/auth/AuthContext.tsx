/**
 * Auth context: session, profile, loading, signOut.
 * Drives navigation: no session → Login; session → Main (tabs).
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../backend/supabase';
import { getSessionProfile, getSessionProfileFromSession, type SessionProfile } from './session';

type AuthContextValue = {
  session: SessionProfile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<SessionProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    console.log('[AUTH_DEBUG] refreshSession.start');
    const profile = await getSessionProfile();
    console.log('[AUTH_DEBUG] refreshSession.result', {
      hasSession: !!profile,
      userId: profile?.id,
      role: profile?.role,
    });
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
        } = await supabase.auth.getSession();
        const profile = await getSessionProfileFromSession(session);
        if (!cancelled) {
          clearTimeout(timeoutId);
          console.log('[AUTH_DEBUG] AuthProvider.init.result', {
            hasSession: !!profile,
            userId: profile?.id,
            role: profile?.role,
          });
          setSession(profile);
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
          setSession(profile);
        } catch {
          console.log('[AUTH_DEBUG] onAuthStateChange.error');
          setSession(null);
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
