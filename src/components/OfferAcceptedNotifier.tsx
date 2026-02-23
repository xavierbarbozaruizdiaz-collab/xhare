'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';

/** Muestra un toast cuando aceptan una oferta del conductor (Busco viaje). */
export default function OfferAcceptedNotifier() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function setup() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      if (profile?.role !== 'driver') return;

      channel = supabase
        .channel(`driver-offers:${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'driver_offers',
            filter: `driver_id=eq.${user.id}`,
          },
          (payload: { old: { status?: string }; new: { status?: string } }) => {
            const oldStatus = payload.old?.status;
            const newStatus = payload.new?.status;
            if (newStatus === 'accepted' && oldStatus !== 'accepted') {
              setMessage('accepted');
              if (timeoutId) clearTimeout(timeoutId);
              timeoutId = setTimeout(() => setMessage(null), 8000);
            }
          }
        )
        .subscribe();
    }

    setup();
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  if (!message) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[100] max-w-md mx-auto px-4 py-3 bg-green-600 text-white rounded-xl shadow-lg flex items-center justify-between gap-3">
      <p className="font-medium">¡Tu oferta fue aceptada!</p>
      <Link
        href="/my-rides"
        className="flex-shrink-0 px-3 py-1.5 bg-white text-green-700 text-sm font-semibold rounded-lg hover:bg-green-50 transition"
      >
        Ver viajes
      </Link>
    </div>
  );
}
