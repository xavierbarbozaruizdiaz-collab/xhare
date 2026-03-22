import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuth } from '@/lib/api-auth';

const bodySchema = z.object({
  token: z.string().min(1),
  platform: z.enum(['android', 'ios', 'web']),
});

/**
 * Registra (o actualiza) el token de push del dispositivo para el usuario autenticado.
 * Se llama desde la app al obtener el token de FCM/APNS.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { token, platform } = bodySchema.parse(body);

    const { error } = await auth.supabase
      .from('push_tokens')
      .upsert(
        { user_id: auth.user.id, token, platform },
        { onConflict: 'user_id,token' }
      );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
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
