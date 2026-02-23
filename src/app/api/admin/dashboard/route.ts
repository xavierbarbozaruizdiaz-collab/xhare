import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServerClient();
    
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get stats
    const [requests, rides, passengers, profilesByRole] = await Promise.all([
      supabase
        .from('ride_requests')
        .select('id, status, mode, created_at', { count: 'exact' }),
      supabase
        .from('rides')
        .select('id, status, capacity, departure_time', { count: 'exact' }),
      supabase
        .from('ride_passengers')
        .select('id, status', { count: 'exact' }),
      supabase
        .from('profiles')
        .select('role'),
    ]);

    const pendingDrivers = profilesByRole.data?.filter((p) => p.role === 'driver_pending').length ?? 0;
    const totalDrivers = profilesByRole.data?.filter((p) => p.role === 'driver').length ?? 0;
    const totalPassengersProfile = profilesByRole.data?.filter((p) => p.role === 'passenger').length ?? 0;

    // Get recent requests
    const { data: recentRequests } = await supabase
      .from('ride_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    // Get active rides
    const { data: activeRides } = await supabase
      .from('rides')
      .select(`
        *,
        driver:profiles!rides_driver_id_fkey(id, full_name),
        ride_passengers(count)
      `)
      .in('status', ['building', 'ready', 'assigned', 'en_route'])
      .order('departure_time', { ascending: true });

    return NextResponse.json({
      stats: {
        totalRequests: requests.count || 0,
        totalRides: rides.count || 0,
        totalPassengers: passengers.count || 0,
        pendingDrivers,
        totalDrivers,
        totalPassengersProfile,
      },
      recentRequests: recentRequests || [],
      activeRides: activeRides || [],
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

