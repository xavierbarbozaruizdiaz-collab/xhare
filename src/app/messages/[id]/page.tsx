'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import Link from 'next/link';
import PageLoading from '@/components/PageLoading';

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const conversationId = params.id as string;
  const [user, setUser] = useState<any>(null);
  const [otherUser, setOtherUser] = useState<{ id: string; full_name: string; avatar_url?: string } | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [newBody, setNewBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!conversationId) return;
    (async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) {
        router.replace('/login?next=' + encodeURIComponent('/messages/' + conversationId));
        setLoading(false);
        return;
      }
      setUser(u);

      const { data: participants } = await supabase
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', conversationId);
      const otherId = participants?.find((p: any) => p.user_id !== u.id)?.user_id;
      if (!otherId) {
        setLoading(false);
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .eq('id', otherId)
        .single();
      setOtherUser(profile ? { id: profile.id, full_name: profile.full_name || 'Usuario', avatar_url: profile.avatar_url } : { id: otherId, full_name: 'Usuario' });

      const { data: msgs, error } = await supabase
        .from('chat_messages')
        .select('id, sender_id, body, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      if (!error) setMessages(msgs || []);

      await supabase
        .from('conversation_participants')
        .update({ last_read_at: new Date().toISOString() })
        .eq('conversation_id', conversationId)
        .eq('user_id', u.id);

      setLoading(false);
    })();
  }, [conversationId, router]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel('chat:' + conversationId)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as any]);
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const body = newBody.trim();
    if (!body || !user || sending) return;
    setSending(true);
    setNewBody('');
    const { error } = await supabase.from('chat_messages').insert({
      conversation_id: conversationId,
      sender_id: user.id,
      body,
    });
    setSending(false);
    if (error) setNewBody(body);
  }

  if (loading) return <PageLoading />;
  if (!user || !otherUser) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-gray-600 mb-4">No podés acceder a esta conversación.</p>
          <Link href="/messages" className="text-green-600 font-medium hover:underline">Volver a Mensajes</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/messages" className="text-green-600 font-semibold">←</Link>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0 text-gray-600 font-semibold">
              {otherUser.avatar_url ? (
                <img src={otherUser.avatar_url} alt="" className="w-full h-full object-cover" />
              ) : (
                otherUser.full_name.charAt(0).toUpperCase()
              )}
            </div>
            <p className="font-semibold text-gray-900 truncate">{otherUser.full_name}</p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 max-w-2xl mx-auto w-full">
        {messages.map((m: any) => {
          const isMe = m.sender_id === user.id;
          return (
            <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2 ${
                  isMe ? 'bg-green-600 text-white' : 'bg-white border border-gray-200 text-gray-900'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                <p className={`text-xs mt-0.5 ${isMe ? 'text-green-100' : 'text-gray-400'}`}>
                  {new Date(m.created_at).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={sendMessage} className="bg-white border-t border-gray-200 p-3 max-w-2xl mx-auto w-full">
        <div className="flex gap-2">
          <input
            type="text"
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            placeholder="Escribí un mensaje..."
            className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-green-500"
            maxLength={2000}
          />
          <button
            type="submit"
            disabled={!newBody.trim() || sending}
            className="px-5 py-3 bg-green-600 text-white font-medium rounded-xl hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Enviar
          </button>
        </div>
      </form>
    </div>
  );
}
