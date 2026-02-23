import { distancePointToPolylineMeters } from '@/lib/geo';

export interface Point {
  lat: number;
  lng: number;
}

export interface RouteSegment {
  points: Point[];
}

/**
 * Validates if a passenger pickup point is within the allowed deviation from base route
 * @param passengerPoint - The pickup point requested by passenger
 * @param baseRoute - The original route polyline (array of points)
 * @param maxDeviationKm - Maximum allowed deviation in kilometers (default: 1 km)
 * @returns Object with isValid boolean and distance in meters
 */
export function validateRouteDeviation(
  passengerPoint: Point,
  baseRoute: Point[],
  maxDeviationKm: number = 1.0
): { isValid: boolean; distanceMeters: number; maxDeviationMeters: number } {
  if (!baseRoute || baseRoute.length < 2) {
    // If no base route, allow it (fallback)
    return { isValid: true, distanceMeters: 0, maxDeviationMeters: maxDeviationKm * 1000 };
  }

  const distanceMeters = distancePointToPolylineMeters(passengerPoint, baseRoute);
  const maxDeviationMeters = maxDeviationKm * 1000;
  const isValid = distanceMeters <= maxDeviationMeters;

  return { isValid, distanceMeters, maxDeviationMeters };
}

/**
 * Get route polyline from OSRM routing service.
 * En la app se usa /api/route/polyline (llamada desde servidor) para evitar CORS y límites del demo público.
 * Esta función sigue disponible para uso en servidor o tests.
 */
export async function getRoutePolyline(
  origin: Point,
  destination: Point,
  waypoints?: Point[]
): Promise<Point[]> {
  try {
    let url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat}`;
    
    // Add waypoints if provided
    if (waypoints && waypoints.length > 0) {
      waypoints.forEach(wp => {
        url += `;${wp.lng},${wp.lat}`;
      });
    }
    
    url += `;${destination.lng},${destination.lat}?overview=full&geometries=geojson`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      // Convert [lng, lat] to [lat, lng]
      return route.geometry.coordinates.map((coord: [number, number]) => ({
        lat: coord[1],
        lng: coord[0],
      }));
    }

    // Fallback: return straight line
    return [origin, destination];
  } catch (error) {
    console.error('Error getting route polyline:', error);
    // Fallback: return straight line
    return [origin, destination];
  }
}
