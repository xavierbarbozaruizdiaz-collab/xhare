import { NextRequest, NextResponse } from 'next/server';
import { authGetUser, createServerClient } from '@/lib/supabase/server';

/**
 * Lista viajes del conductor. Fuente principal: rides + ride_stops + bookings.
 * No usa ride_passengers para métricas/listado principal.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient(request);

    const {
      data: { user },
      error: authError,
    } = await authGetUser(supabase, request);

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'driver') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: rides, error } = await supabase
      .from('rides')
      .select(`
        *,
        ride_stops(*),
        bookings(id, passenger_id, seats_count, status, price_paid, pickup_label, dropoff_label)
      `)
      .eq('driver_id', user.id)
      .order('departure_time', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(rides ?? []);
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
