import { latLngToCell } from 'h3-js';

/** Resolución H3 acordada (~4–5 km de escala de celda según latitud). */
export const TRIP_REQUEST_SUPER_HEX_RES = 6;

export function tripRequestSuperHex(lat: number, lng: number): string {
  return latLngToCell(lat, lng, TRIP_REQUEST_SUPER_HEX_RES);
}

export function tripRequestSuperHexPair(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): { origin_super_hex: string; dest_super_hex: string } {
  return {
    origin_super_hex: tripRequestSuperHex(originLat, originLng),
    dest_super_hex: tripRequestSuperHex(destLat, destLng),
  };
}
