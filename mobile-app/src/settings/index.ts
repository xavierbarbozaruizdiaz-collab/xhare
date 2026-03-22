/**
 * App settings (navigation preference, etc.). Persist with SecureStore.
 * For now minimal; expand when adding "preferred nav app" UI.
 */
import * as SecureStore from 'expo-secure-store';

const KEY_NAV_PREF = 'app.nav_preference';

export type NavPreference = 'google_maps' | 'waze' | 'browser';

export async function getNavigationPreference(): Promise<NavPreference> {
  try {
    const v = await SecureStore.getItemAsync(KEY_NAV_PREF);
    if (v === 'waze' || v === 'browser') return v;
    return 'google_maps';
  } catch {
    return 'google_maps';
  }
}

export async function setNavigationPreference(value: NavPreference): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY_NAV_PREF, value);
  } catch {
    // ignore
  }
}
