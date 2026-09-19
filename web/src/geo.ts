/**
 * Distance helpers for the crosshair picker.
 *
 * The picker compares the crosshair against every protected tree on every
 * camera move, so the search runs a cheap latitude band test before the
 * trigonometry. Nothing here touches the map or the DOM.
 */

export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/** Radius a report may associate a protected tree from, per TECH-SPEC 3.1. */
export const PROTECTED_TREE_RADIUS_M = 20;

/** IUGG mean Earth radius in metres. */
const EARTH_RADIUS_M = 6_371_008.8;

const DEG_TO_RAD = Math.PI / 180;

/** Metres per degree of latitude, used only to size the prefilter band. */
const METRES_PER_DEGREE_LAT = 111_320;

/** Great-circle distance in metres. */
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

export interface Nearby<T> {
  readonly item: T;
  readonly distanceM: number;
}

/**
 * Closest item within `radiusM` of `center`, or null when none is in range.
 * Ties go to the earlier item, so the result is stable for a given input.
 */
export function nearestWithin<T extends LatLng>(
  items: readonly T[],
  center: LatLng,
  radiusM: number,
): Nearby<T> | null {
  const band = radiusM / METRES_PER_DEGREE_LAT;
  let best: Nearby<T> | null = null;

  for (const item of items) {
    if (Math.abs(item.lat - center.lat) > band) {
      continue;
    }
    const distanceM = haversineMeters(center, item);
    if (distanceM > radiusM) {
      continue;
    }
    if (best === null || distanceM < best.distanceM) {
      best = { item, distanceM };
    }
  }

  return best;
}
