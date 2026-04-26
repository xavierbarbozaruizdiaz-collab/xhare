import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuth } from '@/lib/api-auth';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

const bodySchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['android', 'ios', 'web']),
});
const PUSH_REGISTER_WINDOW_MS = 60_000;
const PUSH_REGISTER_MAX_PER_WINDOW = 20;

/**
 * Registra (o actualiza) el token de push del dispositivo para el usuario autenticado.
 * Se llama desde la app al obtener el token de FCM/APNS.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuth(request);
    if (auth instanceof NextResponse) return auth;
    const clientId = getClientId(request, auth.user.id);
    if (!checkRateLimit(`push-register:${clientId}`, PUSH_REGISTER_WINDOW_MS, PUSH_REGISTER_MAX_PER_WINDOW)) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Esperá un momento.' },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { token, platform } = bodySchema.parse(body);

    const { error } = await auth.supabase
      .from('push_tokens')
      .upsert(
        { user_id: auth.user.id, token, platform },
        { onConflict: 'user_id,token' }
      );

    if (error) {
      console.error('[push/register] upsert error:', error.message);
      return NextResponse.json({ error: 'No se pudo registrar el token de notificaciones.' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
