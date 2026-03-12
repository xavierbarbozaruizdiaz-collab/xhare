'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get('next') || '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [asDriver, setAsDriver] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [isSignUp, setIsSignUp] = useState(searchParams.get('signup') === '1');
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let didRedirect = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled || !session?.user?.id) {
        if (!cancelled) setCheckingSession(false);
        return;
      }
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).maybeSingle();
      if (cancelled) return;
      const role = profile?.role;
      if (role === 'admin') {
        didRedirect = true;
        router.replace('/admin');
        return;
      }
      if (role === 'driver' || role === 'driver_pending') {
        if (role === 'driver_pending') {
          didRedirect = true;
          router.replace('/driver/pending');
          return;
        }
        const { data: p } = await supabase.from('profiles').select('vehicle_seat_count, driver_approved_at').eq('id', session.user.id).maybeSingle();
        if (p?.driver_approved_at && p?.vehicle_seat_count == null) {
          didRedirect = true;
          router.replace('/driver/setup');
          return;
        }
        if (p?.driver_approved_at) {
          didRedirect = true;
          router.replace('/my-rides');
          return;
        }
        didRedirect = true;
        router.replace('/driver/pending');
        return;
      }
      didRedirect = true;
      router.replace(nextUrl.startsWith('/') ? nextUrl : '/');
    })().finally(() => {
      if (!cancelled && !didRedirect) setCheckingSession(false);
    });
    return () => { cancelled = true; };
  }, [router, nextUrl]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      if (isSignUp) {
        const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || undefined;
        const { data: signUpData, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: asDriver
              ? { role: 'driver', full_name: fullName, phone: phone.trim() || undefined }
              : {},
          },
        });
        if (error) throw error;
        if (asDriver && signUpData?.user?.id) {
          await new Promise((r) => setTimeout(r, 1000));
          const session = (await supabase.auth.getSession()).data?.session;
          const accessToken = session?.access_token;
          if (accessToken) {
            for (let i = 0; i < 3; i++) {
              const res = await fetch('/api/auth/ensure-driver-pending', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  access_token: accessToken,
                  full_name: fullName,
                  phone: phone.trim() || undefined,
                  address: address.trim() || undefined,
                  city: city.trim() || undefined,
                }),
              });
              if (res.ok) break;
              await new Promise((r) => setTimeout(r, 500));
            }
          }
          router.push('/driver/setup');
          router.refresh();
          return;
        }
        setMessage('Revisá tu correo para confirmar la cuenta.');
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const userId = data.user?.id;
        if (userId) {
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', userId)
            .maybeSingle();
          if (profileError) {
            setMessage(profileError.message || 'Error al cargar perfil');
            setLoading(false);
            return;
          }
          if (profile?.role === 'admin') {
            router.push('/admin');
            router.refresh();
            return;
          }
          if (profile?.role === 'driver_pending') {
            router.push('/driver/setup');
            router.refresh();
            return;
          }
          if (profile?.role === 'driver') {
            const { data: p, error: seatErr } = await supabase
              .from('profiles')
              .select('vehicle_seat_count, driver_approved_at')
              .eq('id', userId)
              .maybeSingle();
            if (!seatErr && p != null && p.driver_approved_at && p.vehicle_seat_count == null) {
              router.push('/driver/setup');
              router.refresh();
              return;
            }
            if (!seatErr && p != null && p.driver_approved_at) {
              router.push('/my-rides');
              router.refresh();
              return;
            }
            router.push('/driver/pending');
            router.refresh();
            return;
          }
        }
        router.push(nextUrl.startsWith('/') ? nextUrl : '/');
        router.refresh();
      }
    } catch (error: any) {
      const msg = error?.message || 'Error';
      setMessage(msg.includes('422') ? 'Revisá que el email no esté ya registrado y que la contraseña tenga al menos 6 caracteres.' : msg);
    } finally {
      setLoading(false);
    }
  }

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md bg-white rounded-lg shadow p-6 flex flex-col items-center justify-center py-12">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600" aria-hidden />
          <p className="mt-4 text-sm text-gray-500">Comprobando sesión…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow p-6">
        <h1 className="text-2xl font-bold text-center mb-6 text-green-600">Xhare</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border rounded"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border rounded"
              required
            />
          </div>
          {isSignUp && (
            <>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={asDriver}
                  onChange={(e) => setAsDriver(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">Registrarme como conductor (para publicar viajes)</span>
              </label>
              {asDriver && (
                <div className="space-y-3 pt-2 border-t border-gray-200">
                  <p className="text-sm font-medium text-gray-700">Datos del conductor</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Nombre</label>
                      <input
                        type="text"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="w-full px-3 py-2 border rounded text-sm"
                        required={asDriver}
                        placeholder="Juan"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-0.5">Apellido</label>
                      <input
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className="w-full px-3 py-2 border rounded text-sm"
                        required={asDriver}
                        placeholder="Pérez"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Teléfono</label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full px-3 py-2 border rounded text-sm"
                      required={asDriver}
                      placeholder="0981 123 456"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Domicilio</label>
                    <input
                      type="text"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="w-full px-3 py-2 border rounded text-sm"
                      required={asDriver}
                      placeholder="Calle y número"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-0.5">Ciudad</label>
                    <input
                      type="text"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="w-full px-3 py-2 border rounded text-sm"
                      required={asDriver}
                      placeholder="Asunción"
                    />
                  </div>
                </div>
              )}
            </>
          )}
          {message && <p className="text-sm text-red-600">{message}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? 'Esperá...' : isSignUp ? 'Crear cuenta' : 'Iniciar sesión'}
          </button>
        </form>
        <button
          type="button"
          onClick={() => { setIsSignUp(!isSignUp); setMessage(''); }}
          className="w-full mt-4 text-sm text-gray-500 hover:text-gray-700"
          aria-pressed={isSignUp}
        >
          {isSignUp ? '¿Ya tenés cuenta? Iniciar sesión' : '¿No tenés cuenta? Crear cuenta'}
        </button>
        <p className="mt-4 text-center">
          <Link href="/" className="text-green-600 hover:underline">Volver al inicio</Link>
        </p>
      </div>
    </div>
  );
}
