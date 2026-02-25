import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

const RIDE_STATUSES = ['draft', 'published', 'booked', 'en_route', 'completed', 'cancelled'] as const;
const updateStatusSchema = z.object({
  status: z.enum(RIDE_STATUSES),
});

const UPDATE_STATUS_WINDOW_MS = 60_000;
const UPDATE_STATUS_MAX_PER_WINDOW = 30;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServerClient();
    const rideId = params.id;

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const clientId = getClientId(request, user.id);
    if (!checkRateLimit(`update-status:${clientId}`, UPDATE_STATUS_WINDOW_MS, UPDATE_STATUS_MAX_PER_WINDOW)) {
      return NextResponse.json(
        { error: 'Demasiadas actualizaciones. Esperá un momento.' },
        { status: 429 }
      );
    }

    // Check if user is driver
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'driver') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Verify driver owns this ride
    const { data: ride } = await supabase
      .from('rides')
      .select('driver_id')
      .eq('id', rideId)
      .single();

    if (!ride || ride.driver_id !== user.id) {
      return NextResponse.json({ error: 'Ride not found or not assigned to you' }, { status: 404 });
    }

    const body = await request.json();
    const validated = updateStatusSchema.parse(body);

    const updatePayload: Record<string, unknown> = { status: validated.status };
    if (validated.status === 'en_route') {
      updatePayload.started_at = new Date().toISOString();
      updatePayload.current_stop_index = 0;
      updatePayload.awaiting_stop_confirmation = false;
    }
    if (validated.status === 'completed') {
      updatePayload.driver_lat = null;
      updatePayload.driver_lng = null;
      updatePayload.driver_location_updated_at = null;
    }

    const { error: updateError } = await supabase
      .from('rides')
      .update(updatePayload)
      .eq('id', rideId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
