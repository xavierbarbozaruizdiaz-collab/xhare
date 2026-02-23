import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';

const createRequestSchema = z.object({
  pickup_lat: z.number(),
  pickup_lng: z.number(),
  pickup_label: z.string().optional(),
  dropoff_lat: z.number(),
  dropoff_lng: z.number(),
  dropoff_label: z.string().optional(),
  pax_count: z.number().int().min(1).max(4),
  window_start: z.string().datetime(),
  window_end: z.string().datetime(),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient();
    
    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'passenger') {
      return NextResponse.json(
        { error: 'Only passengers can create requests' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const validated = createRequestSchema.parse(body);

    const { data, error } = await supabase
      .from('ride_requests')
      .insert({
        passenger_id: user.id,
        ...validated,
        status: 'submitted',
        mode: 'unknown',
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Log audit event
    await supabase.from('audit_events').insert({
      actor_id: user.id,
      entity_type: 'ride_request',
      entity_id: data.id,
      event_type: 'created',
      payload: validated,
    });

    return NextResponse.json(data, { status: 201 });
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

    const { data, error } = await supabase
      .from('ride_requests')
      .select('*')
      .eq('passenger_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

