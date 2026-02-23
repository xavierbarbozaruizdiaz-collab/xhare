import type { Point } from '@/types';

/**
 * Calculate distance between two points using Haversine formula
 * Returns distance in meters
 */
export function distanceMeters(p1: Point, p2: Point): number {
  const R = 6371000; // Earth radius in meters
  const dLat = toRadians(p2.lat - p1.lat);
  const dLon = toRadians(p2.lng - p1.lng);
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(p1.lat)) *
      Math.cos(toRadians(p2.lat)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Calculate the distance from a point to a polyline
 * Returns the minimum distance in meters
 */
export function distancePointToPolylineMeters(
  point: Point,
  polyline: Point[]
): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) return distanceMeters(point, polyline[0]);

  let minDistance = Infinity;

  for (let i = 0; i < polyline.length - 1; i++) {
    const segmentStart = polyline[i];
    const segmentEnd = polyline[i + 1];
    const dist = distanceToSegment(point, segmentStart, segmentEnd);
    minDistance = Math.min(minDistance, dist);
  }

  return minDistance;
}

/**
 * Calculate distance from a point to a line segment
 */
function distanceToSegment(
  point: Point,
  segmentStart: Point,
  segmentEnd: Point
): number {
  const A = point.lat - segmentStart.lat;
  const B = point.lng - segmentStart.lng;
  const C = segmentEnd.lat - segmentStart.lat;
  const D = segmentEnd.lng - segmentStart.lng;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;

  if (lenSq !== 0) param = dot / lenSq;

  let xx: number, yy: number;

  if (param < 0) {
    xx = segmentStart.lat;
    yy = segmentStart.lng;
  } else if (param > 1) {
    xx = segmentEnd.lat;
    yy = segmentEnd.lng;
  } else {
    xx = segmentStart.lat + param * C;
    yy = segmentStart.lng + param * D;
  }

  const dx = point.lat - xx;
  const dy = point.lng - yy;
  return Math.sqrt(dx * dx + dy * dy) * 111000; // Rough conversion to meters
}

/**
 * Find the closest point on a polyline to a given point
 * Returns the closest point and its index in the polyline
 */
export function closestPointOnPolyline(
  point: Point,
  polyline: Point[]
): { point: Point; segmentIndex: number } {
  if (polyline.length === 0) {
    throw new Error('Polyline is empty');
  }
  if (polyline.length === 1) {
    return { point: polyline[0], segmentIndex: 0 };
  }

  let minDistance = Infinity;
  let closestPoint: Point = polyline[0];
  let segmentIndex = 0;

  for (let i = 0; i < polyline.length - 1; i++) {
    const segmentStart = polyline[i];
    const segmentEnd = polyline[i + 1];
    const closest = closestPointOnSegment(point, segmentStart, segmentEnd);
    const dist = distanceMeters(point, closest);

    if (dist < minDistance) {
      minDistance = dist;
      closestPoint = closest;
      segmentIndex = i;
    }
  }

  return { point: closestPoint, segmentIndex };
}

/**
 * Find the closest point on a line segment to a given point
 */
function closestPointOnSegment(
  point: Point,
  segmentStart: Point,
  segmentEnd: Point
): Point {
  const A = point.lat - segmentStart.lat;
  const B = point.lng - segmentStart.lng;
  const C = segmentEnd.lat - segmentStart.lat;
  const D = segmentEnd.lng - segmentStart.lng;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;

  if (lenSq !== 0) param = dot / lenSq;

  if (param < 0) {
    return segmentStart;
  } else if (param > 1) {
    return segmentEnd;
  } else {
    return {
      lat: segmentStart.lat + param * C,
      lng: segmentStart.lng + param * D,
    };
  }
}

/**
 * Check if a point is within a corridor around a polyline
 */
export function isWithinCorridor(
  point: Point,
  polyline: Point[],
  corridorMeters: number
): boolean {
  const distance = distancePointToPolylineMeters(point, polyline);
  return distance <= corridorMeters;
}

/**
 * Get position of a point along a polyline as a fraction from 0 (start) to 1 (end).
 * Uses projection onto the nearest segment. Useful for ordering waypoints along the route.
 */
export function getPositionAlongPolyline(point: Point, polyline: Point[]): number {
  if (!polyline || polyline.length < 2) return 0;
  const n = polyline.length;
  const cumulative: number[] = [0];
  for (let i = 1; i < n; i++) {
    cumulative[i] = cumulative[i - 1] + distanceMeters(polyline[i - 1], polyline[i]);
  }
  const totalLength = cumulative[n - 1];
  if (totalLength === 0) return 0;

  const { segmentIndex } = closestPointOnPolyline(point, polyline);
  const segStart = polyline[segmentIndex];
  const segEnd = polyline[segmentIndex + 1];
  const segLen = distanceMeters(segStart, segEnd);
  const closest = closestPointOnSegment(point, segStart, segEnd);
  const param = segLen > 0 ? distanceMeters(segStart, closest) / segLen : 0;
  const position = cumulative[segmentIndex] + param * segLen;
  return Math.max(0, Math.min(1, position / totalLength));
}

