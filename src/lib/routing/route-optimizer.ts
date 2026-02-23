import { distanceMeters } from '@/lib/geo';
import { Point } from './route-validator';
import { getRoutePolyline } from './route-validator';

/**
 * Optimize stop order using Nearest Insertion algorithm
 * This finds the best position to insert a new stop in the existing route
 */
export function findOptimalStopPosition(
  newStop: Point,
  existingStops: Array<{ point: Point; order: number }>
): number {
  if (existingStops.length === 0) return 0;
  if (existingStops.length === 1) return 1;

  // Sort stops by order
  const sortedStops = [...existingStops].sort((a, b) => a.order - b.order);
  
  let minIncrease = Infinity;
  let bestPosition = sortedStops.length;

  // Try inserting at each position
  for (let i = 0; i <= sortedStops.length; i++) {
    let totalIncrease = 0;

    if (i === 0) {
      // Insert at beginning
      const dist = distanceMeters(newStop, sortedStops[0].point);
      totalIncrease = dist;
    } else if (i === sortedStops.length) {
      // Insert at end
      const dist = distanceMeters(sortedStops[sortedStops.length - 1].point, newStop);
      totalIncrease = dist;
    } else {
      // Insert between stops
      const prevStop = sortedStops[i - 1].point;
      const nextStop = sortedStops[i].point;
      const originalDist = distanceMeters(prevStop, nextStop);
      const newDist1 = distanceMeters(prevStop, newStop);
      const newDist2 = distanceMeters(newStop, nextStop);
      totalIncrease = (newDist1 + newDist2) - originalDist;
    }

    if (totalIncrease < minIncrease) {
      minIncrease = totalIncrease;
      bestPosition = i;
    }
  }

  return bestPosition;
}

/**
 * Optimize route with all stops and get updated polyline
 */
export async function optimizeRouteWithStops(
  origin: Point,
  destination: Point,
  intermediateStops: Point[]
): Promise<Point[]> {
  // If no intermediate stops, return simple route
  if (intermediateStops.length === 0) {
    return getRoutePolyline(origin, destination);
  }

  // Get optimized route with all stops
  return getRoutePolyline(origin, destination, intermediateStops);
}
