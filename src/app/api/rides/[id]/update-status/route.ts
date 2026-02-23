import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { z } from 'zod';

const updateStatusSchema = z.object({
  status: z.enum(['building', 'ready', 'assigned', 'en_route', 'completed', 'cancelled']),
});

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

    const updatePayload: { status: string; driver_lat?: null; driver_lng?: null; driver_location_updated_at?: null } = { status: validated.status };
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
