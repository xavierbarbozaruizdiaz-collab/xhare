import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../backend/supabase';

const SKIPPED_KEY = 'passenger_skipped_driver_rating_rides_v1';

export type PendingDriverRatingPrompt = {
  rideId: string;
  bookingId: string;
  driverName: string;
};

export async function loadSkippedDriverRatingRideIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(SKIPPED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map((x) => String(x)).filter(Boolean));
  } catch {
    return new Set();
  }
}

export async function markDriverRatingRideSkipped(rideId: string): Promise<void> {
  const id = String(rideId ?? '').trim();
  if (!id) return;
  const set = await loadSkippedDriverRatingRideIds();
  set.add(id);
  await AsyncStorage.setItem(SKIPPED_KEY, JSON.stringify([...set]));
}

export async function fetchPendingPassengerDriverRating(
  passengerId: string,
  skippedRideIds: ReadonlySet<string>,
  extraExcludedRideIds?: ReadonlySet<string>
): Promise<PendingDriverRatingPrompt | null> {
  const uid = String(passengerId ?? '').trim();
  if (!uid) return null;

  const { data: bookings, error: bErr } = await supabase
    .from('bookings')
    .select('id, ride_id')
    .eq('passenger_id', uid)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(40);
  if (bErr || !bookings?.length) return null;

  const bookingIds = bookings.map((b) => String(b.id)).filter(Boolean);
  const rideIds = [...new Set(bookings.map((b) => String(b.ride_id)).filter(Boolean))];
  if (bookingIds.length === 0 || rideIds.length === 0) return null;

  const [{ data: drops }, { data: rated }, { data: rides }] = await Promise.all([
    supabase
      .from('ride_boarding_events')
      .select('booking_id, ride_id')
      .in('booking_id', bookingIds)
      .eq('event_type', 'dropped_off'),
    supabase.from('driver_ratings').select('ride_id').eq('passenger_id', uid).in('ride_id', rideIds),
    supabase
      .from('rides')
      .select('id, status, driver:profiles!rides_driver_id_fkey(full_name)')
      .in('id', rideIds)
      .in('status', ['en_route', 'completed']),
  ]);

  const droppedBookingIds = new Set((drops ?? []).map((d) => String(d.booking_id)));
  const ratedRideIds = new Set((rated ?? []).map((r) => String(r.ride_id)));
  const rideById = new Map(
    (rides ?? []).map((r) => {
      const row = r as {
        id: string;
        status?: string;
        driver?: { full_name?: string } | { full_name?: string }[] | null;
      };
      const drv = Array.isArray(row.driver) ? row.driver[0] : row.driver;
      return [String(row.id), { status: String(row.status ?? ''), driverName: drv?.full_name?.trim() || 'el conductor' }];
    })
  );

  for (const b of bookings) {
    const bookingId = String(b.id);
    const rideId = String(b.ride_id);
    if (!droppedBookingIds.has(bookingId)) continue;
    if (ratedRideIds.has(rideId)) continue;
    if (skippedRideIds.has(rideId) || extraExcludedRideIds?.has(rideId)) continue;
    const ride = rideById.get(rideId);
    if (!ride) continue;
    if (ride.status !== 'en_route' && ride.status !== 'completed') continue;
    return { rideId, bookingId, driverName: ride.driverName };
  }
  return null;
}
