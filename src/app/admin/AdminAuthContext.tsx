'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';

type AdminAuth = {
  accessToken: string | null;
  ready: boolean;
  isAdmin: boolean;
  /** Refresca sesión y devuelve el token actualizado (o null). Útil para reintentar tras 401. */
  refetch: () => Promise<string | null>;
};

const AdminAuthContext = createContext<AdminAuth>({
  accessToken: null,
  ready: false,
  isAdmin: false,
  refetch: async () => null,
});

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used inside AdminAuthProvider');
  return ctx;
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const refetch = useCallback(async (): Promise<string | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.push('/login?next=/admin');
      return null;
    }
    const { data } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
    if (data?.role !== 'admin') {
      router.push('/');
      return null;
    }
    const { data: { session } } = await supabase.auth.refreshSession();
    const token = session?.access_token ?? null;
    if (token) {
      setAccessToken(token);
      setIsAdmin(true);
    }
    return token;
  }, [router]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login?next=/admin');
        setReady(true);
        return;
      }
      const { data } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      if (data?.role !== 'admin') {
        router.push('/');
        setReady(true);
        return;
      }
      const { data: { session } } = await supabase.auth.refreshSession();
      const token = session?.access_token ?? null;
      setAccessToken(token);
      setIsAdmin(true);
      setReady(true);
    })();
  }, [router]);

  return (
    <AdminAuthContext.Provider value={{ accessToken, ready, isAdmin, refetch }}>
      {children}
    </AdminAuthContext.Provider>
  );
}
