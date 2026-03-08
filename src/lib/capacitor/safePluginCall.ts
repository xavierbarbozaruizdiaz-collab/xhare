/**
 * Helper central para resultados de plugins Capacitor en Android.
 * En Android algunos métodos devuelven un proxy en lugar de una Promise; al hacer
 * await el runtime llama .then() sobre el proxy y lanza ".then() is not implemented".
 * Este módulo es el único lugar que trata ese caso; el resto del código usa
 * unwrapPluginResult() y deja de duplicar try/catch.
 */

const THEN_NOT_IMPLEMENTED =
  (e: unknown) => {
    const msg = String(e).toLowerCase();
    return msg.includes('then') && msg.includes('not implemented');
  };

/**
 * Convierte el retorno de un método de plugin (Promise real o proxy en Android) en
 * un valor resuelto. Si el valor es thenable y al hacer await lanza "then() is not
 * implemented", devuelve fallback en lugar de propagar el error.
 */
export async function unwrapPluginResult<T>(
  raw: unknown,
  fallback: T
): Promise<T> {
  if (raw == null) return fallback;
  const thenable =
    typeof (raw as unknown as { then?: unknown })?.then === 'function';
  if (!thenable) return raw as T;
  try {
    return (await (raw as Promise<T>)) as T;
  } catch (e) {
    if (THEN_NOT_IMPLEMENTED(e)) return fallback;
    throw e;
  }
}
