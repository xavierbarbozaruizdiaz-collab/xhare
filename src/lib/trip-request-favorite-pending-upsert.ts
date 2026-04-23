import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Una sola solicitud pending por (usuario, slot de favorito, fecha y hora de recogida).
 * Evita duplicados si el pasajero toca varias veces "Guardar" o vuelve a guardar el mismo favorito.
 */
export async function insertOrUpdatePendingTripRequestFromFavorite(
  supabase: SupabaseClient,
  insertRow: Record<string, unknown>
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const fav = String(insertRow.passenger_favorite_slot ?? '').trim();
  const uid = String(insertRow.user_id ?? '').trim();
  const rd = String(insertRow.requested_date ?? '').trim();
  const rt = String(insertRow.requested_time ?? '').trim();

  if (!fav || !uid || !rd || !rt) {
    const { data, error } = await supabase.from('trip_requests').insert(insertRow).select('id').single();
    if (error) return { ok: false, error: error.message };
    if (!data?.id) return { ok: false, error: 'No se obtuvo id al insertar.' };
    return { ok: true, id: String(data.id) };
  }

  const { data: existing, error: qErr } = await supabase
    .from('trip_requests')
    .select('id')
    .eq('user_id', uid)
    .eq('passenger_favorite_slot', fav)
    .eq('requested_date', rd)
    .eq('requested_time', rt)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (qErr) return { ok: false, error: qErr.message };

  const ids = (existing ?? []).map((r) => String((r as { id: string }).id)).filter(Boolean);
  const updatePayload: Record<string, unknown> = { ...insertRow };
  delete updatePayload.id;
  delete updatePayload.user_id;

  if (ids.length === 0) {
    const { data, error } = await supabase.from('trip_requests').insert(insertRow).select('id').single();
    if (error) return { ok: false, error: error.message };
    if (!data?.id) return { ok: false, error: 'No se obtuvo id al insertar.' };
    return { ok: true, id: String(data.id) };
  }

  const keepId = ids[0]!;
  const { data: updated, error: uErr } = await supabase
    .from('trip_requests')
    .update(updatePayload)
    .eq('id', keepId)
    .select('id')
    .single();

  if (uErr) return { ok: false, error: uErr.message };

  if (ids.length > 1) {
    const { error: dErr } = await supabase.from('trip_requests').delete().in('id', ids.slice(1));
    if (dErr) return { ok: false, error: dErr.message };
  }

  const id = String(updated?.id ?? keepId);
  return { ok: true, id };
}
