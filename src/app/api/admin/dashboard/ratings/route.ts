import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { withAdminAuth, logBlockStart, logBlockOk, logBlockError } from '@/lib/admin-auth';

const BLOCK = 'ratings';

export async function GET(request: NextRequest) {
  return withAdminAuth(request, async () => {
    logBlockStart(BLOCK);
    try {
      const service = createServiceClient();
      const [driverRatingsRes, passengerRatingsRes] = await Promise.all([
        service.from('driver_ratings').select('stars'),
        service.from('passenger_ratings').select('stars'),
      ]);
      const driverRatings = driverRatingsRes.data ?? [];
      const passengerRatings = passengerRatingsRes.data ?? [];
      const ratingPromedioConductor =
        driverRatings.length > 0
          ? Math.round((driverRatings.reduce((s: number, r: { stars: number }) => s + r.stars, 0) / driverRatings.length) * 10) / 10
          : null;
      const ratingPromedioPasajero =
        passengerRatings.length > 0
          ? Math.round((passengerRatings.reduce((s: number, r: { stars: number }) => s + r.stars, 0) / passengerRatings.length) * 10) / 10
          : null;
      logBlockOk(BLOCK);
      return NextResponse.json({
        ratingPromedioConductor,
        ratingPromedioPasajero,
      });
    } catch (err) {
      logBlockError(BLOCK, err instanceof Error ? err.message : 'Unknown error', err);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  });
}
