import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';

const assignDriverSchema = z.object({
  driver_id: z.string().uuid(),
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

    // Check if user is admin
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const validated = assignDriverSchema.parse(body);

    // Verify driver exists and is a driver
    const { data: driverProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', validated.driver_id)
      .eq('role', 'driver')
      .single();

    if (!driverProfile) {
      return NextResponse.json(
        { error: 'Driver not found' },
        { status: 404 }
      );
    }

    // Update ride
    const { error: updateError } = await supabase
      .from('rides')
      .update({
        driver_id: validated.driver_id,
        status: 'assigned',
      })
      .eq('id', rideId);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 400 }
      );
    }

    // Log audit event
    await supabase.from('audit_events').insert({
      actor_id: user.id,
      entity_type: 'ride',
      entity_id: rideId,
      event_type: 'driver_assigned',
      payload: { driver_id: validated.driver_id },
    });

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

