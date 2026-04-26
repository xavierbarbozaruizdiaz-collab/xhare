import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';
import { z } from 'zod';

const bodySchema = z.object({
  awaiting: z.boolean(),
  access_token: z.string().optional(),
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key';
const AWAITING_CONFIRMATION_WINDOW_MS = 60_000;
const AWAITING_CONFIRMATION_MAX_PER_WINDOW = 40;

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const service = createServiceClient();
    const rideId = params.id;

    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    const awaiting = parsed.success ? parsed.data.awaiting : undefined;
    const tokenFromBody = parsed.success ? parsed.data.access_token : undefined;

    const authHeader = request.headers.get('authorization') ?? request.headers.get('Authorization') ?? '';
    const tokenFromHeader = authHeader.replace(/^\s*Bearer\s+/i, '').trim();
    const tokenFromBodyClean = String(tokenFromBody ?? '').trim();
    const tokenCandidates = [tokenFromHeader, tokenFromBodyClean].filter(Boolean);
    if (tokenCandidates.length === 0) {
      return NextResponse.json(
        { error: 'Sesión expirada o no válida. Volvé a iniciar sesión.' },
        { status: 401 }
      );
    }

    let userId = '';
    let authenticated = false;
    for (const token of tokenCandidates) {
      const jwtClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const {
        data: { user },
        error: authError,
      } = await jwtClient.auth.getUser();
      if (!authError && user?.id) {
        userId = String(user.id);
        authenticated = true;
        break;
      }
    }
    if (!authenticated || !userId) {
      return NextResponse.json(
        { error: 'Sesión expirada o no válida. Volvé a iniciar sesión.' },
        { status: 401 }
      );
    }
    const clientId = getClientId(request, userId);
    if (!checkRateLimit(`set-awaiting-confirmation:${rideId}:${clientId}`, AWAITING_CONFIRMATION_WINDOW_MS, AWAITING_CONFIRMATION_MAX_PER_WINDOW)) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Esperá un momento.' },
        { status: 429 }
      );
    }

    const { data: ride } = await service
      .from('rides')
      .select('id, driver_id, status')
      .eq('id', rideId)
      .single();

    if (!ride || ride.driver_id !== userId) {
      return NextResponse.json({ error: 'Ride not found or not yours' }, { status: 404 });
    }

    if (ride.status !== 'en_route') {
      return NextResponse.json(
        { error: 'Solo podés usar esto cuando el viaje está en curso' },
        { status: 400 }
      );
    }

    if (typeof awaiting !== 'boolean') {
      return NextResponse.json({ error: 'Body debe incluir awaiting (boolean)' }, { status: 400 });
    }

    const { error: updateError } = await service
      .from('rides')
      .update({ awaiting_stop_confirmation: awaiting })
      .eq('id', rideId);

    if (updateError) {
      console.error('[set-awaiting-confirmation] update error:', updateError.message);
      return NextResponse.json({ error: 'No se pudo actualizar la confirmación de parada.' }, { status: 400 });
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
