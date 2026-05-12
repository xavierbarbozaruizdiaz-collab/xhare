import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { processRideNoShowSanction } from '@/lib/process-driver-no-show-sanction';

/**
 * Cron (Vercel, 1×/día en Hobby): viajes published/booked con salida ya pasada y sin `en_route` → sanción operativa + cancelación.
 * Proteger con CRON_SECRET en Authorization: Bearer …
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = request.headers.get('authorization') ?? request.headers.get('Authorization') ?? '';
    if (auth.trim() !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
  }

  const service = createServiceClient();
  const nowIso = new Date().toISOString();
  const { data: rows, error } = await service
    .from('rides')
    .select('id')
    .lte('departure_time', nowIso)
    .in('status', ['published', 'booked'])
    .is('driver_no_show_processed_at', null)
    .not('driver_id', 'is', null)
    .limit(50);

  if (error) {
    console.error('[cron/driver-no-show]', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let processed = 0;
  for (const r of rows ?? []) {
    const id = (r as { id: string }).id;
    if (!id) continue;
    const ok = await processRideNoShowSanction(service, id);
    if (ok) processed += 1;
  }

  return NextResponse.json({ ok: true, processed, candidates: (rows ?? []).length });
}
