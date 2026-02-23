'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';

function short(s: string | null | undefined, max = 25): string {
  if (!s) return '—';
  return s.length <= max ? s : s.slice(0, max) + '…';
}

/** Barra fija que muestra "Viaje en curso" cuando el conductor tiene un ride con status en_route. */
export default function ActiveRideBar() {
  const [activeRide, setActiveRide] = useState<{ id: string; origin_label: string | null; destination_label: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      if (profile?.role !== 'driver' || cancelled) return;
      const { data: rides } = await supabase
        .from('rides')
        .select('id, origin_label, destination_label')
        .eq('driver_id', user.id)
        .eq('status', 'en_route')
        .limit(1);
      if (cancelled) return;
      const ride = rides?.[0];
      setActiveRide(ride ? { id: ride.id, origin_label: ride.origin_label ?? null, destination_label: ride.destination_label ?? null } : null);
    }
    check();
    const interval = setInterval(check, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!activeRide) return null;

  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-50 bg-blue-600 text-white shadow-md safe-area-inset-top">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <span className="flex-shrink-0 w-2 h-2 rounded-full bg-white animate-pulse" aria-hidden />
            <span className="text-sm font-medium truncate">
              Viaje en curso: {short(activeRide.origin_label)} → {short(activeRide.destination_label)}
            </span>
          </div>
          <Link
            href={`/rides/${activeRide.id}`}
            className="flex-shrink-0 px-3 py-1.5 bg-white text-blue-600 text-sm font-semibold rounded-lg hover:bg-blue-50 transition"
          >
            Ver viaje
          </Link>
        </div>
      </div>
      {/* Espaciador para que el contenido no quede debajo de la barra fija */}
      <div className="h-12" aria-hidden />
    </>
  );
}
