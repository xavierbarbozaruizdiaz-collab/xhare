import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServerClient();
    const requestId = params.id;

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Verify request belongs to user
    const { data: rideRequest } = await supabase
      .from('ride_requests')
      .select('*')
      .eq('id', requestId)
      .eq('passenger_id', user.id)
      .single();

    if (!rideRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    if (rideRequest.status !== 'proposed') {
      return NextResponse.json(
        { error: 'Request is not in proposed status' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('ride_requests')
      .update({ status: 'confirmed' })
      .eq('id', requestId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Log audit event
    await supabase.from('audit_events').insert({
      actor_id: user.id,
      entity_type: 'ride_request',
      entity_id: requestId,
      event_type: 'confirmed',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

