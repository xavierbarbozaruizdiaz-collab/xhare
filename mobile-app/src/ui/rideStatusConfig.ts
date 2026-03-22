/**
 * Ride and booking status labels/colors for UI.
 */
export function rideStatusConfig(status: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    draft: { label: 'Borrador', color: '#6b7280' },
    published: { label: 'Publicado', color: '#166534' },
    booked: { label: 'Con reservas', color: '#b45309' },
    en_route: { label: 'En camino', color: '#1d4ed8' },
    completed: { label: 'Completado', color: '#4b5563' },
    cancelled: { label: 'Cancelado', color: '#b91c1c' },
  };
  return map[status] ?? { label: status, color: '#6b7280' };
}

export function bookingStatusConfig(status: string): { label: string; color: string } {
  const map: Record<string, { label: string; color: string }> = {
    pending: { label: 'Pendiente', color: '#b45309' },
    confirmed: { label: 'Confirmada', color: '#166534' },
    completed: { label: 'Completado', color: '#4b5563' },
    cancelled: { label: 'Cancelada', color: '#b91c1c' },
  };
  return map[status] ?? { label: status, color: '#6b7280' };
}

export function formatRideDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-PY', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatRideTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('es-PY', { hour: '2-digit', minute: '2-digit' });
}
