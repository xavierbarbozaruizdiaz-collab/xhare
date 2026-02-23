'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import PageLoading from '@/components/PageLoading';

function formatMessageTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('es-PY', { day: 'numeric', month: 'short' });
}

export default function MessagesInboxPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login?next=/messages');
        return;
      }
      const { data, error } = await supabase.rpc('get_my_conversations', { p_user_id: user.id });
      if (error) {
        setConversations([]);
        return;
      }
      setConversations(Array.isArray(data) ? data : []);
    } catch {
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <PageLoading />;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-4">
          <Link href="/" className="text-green-600 font-semibold">← Inicio</Link>
          <h1 className="text-xl font-bold text-gray-900 flex-1">Mensajes</h1>
        </div>
      </header>
      <div className="max-w-2xl mx-auto px-4 py-4">
        {conversations.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
            <p className="mb-2">Aún no tenés conversaciones.</p>
            <p className="text-sm">Los mensajes aparecen cuando hables con un conductor o pasajero desde un viaje o una oferta.</p>
            <Link href="/search" className="mt-4 inline-block text-green-600 font-medium hover:underline">Buscar viajes</Link>
          </div>
        ) : (
          <ul className="space-y-1">
            {conversations.map((c: any) => (
              <li key={c.conversation_id}>
                <Link
                  href={`/messages/${c.conversation_id}`}
                  className="flex items-center gap-3 p-4 bg-white rounded-xl border border-gray-200 hover:border-green-300 hover:bg-green-50/30 transition"
                >
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden text-gray-600 font-semibold">
                    {c.other_user_avatar ? (
                      <img src={c.other_user_avatar} alt="" className="w-full h-full object-cover" />
                    ) : (
                      (c.other_user_name || '?').charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900 truncate">{c.other_user_name || 'Usuario'}</p>
                    <p className="text-sm text-gray-500 truncate">{c.last_message_preview || 'Sin mensajes'}</p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-xs text-gray-400">{formatMessageTime(c.last_message_at)}</p>
                    {c.unread_count > 0 && (
                      <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-green-600 text-white text-xs font-medium">
                        {c.unread_count}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
