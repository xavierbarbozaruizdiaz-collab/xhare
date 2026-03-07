import { Capacitor, registerPlugin } from '@capacitor/core';

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

function createSafePlugin(): BubbleOverlayPlugin {
  if (!Capacitor.isNativePlatform()) return noopImpl;
  const native = registerPlugin<BubbleOverlayPlugin>('BubbleOverlay');
  return {
    hasOverlayPermission: () => native.hasOverlayPermission(),
    requestOverlayPermission: () => native.requestOverlayPermission(),
    showBubble: (opts) => native.showBubble(opts ?? {}),
    hideBubble: () => native.hideBubble(),
  };
}

export const BubbleOverlay: BubbleOverlayPlugin = createSafePlugin();
