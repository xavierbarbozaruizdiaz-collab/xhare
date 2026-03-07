import { createClient } from '@supabase/supabase-js';
import { capacitorAuthStorage } from '@/lib/capacitor/auth-storage';

// Placeholder en build si no hay env (ej. Vercel sin configurar); en runtime se usan las vars reales
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: capacitorAuthStorage,
  },
});

