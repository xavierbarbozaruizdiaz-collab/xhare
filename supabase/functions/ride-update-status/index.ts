import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('NEXT_PUBLIC_SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('NEXT_PUBLIC_SUPABASE_ANON_KEY');

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[ride-update-status] Missing SUPABASE_URL or SUPABASE_ANON_KEY in Edge Function environment');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const jsonHeaders = {
    ...corsHeaders,
    'Content-Type': 'application/json',
  };

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  try {
    const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^\s*Bearer\s+/i, '').trim();

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return new Response(JSON.stringify({ error: 'server_misconfigured' }), {
        status: 500,
        headers: jsonHeaders,
      });
    }

    if (!token) {
      return new Response(
        JSON.stringify({ error: 'unauthorized', details: 'Missing or invalid Authorization header (expected Bearer <jwt>)' }),
        { status: 401, headers: jsonHeaders }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    // Validar JWT explícitamente (recomendado en Edge Functions para evitar fallos por contexto)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({
          error: 'unauthorized',
          details: authError?.message ?? 'Invalid or expired JWT',
        }),
        { status: 401, headers: jsonHeaders }
      );
    }

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'invalid_json' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const { ride_id, status } = (payload ?? {}) as {
      ride_id?: string;
      status?: string;
    };

    if (!ride_id || typeof ride_id !== 'string') {
      return new Response(JSON.stringify({ error: 'invalid_ride_id' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const allowedStatuses = ['en_route', 'completed'] as const;
    if (!status || !allowedStatuses.includes(status as (typeof allowedStatuses)[number])) {
      return new Response(JSON.stringify({ error: 'invalid_status' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }

    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .select('id, driver_id')
      .eq('id', ride_id)
      .single();

    if (rideError || !ride) {
      return new Response(
        JSON.stringify({ error: 'ride_not_found', details: rideError?.message }),
        { status: 404, headers: jsonHeaders }
      );
    }

    if (ride.driver_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'forbidden', details: 'Only the driver of this ride can update its status' }),
        { status: 403, headers: jsonHeaders }
      );
    }

    const { data: account } = await supabase
      .from('driver_accounts')
      .select('account_status')
      .eq('driver_id', user.id)
      .maybeSingle();
    if (account?.account_status === 'suspended') {
      return new Response(
        JSON.stringify({
          error: 'account_suspended',
          details: 'Tu cuenta está suspendida por deuda pendiente. Contactá a soporte para regularizar.',
        }),
        { status: 403, headers: jsonHeaders }
      );
    }

    const updatePayload: Record<string, unknown> = { status };
    const now = new Date().toISOString();
    if (status === 'en_route') {
      // Solo seteamos started_at; el esquema actual de rides no tiene completed_at.
      updatePayload.started_at = now;
    }

    const { error: updateError } = await supabase
      .from('rides')
      .update(updatePayload)
      .eq('id', ride_id);

    if (updateError) {
      return new Response(
        JSON.stringify({
          error: 'update_failed',
          details: updateError.message,
          hint: 'If message mentions RLS or policy, the driver may not match auth.uid() for this ride',
        }),
        { status: 400, headers: jsonHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        ride_id,
        status,
      }),
      {
        status: 200,
        headers: jsonHeaders,
      },
    );
  } catch (err) {
    console.error('[ride-update-status] unexpected_error', { message: (err as Error).message });
    return new Response(JSON.stringify({ error: 'unexpected_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

