import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

/**
 * GET /api/health
 * Para monitoreo y balanceadores: comprueba que la app y la DB responden.
 */
export async function GET() {
  try {
    const supabase = createServerClient();
    const { error } = await supabase.from('profiles').select('id').limit(1).maybeSingle();
    const dbOk = !error;
    return NextResponse.json(
      { ok: true, db: dbOk, timestamp: new Date().toISOString() },
      { status: dbOk ? 200 : 503 }
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Health check failed' },
      { status: 503 }
    );
  }
}
