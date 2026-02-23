import type { RideRequest, Point, Settings } from '@/types';
import { createServiceClient } from '@/lib/supabase/server';
import {
  isWithinCorridor,
  closestPointOnPolyline,
  distanceMeters,
} from '@/lib/geo';

interface MatchingResult {
  success: boolean;
  rideId?: string;
  meetingPoint?: Point;
  message: string;
}

/**
 * Match a request to a route-fixed ride
 */
export async function matchRouteFixed(
  requestId: string
): Promise<MatchingResult> {
  const supabase = createServiceClient();

  try {
    // 1. Load the request
    const { data: request, error: requestError } = await supabase
      .from('ride_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (requestError || !request) {
      return {
        success: false,
        message: 'Request not found',
      };
    }

    // 2. Load settings
    const { data: settingsData } = await supabase
      .from('settings')
      .select('key, value');

    const settings: Partial<Settings> = {};
    settingsData?.forEach((s) => {
      const key = s.key as keyof Settings;
      if (typeof s.value === 'number' || typeof s.value === 'boolean') {
        settings[key] = s.value as any;
      } else {
        settings[key] = Number(s.value) as any;
      }
    });

    const corridorM = settings.route_corridor_m || 800;
    const timeWindowMinutes = settings.time_window_minutes || 20;
    const capacity = settings.capacity || 15;

    // 3. Load active route (for MVP, assume one active route)
    const { data: routes } = await supabase
      .from('routes')
      .select('*')
      .eq('active', true)
      .limit(1);

    if (!routes || routes.length === 0) {
      return {
        success: false,
        message: 'No active route found',
      };
    }

    const route = routes[0];
    const polyline: Point[] = route.polyline as Point[];

    // 4. Check if pickup and dropoff are within corridor
    const pickup: Point = {
      lat: request.pickup_lat,
      lng: request.pickup_lng,
    };
    const dropoff: Point = {
      lat: request.dropoff_lat,
      lng: request.dropoff_lng,
    };

    const pickupInCorridor = isWithinCorridor(pickup, polyline, corridorM);
    const dropoffInCorridor = isWithinCorridor(dropoff, polyline, corridorM);

    if (!pickupInCorridor || !dropoffInCorridor) {
      return {
        success: false,
        message: 'Request outside route corridor',
      };
    }

    // 5. Propose meeting point (closest point on polyline to pickup)
    const { point: meetingPoint } = closestPointOnPolyline(pickup, polyline);

    // 6. Calculate departure time bucket
    const windowStart = new Date(request.window_start);
    const bucketMinutes = timeWindowMinutes;
    const bucketTime = new Date(
      Math.floor(windowStart.getTime() / (bucketMinutes * 60 * 1000)) *
        (bucketMinutes * 60 * 1000)
    );

    // 7. Find or create a ride for this departure time
    const { data: existingRides } = await supabase
      .from('rides')
      .select('*, ride_passengers(count)')
      .eq('mode', 'route_fixed')
      .eq('status', 'building')
      .eq('departure_time', bucketTime.toISOString())
      .eq('route_id', route.id);

    let rideId: string;

    // Check if we can add to existing ride
    let targetRide = existingRides?.find((ride: any) => {
      const currentPax = ride.ride_passengers?.[0]?.count || 0;
      return currentPax + request.pax_count <= capacity;
    });

    if (targetRide) {
      rideId = targetRide.id;
    } else {
      // Create new ride
      const { data: newRide, error: rideError } = await supabase
        .from('rides')
        .insert({
          mode: 'route_fixed',
          route_id: route.id,
          capacity,
          status: 'building',
          departure_time: bucketTime.toISOString(),
        })
        .select()
        .single();

      if (rideError || !newRide) {
        return {
          success: false,
          message: 'Failed to create ride',
        };
      }

      rideId = newRide.id;

      // Create initial stop for meeting point
      await supabase.from('ride_stops').insert({
        ride_id: rideId,
        stop_order: 0,
        lat: meetingPoint.lat,
        lng: meetingPoint.lng,
        label: 'Meeting Point',
      });
    }

    // 8. Add passenger to ride
    const { error: passengerError } = await supabase
      .from('ride_passengers')
      .insert({
        ride_id: rideId,
        request_id: requestId,
        passenger_id: request.passenger_id,
        status: 'pending',
      });

    if (passengerError) {
      return {
        success: false,
        message: 'Failed to add passenger to ride',
      };
    }

    // 9. Update request with meeting point and status
    const { error: updateError } = await supabase
      .from('ride_requests')
      .update({
        mode: 'route_fixed',
        status: 'assigned',
        proposed_meeting_lat: meetingPoint.lat,
        proposed_meeting_lng: meetingPoint.lng,
        proposed_meeting_label: 'Meeting Point',
      })
      .eq('id', requestId);

    if (updateError) {
      return {
        success: false,
        message: 'Failed to update request',
      };
    }

    // 10. Log audit event
    await supabase.from('audit_events').insert({
      actor_id: null, // System action
      entity_type: 'ride_request',
      entity_id: requestId,
      event_type: 'matched_route_fixed',
      payload: {
        ride_id: rideId,
        meeting_point: meetingPoint,
      },
    });

    return {
      success: true,
      rideId,
      meetingPoint,
      message: 'Successfully matched to route-fixed ride',
    };
  } catch (error) {
    console.error('Error in matchRouteFixed:', error);
    return {
      success: false,
      message: 'Internal error during matching',
    };
  }
}

