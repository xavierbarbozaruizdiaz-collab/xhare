import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/server';
import { checkRateLimit, getClientId } from '@/lib/rate-limit';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key';

const ENSURE_DRIVER_WINDOW_MS = 60_000;
const ENSURE_DRIVER_MAX_PER_WINDOW = 10;

/**
 * El cliente guarda la sesión en localStorage; el servidor no la ve por cookies.
 * Este endpoint acepta access_token (y opcional refresh_token) en el body para identificar
 * al usuario y, con service role, poner el perfil en driver_pending.
 */
export async function POST(request: NextRequest) {
  try {
    const clientId = getClientId(request);
    if (!checkRateLimit(`ensure-driver:${clientId}`, ENSURE_DRIVER_WINDOW_MS, ENSURE_DRIVER_MAX_PER_WINDOW)) {
      return NextResponse.json(
        { error: 'Demasiadas solicitudes. Esperá un minuto.' },
        { status: 429 }
      );
    }

    let userId: string | null = null;

    const body = await request.json().catch(() => ({}));
    const accessToken = (body.access_token ?? request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')) as string | undefined;
    const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : undefined;
    const phone = typeof body.phone === 'string' ? body.phone.trim() : undefined;
    const address = typeof body.address === 'string' ? body.address.trim() : undefined;
    const city = typeof body.city === 'string' ? body.city.trim() : undefined;

    if (accessToken) {
      const supabase = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
      const { data: { user }, error } = await supabase.auth.getUser(accessToken);
      if (!error && user) userId = user.id;
    }

    if (!userId) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }

    const service = createServiceClient();
    const { data: profile } = await service
      .from('profiles')
      .select('role, full_name, phone, address, city')
      .eq('id', userId)
      .maybeSingle();

    const driverData: Record<string, unknown> = { role: 'driver_pending' };
    if (fullName !== undefined) driverData.full_name = fullName || null;
    if (phone !== undefined) driverData.phone = phone || null;
    if (address !== undefined) driverData.address = address || null;
    if (city !== undefined) driverData.city = city || null;

    if (!profile) {
      const { error: insertError } = await service
        .from('profiles')
        .insert({ id: userId, ...driverData });
      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true, role: 'driver_pending' });
    }

    if (profile.role === 'driver' || profile.role === 'admin') {
      return NextResponse.json({ ok: true, role: profile.role });
    }

    if (profile.role === 'passenger') {
      const { error: updateError } = await service
        .from('profiles')
        .update(driverData)
        .eq('id', userId);
      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    } else if (profile.role === 'driver_pending' && (fullName !== undefined || phone !== undefined || address !== undefined || city !== undefined)) {
      const updatePayload: Record<string, unknown> = {};
      if (fullName !== undefined) updatePayload.full_name = fullName || null;
      if (phone !== undefined) updatePayload.phone = phone || null;
      if (address !== undefined) updatePayload.address = address || null;
      if (city !== undefined) updatePayload.city = city || null;
      if (Object.keys(updatePayload).length > 0) {
        await service.from('profiles').update(updatePayload).eq('id', userId);
      }
    }

    return NextResponse.json({ ok: true, role: 'driver_pending' });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error interno' },
      { status: 500 }
    );
  }
}
