import type { RideRequest } from '@/types';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * Free mode matching (stub for Phase 2)
 * This will be implemented in the future
 */
export async function matchFree(requestId: string): Promise<{
  success: boolean;
  rideId?: string;
  message: string;
}> {
  // TODO: Implement free mode matching in Phase 2
  return {
    success: false,
    message: 'Free mode matching not yet implemented',
  };
}

