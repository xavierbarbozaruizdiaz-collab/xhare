import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';
import { GEOCODE_USER_AGENT } from '@/lib/brand';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = GEOCODE_USER_AGENT;
const GEOCODE_REVERSE_WINDOW_MS = 60_000;
const GEOCODE_REVERSE_MAX_PER_WINDOW = 80;

export async function GET(request: NextRequest) {
  const clientId = getClientId(request);
  if (!checkRateLimit(`geocode-reverse:${clientId}`, GEOCODE_REVERSE_WINDOW_MS, GEOCODE_REVERSE_MAX_PER_WINDOW)) {
    return NextResponse.json(
      { error: 'Demasiadas búsquedas. Esperá un minuto.' },
      { status: 429 }
    );
  }
  const { searchParams } = new URL(request.url);
  const latRaw = searchParams.get('lat');
  const lngRaw = searchParams.get('lng');
  const lat = latRaw != null ? Number(latRaw) : NaN;
  const lng = lngRaw != null ? Number(lngRaw) : NaN;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'lat and lng required' }, { status: 400 });
  }

  try {
    const url = `${NOMINATIM_BASE}/reverse?format=json&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}&zoom=18&addressdetails=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: 'Nominatim error' },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Geocode reverse error:', error);
    return NextResponse.json(
      { error: 'Geocoding failed' },
      { status: 500 }
    );
  }
}
