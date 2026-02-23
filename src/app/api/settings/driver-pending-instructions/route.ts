import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export type DriverPendingInstructions = {
  email: string;
  message: string;
};

const DEFAULT: DriverPendingInstructions = {
  email: '',
  message: 'Enviá el resto de los documentos por correo al email que te indiquemos. Cuando tu solicitud sea aprobada podrás publicar viajes.',
};

export async function GET() {
  try {
    const service = createServiceClient();
    const { data } = await service
      .from('settings')
      .select('value')
      .eq('key', 'driver_pending_instructions')
      .maybeSingle();

    const raw = data?.value as { email?: string; message?: string } | null;
    const result: DriverPendingInstructions = {
      email: typeof raw?.email === 'string' ? raw.email : DEFAULT.email,
      message: typeof raw?.message === 'string' ? raw.message : DEFAULT.message,
    };
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(DEFAULT);
  }
}
