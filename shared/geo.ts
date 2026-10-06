/**
 * Great-circle distance, shared by the picker and the correction check so
 * both sides measure the 30 metre limit identically.
 */

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/** IUGG mean Earth radius in metres. */
const EARTH_RADIUS_M = 6_371_008.8;

const DEG_TO_RAD = Math.PI / 180;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const deltaLat = lat2 - lat1;
  const deltaLng = (b.lng - a.lng) * DEG_TO_RAD;
  const chord =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(chord)));
}
