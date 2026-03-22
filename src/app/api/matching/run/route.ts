import { NextRequest, NextResponse } from 'next/server';
import { authGetUser, createServerClient, createServiceClient } from '@/lib/supabase/server';
import { matchRequest } from '@/lib/matching/engine';

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerClient(request);

    const {
      data: { user },
      error: authError,
    } = await authGetUser(supabase, request);

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

    const serviceSupabase = createServiceClient();
    
    // Get all submitted/confirmed requests that haven't been assigned
    const { data: requests, error: requestsError } = await serviceSupabase
      .from('ride_requests')
      .select('*')
      .in('status', ['submitted', 'confirmed'])
      .order('created_at', { ascending: true });

    if (requestsError) {
      return NextResponse.json(
        { error: requestsError.message },
        { status: 400 }
      );
    }

    const results = [];
    for (const req of requests || []) {
      const result = await matchRequest(req.id);
      results.push({
        requestId: req.id,
        ...result,
      });
    }

    return NextResponse.json({
      processed: results.length,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

