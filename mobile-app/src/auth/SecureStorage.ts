/**
 * Supabase auth storage adapter using AsyncStorage.
 * Same contract for persistSession.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'supabase.auth.';

export const authStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      const value = await AsyncStorage.getItem(KEY_PREFIX + key);
      if (__DEV__) console.log('[AUTH_DEBUG] AsyncStorage.getItem', { key, hasValue: value != null });
      return value;
    } catch {
      if (__DEV__) console.log('[AUTH_DEBUG] AsyncStorage.getItem error', { key });
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      if (__DEV__) console.log('[AUTH_DEBUG] AsyncStorage.setItem', { key, length: value.length });
      await AsyncStorage.setItem(KEY_PREFIX + key, value);
    } catch {
      if (__DEV__) console.log('[AUTH_DEBUG] AsyncStorage.setItem error', { key });
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      if (__DEV__) console.log('[AUTH_DEBUG] AsyncStorage.removeItem', { key });
      await AsyncStorage.removeItem(KEY_PREFIX + key);
    } catch {
      if (__DEV__) console.log('[AUTH_DEBUG] AsyncStorage.removeItem error', { key });
    }
  },
};
