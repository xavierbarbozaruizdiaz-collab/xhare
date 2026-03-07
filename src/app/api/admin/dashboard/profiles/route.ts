import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { withAdminAuth, logBlockStart, logBlockOk, logBlockError } from '@/lib/admin-auth';

const BLOCK = 'profiles';

export async function GET(request: NextRequest) {
  return withAdminAuth(request, async () => {
    logBlockStart(BLOCK);
    try {
      const service = createServiceClient();
      const { data: profilesByRole } = await service.from('profiles').select('role');
      const pendingDrivers = profilesByRole?.filter((p) => p.role === 'driver_pending').length ?? 0;
      const totalDrivers = profilesByRole?.filter((p) => p.role === 'driver').length ?? 0;
      const totalPassengersProfile = profilesByRole?.filter((p) => p.role === 'passenger').length ?? 0;
      logBlockOk(BLOCK);
      return NextResponse.json({
        pendingDrivers,
        totalDrivers,
        totalPassengersProfile,
      });
    } catch (err) {
      logBlockError(BLOCK, err instanceof Error ? err.message : 'Unknown error', err);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  });
}
