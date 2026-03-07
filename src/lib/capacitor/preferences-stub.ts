/**
 * Stub de @capacitor/preferences para el build (Vercel y local).
 * Misma API que el plugin real pero usando localStorage, para que webpack
 * no tenga que resolver el paquete real en el build.
 */
export const Preferences = {
  async get(options: { key: string }): Promise<{ value: string | null }> {
    if (typeof window === 'undefined') return { value: null };
    const value = localStorage.getItem(options.key);
    return { value };
  },
  async set(options: { key: string; value: string }): Promise<void> {
    if (typeof window === 'undefined') return;
    localStorage.setItem(options.key, options.value);
  },
  async remove(options: { key: string }): Promise<void> {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(options.key);
  },
};
