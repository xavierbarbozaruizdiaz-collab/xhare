import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { jwtDecode } from 'jwt-decode';

const bodySchema = z.object({
  awaiting: z.boolean(),
  access_token: z.string().optional(),
});

type JwtPayload = { sub?: string; user_id?: string };

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
    const token = authHeader.replace(/^\s*Bearer\s+/i, '').trim() || tokenFromBody || '';

    if (!token) {
      return NextResponse.json(
        { error: 'Sesión expirada o no válida. Volvé a iniciar sesión.' },
        { status: 401 }
      );
    }

    let userId: string | null = null;
    try {
      const payload = jwtDecode<JwtPayload>(token);
      userId = payload.sub ?? payload.user_id ?? null;
    } catch {
      return NextResponse.json(
        { error: 'Sesión expirada o no válida. Volvé a iniciar sesión.' },
        { status: 401 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'Sesión expirada o no válida. Volvé a iniciar sesión.' },
        { status: 401 }
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
