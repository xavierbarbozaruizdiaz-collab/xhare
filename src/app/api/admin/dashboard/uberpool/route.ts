import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { withAdminAuth, logBlockStart, logBlockOk, logBlockError } from '@/lib/admin-auth';

const BLOCK = 'uberpool';

export async function GET(request: NextRequest) {
  return withAdminAuth(request, async () => {
    logBlockStart(BLOCK);
    try {
      const service = createServiceClient();
      const [
        ridesPublished,
        ridesEnRoute,
        ridesCompleted,
        ridesAll,
        bookingsRes,
      ] = await Promise.all([
        service.from('rides').select('id', { count: 'exact', head: true }).eq('status', 'published'),
        service.from('rides').select('id', { count: 'exact', head: true }).eq('status', 'en_route'),
        service.from('rides').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
        service.from('rides').select('id, status'),
        service.from('bookings').select('id, status, seats_count'),
      ]);

      const bookings = (bookingsRes.data ?? []) as { id: string; status: string; seats_count?: number }[];
      const totalBookings = bookings.length;
      const cancelledBookings = bookings.filter((b) => b.status === 'cancelled').length;
      const seatsOccupied = bookings
        .filter((b) => b.status !== 'cancelled')
        .reduce((sum, b) => sum + (b.seats_count ?? 0), 0);
      const cancellationRate =
        totalBookings > 0 ? Math.round((cancelledBookings / totalBookings) * 100) : 0;

      const ridesAllData = (ridesAll.data ?? []) as { id: string; status: string }[];
      const activeRides = ridesAllData.filter((r) =>
        ['published', 'booked', 'en_route'].includes(r.status)
      );
      const activeRideIds = activeRides.map((r) => r.id);

      let activeRidesWithDriver: unknown[] = [];
      if (activeRideIds.length > 0) {
        const { data: withDriver } = await service
          .from('rides')
          .select('*, driver:profiles!rides_driver_id_fkey(id, full_name)')
          .in('id', activeRideIds)
          .order('departure_time', { ascending: true });
        activeRidesWithDriver = withDriver ?? [];
      }

      const rp = ridesPublished as { count: number | null };
      const re = ridesEnRoute as { count: number | null };
      const rc = ridesCompleted as { count: number | null };

      logBlockOk(BLOCK);
      return NextResponse.json({
        totalViajesPublicados: rp.count ?? 0,
        viajesEnCurso: re.count ?? 0,
        viajesCompletados: rc.count ?? 0,
        totalReservas: totalBookings,
        asientosOcupados: seatsOccupied,
        tasaCancelacion: cancellationRate,
        activeRides: activeRidesWithDriver,
      });
    } catch (err) {
      logBlockError(BLOCK, err instanceof Error ? err.message : 'Unknown error', err);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  });
}
