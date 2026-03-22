import Constants from 'expo-constants';

type Env = {
  apiBaseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
};

// Expo inlines EXPO_PUBLIC_* values at build time and also exposes them via `expoConfig.extra`.
// Usamos ambos para que el entorno funcione tanto en dev como en release.
const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

export const env: Env = {
  apiBaseUrl:
    (process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined) ??
    (extra.EXPO_PUBLIC_API_BASE_URL as string | undefined) ??
    '',
  supabaseUrl:
    (process.env.EXPO_PUBLIC_SUPABASE_URL as string | undefined) ??
    (extra.EXPO_PUBLIC_SUPABASE_URL as string | undefined) ??
    '',
  supabaseAnonKey:
    (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string | undefined) ??
    (extra.EXPO_PUBLIC_SUPABASE_ANON_KEY as string | undefined) ??
    '',
};

