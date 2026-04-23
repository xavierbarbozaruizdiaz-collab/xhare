#!/usr/bin/env node
/* eslint-disable no-console */
const { createClient } = require('@supabase/supabase-js');
const { latLngToCell } = require('h3-js');

const TARGET_DATE = process.argv[2] || '2026-04-30';
const H3_RES = 6;

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error(
    'Faltan variables de entorno: SUPABASE_URL (o NEXT_PUBLIC_SUPABASE_URL) y SUPABASE_SERVICE_ROLE_KEY.'
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  console.log(`\n[reset-demand] Fecha objetivo: ${TARGET_DATE}`);

  // 1) Buscar grupos y solicitudes del día
  const { data: groups, error: gErr } = await supabase
    .from('demand_route_groups')
    .select('id')
    .eq('requested_date', TARGET_DATE);
  if (gErr) throw new Error(`No pude leer demand_route_groups: ${gErr.message}`);

  const { data: trips, error: tErr } = await supabase
    .from('trip_requests')
    .select('id, origin_lat, origin_lng, destination_lat, destination_lng')
    .eq('requested_date', TARGET_DATE);
  if (tErr) throw new Error(`No pude leer trip_requests: ${tErr.message}`);

  const groupIds = (groups || []).map((g) => g.id);
  const tripIds = (trips || []).map((t) => t.id);

  console.log(`[reset-demand] Grupos encontrados: ${groupIds.length}`);
  console.log(`[reset-demand] Solicitudes encontradas: ${tripIds.length}`);

  // 2) Borrar members ligados a grupos del día
  if (groupIds.length > 0) {
    for (const ids of chunk(groupIds, 200)) {
      const { error } = await supabase.from('demand_route_members').delete().in('group_id', ids);
      if (error) throw new Error(`Error borrando members por group_id: ${error.message}`);
    }
  }

  // 3) Borrar members de solicitudes del día (por seguridad extra)
  if (tripIds.length > 0) {
    for (const ids of chunk(tripIds, 200)) {
      const { error } = await supabase.from('demand_route_members').delete().in('trip_request_id', ids);
      if (error) throw new Error(`Error borrando members por trip_request_id: ${error.message}`);
    }
  }

  // 4) Borrar grupos del día
  if (groupIds.length > 0) {
    for (const ids of chunk(groupIds, 200)) {
      const { error } = await supabase.from('demand_route_groups').delete().in('id', ids);
      if (error) throw new Error(`Error borrando groups: ${error.message}`);
    }
  }

  // 5) Pasar trip_requests del día a pending (+ limpiar ride_id)
  const { error: pendingErr } = await supabase
    .from('trip_requests')
    .update({ status: 'pending', ride_id: null })
    .eq('requested_date', TARGET_DATE);
  if (pendingErr) throw new Error(`Error actualizando status pending: ${pendingErr.message}`);

  // 6) Recalcular super-hex para todas las solicitudes del día
  const updates = (trips || []).map((t) => ({
    id: t.id,
    origin_super_hex: latLngToCell(Number(t.origin_lat), Number(t.origin_lng), H3_RES),
    dest_super_hex: latLngToCell(Number(t.destination_lat), Number(t.destination_lng), H3_RES),
  }));

  for (const rows of chunk(updates, 200)) {
    const { error } = await supabase.from('trip_requests').upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(`Error recalculando super-hex: ${error.message}`);
  }

  // 7) Verificación final
  const { count: missingHexCount, error: checkErr } = await supabase
    .from('trip_requests')
    .select('id', { count: 'exact', head: true })
    .eq('requested_date', TARGET_DATE)
    .or('origin_super_hex.is.null,dest_super_hex.is.null');
  if (checkErr) throw new Error(`Error verificando super-hex: ${checkErr.message}`);

  console.log(`[reset-demand] Reset completado para ${TARGET_DATE}.`);
  console.log(`[reset-demand] Solicitudes con super-hex faltante: ${missingHexCount || 0}\n`);
}

main().catch((e) => {
  console.error(`[reset-demand] FALLÓ: ${e.message}`);
  process.exit(1);
});

