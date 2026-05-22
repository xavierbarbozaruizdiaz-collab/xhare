/** Texto legible para `rides.vehicle_info` (jsonb u objeto en app). */
export function formatVehicleInfoLabel(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t || t === '[object Object]') return null;
    try {
      const parsed = JSON.parse(t) as unknown;
      if (parsed && typeof parsed === 'object') return formatVehicleInfoLabel(parsed);
    } catch {
      return t;
    }
    return t;
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as { model?: unknown; year?: unknown };
    const model = String(o.model ?? '').trim();
    const year = o.year != null && String(o.year).trim() ? String(o.year).trim() : '';
    const parts = [model, year].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : null;
  }
  return null;
}
