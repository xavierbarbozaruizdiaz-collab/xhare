import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('NEXT_PUBLIC_SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_BATCH = 100;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[ride-update-status] Missing SUPABASE_URL or SUPABASE_ANON_KEY in Edge Function environment');
}

type ExpoMsg = {
  to: string;
  sound: 'default';
  title: string;
  body: string;
  data: { rideId: string; type: 'ride_en_route' };
};

/**
 * Pasajeros con reserva no cancelada: Expo Push (tokens en push_tokens).
 * Requiere SUPABASE_SERVICE_ROLE_KEY en secrets de la función.
 */
async function sendPassengersRideEnRoutePush(
  admin: ReturnType<typeof createClient>,
  rideId: string
): Promise<void> {
  const { data: bookings, error: bErr } = await admin
    .from('bookings')
    .select('passenger_id')
    .eq('ride_id', rideId)
    .neq('status', 'cancelled');

  if (bErr || !bookings?.length) return;

  const userIds = [...new Set(bookings.map((b: { passenger_id: string }) => b.passenger_id))];

  const { data: rows, error: tErr } = await admin
    .from('push_tokens')
    .select('token')
    .in('user_id', userIds);

  if (tErr || !rows?.length) return;

  const tokens = [
    ...new Set(
      rows
        .map((r: { token: string }) => r.token)
        .filter((t: string) => typeof t === 'string' && t.startsWith('ExponentPushToken'))
    ),
  ];
  if (!tokens.length) return;

  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN')?.trim();
  const title = 'El viaje comenzó';
  const body = 'El conductor inició el recorrido. Podés seguirlo en el mapa.';
  const messages: ExpoMsg[] = tokens.map((to: string) => ({
    to,
    sound: 'default',
    title,
    body,
    data: { rideId, type: 'ride_en_route' },
  }));

  for (let i = 0; i < messages.length; i += EXPO_BATCH) {
    const chunk = messages.slice(i, i + EXPO_BATCH);
    const payload = chunk.length === 1 ? chunk[0] : chunk;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[ride-update-status] expo_push_http', res.status, text);
    }
  }
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

    // Un conductor no puede tener más de un viaje en curso a la vez
    if (status === 'en_route') {
      const { data: otherEnRoute } = await supabase
        .from('rides')
        .select('id')
        .eq('driver_id', user.id)
        .eq('status', 'en_route')
        .neq('id', ride_id)
        .limit(1);
      if (otherEnRoute && otherEnRoute.length > 0) {
        return new Response(
          JSON.stringify({
            error: 'already_has_active_ride',
            details: 'Ya tenés un viaje en curso. Finalizá ese viaje antes de iniciar otro.',
          }),
          { status: 400, headers: jsonHeaders }
        );
      }
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

    if (status === 'en_route' && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        await sendPassengersRideEnRoutePush(admin, ride_id);
      } catch (e) {
        console.error('[ride-update-status] passenger_en_route_push_failed', {
          message: (e as Error)?.message,
        });
      }
    } else if (status === 'en_route') {
      console.warn(
        '[ride-update-status] en_route without SUPABASE_SERVICE_ROLE_KEY: skip passenger push'
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

