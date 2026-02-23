import type { RideRequest } from '@/types';
import { createServiceClient } from '@/lib/supabase/server';
import { matchRouteFixed } from './routeFixed';
import { matchFree } from './free';

interface MatchingResult {
  success: boolean;
  rideId?: string;
  mode?: string;
  message: string;
}

/**
 * Main matching orchestrator
 * Decides which matching mode to use based on request and settings
 */
export async function matchRequest(
  requestId: string
): Promise<MatchingResult> {
  const supabase = createServiceClient();

  try {
    // Load request
    const { data: request, error } = await supabase
      .from('ride_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (error || !request) {
      return {
        success: false,
        message: 'Request not found',
      };
    }

    // Load settings
    const { data: settingsData } = await supabase
      .from('settings')
      .select('key, value');

    const settings: Record<string, any> = {};
    settingsData?.forEach((s) => {
      settings[s.key] = s.value;
    });

    const routeFixedEnabled = settings.mode_enabled_route_fixed === true || settings.mode_enabled_route_fixed === 'true';
    const freeEnabled = settings.mode_enabled_free === true || settings.mode_enabled_free === 'true';

    // Try route-fixed first if enabled
    if (routeFixedEnabled) {
      const result = await matchRouteFixed(requestId);
      if (result.success) {
        return {
          ...result,
          mode: 'route_fixed',
        };
      }
    }

    // Try free mode if enabled
    if (freeEnabled) {
      const result = await matchFree(requestId);
      if (result.success) {
        return {
          ...result,
          mode: 'free',
        };
      }
    }

    // No match found
    return {
      success: false,
      message: 'No matching mode available for this request',
    };
  } catch (error) {
    console.error('Error in matchRequest:', error);
    return {
      success: false,
      message: 'Internal error during matching',
    };
  }
}

