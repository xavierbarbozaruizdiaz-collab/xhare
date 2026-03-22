import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { env } from '../core/env';

export function isEnvConfigured(): boolean {
  return Boolean(env.supabaseUrl?.trim() && env.supabaseAnonKey?.trim());
}

// Adapter para React Native: Supabase Auth JS espera un storage con
// { getItem, setItem, removeItem } (promesas).
const rnStorage = {
  async getItem(key: string): Promise<string | null> {
    return AsyncStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
  },
};

// Importante: este archivo no debe quedar "undefined" en runtime.
// Si no hay env configurado, usamos placeholders para evitar crashes por
// `Cannot read property 'auth' of undefined`.
const SUPABASE_URL = env.supabaseUrl?.trim() || 'https://example.supabase.co';
const SUPABASE_ANON_KEY = env.supabaseAnonKey?.trim() || 'public-anon-key';

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // RN/Expo: evita interpretar URLs como sesión OAuth; reduce choques con deep links y con la web abierta.
    detectSessionInUrl: false,
    storage: rnStorage as any,
  },
});

