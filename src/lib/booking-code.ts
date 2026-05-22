/** Muestra el código de ticket con prefijo # (ej. A471 → #A471). */
export function formatBookingTicketCode(code: string | null | undefined): string | null {
  const c = String(code ?? '').trim().toUpperCase();
  if (!c) return null;
  return c.startsWith('#') ? c : `#${c}`;
}
