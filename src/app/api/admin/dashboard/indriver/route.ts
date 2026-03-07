import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { withAdminAuth, logBlockStart, logBlockOk, logBlockError } from '@/lib/admin-auth';

const BLOCK = 'indriver';

export async function GET(request: NextRequest) {
  return withAdminAuth(request, async () => {
    logBlockStart(BLOCK);
    try {
      const service = createServiceClient();
      const [
        passengerRequestsRes,
        driverAvailabilityRes,
        driverOffersRes,
        passengerOffersRes,
      ] = await Promise.all([
        service.from('passenger_ride_requests').select('id, status'),
        service.from('driver_ride_availability').select('id, status'),
        service.from('driver_offers').select('id, status, ride_id, proposed_price_per_seat'),
        service.from('passenger_offers').select('id, status, ride_id, offered_price_per_seat'),
      ]);

      const driverOffers = (driverOffersRes.data ?? []) as {
        id: string;
        status: string;
        ride_id: string | null;
        proposed_price_per_seat?: number;
      }[];
      const passengerOffers = (passengerOffersRes.data ?? []) as {
        id: string;
        status: string;
        ride_id: string | null;
        offered_price_per_seat?: number;
      }[];

      const offersAccepted =
        driverOffers.filter((o) => o.status === 'accepted').length +
        passengerOffers.filter((o) => o.status === 'accepted').length;
      const ridesFromOffers = new Set([
        ...driverOffers.filter((o): o is typeof o & { ride_id: string } => o.ride_id != null).map((o) => o.ride_id),
        ...passengerOffers.filter((o): o is typeof o & { ride_id: string } => o.ride_id != null).map((o) => o.ride_id),
      ]).size;

      logBlockOk(BLOCK);
      return NextResponse.json({
        solicitudesCreadas: (passengerRequestsRes.data ?? []).length,
        disponibilidadesCreadas: (driverAvailabilityRes.data ?? []).length,
        ofertasEnviadas: driverOffers.length + passengerOffers.length,
        ofertasAceptadas: offersAccepted,
        viajesCreadosDesdeOferta: ridesFromOffers,
        precioPromedioOfertadoDriver:
          driverOffers.length > 0
            ? Math.round(
                driverOffers.reduce((s, o) => s + (o.proposed_price_per_seat ?? 0), 0) / driverOffers.length
              )
            : null,
        precioPromedioOfertadoPassenger:
          passengerOffers.length > 0
            ? Math.round(
                passengerOffers.reduce((s, o) => s + (o.offered_price_per_seat ?? 0), 0) / passengerOffers.length
              )
            : null,
      });
    } catch (err) {
      logBlockError(BLOCK, err instanceof Error ? err.message : 'Unknown error', err);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  });
}
