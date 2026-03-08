/**
 * Plugin nativo que abre una URL (p. ej. geo:lat,lng) con el selector del sistema
 * para que el usuario elija con qué app navegar (Maps, Waze, etc.).
 */

export type NavigationPlugin = {
  openWithChooser(options: { url: string }): Promise<void>;
};

let cachedPlugin: NavigationPlugin | null = null;

export async function getNavigationPlugin(): Promise<NavigationPlugin | null> {
  if (cachedPlugin !== null) return cachedPlugin;
  if (typeof window === 'undefined') return null;
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return null;
    const { registerPlugin } = await import('@capacitor/core');
    cachedPlugin = registerPlugin<NavigationPlugin>('Navigation');
    return cachedPlugin;
  } catch {
    return null;
  }
}
