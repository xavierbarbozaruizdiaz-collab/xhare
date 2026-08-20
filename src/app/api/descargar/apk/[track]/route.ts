import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { DOWNLOAD_SETTINGS_KEYS } from '@/lib/download-links';

export const dynamic = 'force-dynamic';

type Track = 'passenger' | 'driver';

function isTrack(value: string): value is Track {
  return value === 'passenger' || value === 'driver';
}

export async function GET(_request: NextRequest, context: { params: { track: string } }) {
  const track = context.params.track;
  if (!isTrack(track)) {
    return NextResponse.json({ error: 'No encontrado.' }, { status: 404 });
  }

  const key = track === 'passenger' ? DOWNLOAD_SETTINGS_KEYS.passengerApkUrl : DOWNLOAD_SETTINGS_KEYS.driverApkUrl;
  const service = createServiceClient();
  const { data, error } = await service.from('settings').select('value').eq('key', key).maybeSingle();
  if (error) {
    return NextResponse.json({ error: 'No se pudo obtener el APK.' }, { status: 500 });
  }

  const url = String(data?.value ?? '').trim();
  if (!url) {
    return NextResponse.json({ error: 'El APK todavía no está publicado.' }, { status: 404 });
  }

  return NextResponse.redirect(url, 302);
}
