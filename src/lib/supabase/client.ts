import { createClient } from '@supabase/supabase-js';
import { webAuthStorage } from '@/lib/web/authStorage';

// Placeholder en build si no hay env (ej. Vercel sin configurar); en runtime se usan las vars reales
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: webAuthStorage,
  },
});

