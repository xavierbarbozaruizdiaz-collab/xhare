import { NextRequest, NextResponse } from 'next/server';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'XhareTransporte/1.0 (https://github.com/xhare-transporte)';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  const countrycodes = searchParams.get('countrycodes') ?? 'py';
  const limit = searchParams.get('limit') ?? '5';

  if (!q || q.length < 2) {
    return NextResponse.json({ error: 'q required (min 2 chars)' }, { status: 400 });
  }

  try {
    const params = new URLSearchParams({
      format: 'json',
      q,
      limit,
      addressdetails: '1',
      countrycodes,
    });
    const url = `${NOMINATIM_BASE}/search?${params.toString()}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: 'Nominatim error', details: text },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Geocode search error:', error);
    return NextResponse.json(
      { error: 'Geocoding failed' },
      { status: 500 }
    );
  }
}
