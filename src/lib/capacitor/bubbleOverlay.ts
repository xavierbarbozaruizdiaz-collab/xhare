/**
 * Plugin de burbuja flotante (solo app nativa). No importar @capacitor/core a nivel
 * superior para no romper el build de Next.js en Node (Vercel).
 */
export type BubbleOverlayPlugin = {
  hasOverlayPermission(): Promise<{ granted: boolean }>;
  requestOverlayPermission(): Promise<{ granted: boolean }>;
  showBubble(options?: { label?: string }): Promise<{ shown: boolean }>;
  hideBubble(): Promise<{ hidden: boolean }>;
};

const noopImpl: BubbleOverlayPlugin = {
  hasOverlayPermission: async () => ({ granted: false }),
  requestOverlayPermission: async () => ({ granted: false }),
  showBubble: async () => ({ shown: false }),
  hideBubble: async () => ({ hidden: false }),
};

let cachedPlugin: BubbleOverlayPlugin | null = null;

async function getPlugin(): Promise<BubbleOverlayPlugin> {
  if (cachedPlugin) return cachedPlugin;
  if (typeof window === 'undefined') return noopImpl;
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return noopImpl;
    const { registerPlugin } = await import('@capacitor/core');
    const native = registerPlugin<BubbleOverlayPlugin>('BubbleOverlay');
    cachedPlugin = {
      hasOverlayPermission: () => native.hasOverlayPermission(),
      requestOverlayPermission: () => native.requestOverlayPermission(),
      showBubble: (opts) => native.showBubble(opts ?? {}),
      hideBubble: () => native.hideBubble(),
    };
    return cachedPlugin;
  } catch {
    return noopImpl;
  }
}

/** API síncrona que delega en el plugin (cargado en browser/nativo). */
export const BubbleOverlay: BubbleOverlayPlugin = {
  hasOverlayPermission: () => getPlugin().then((p) => p.hasOverlayPermission()),
  requestOverlayPermission: () => getPlugin().then((p) => p.requestOverlayPermission()),
  showBubble: (opts) => getPlugin().then((p) => p.showBubble(opts)),
  hideBubble: () => getPlugin().then((p) => p.hideBubble()),
};
