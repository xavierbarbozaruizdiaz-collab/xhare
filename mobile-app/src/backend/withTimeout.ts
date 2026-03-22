/**
 * Evita promesas colgadas (fetch / Supabase sin respuesta) que dejan spinners infinitos en UI.
 * Acepta `Promise` o thenables (p. ej. builders de Supabase).
 */
export function raceWithTimeout<T>(promise: PromiseLike<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(onTimeout()), ms);
    Promise.resolve(promise)
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(t);
        reject(e);
      });
  });
}
