/**
 * Distance helpers for the crosshair picker.
 *
 * The picker compares the crosshair against every protected tree on every
 * camera move, so the search runs a cheap latitude band test before the
 * trigonometry. Nothing here touches the map or the DOM.
 */

import type { LatLng } from '../../shared/geo.ts';
import { haversineMeters } from '../../shared/geo.ts';

export type { LatLng };
export { haversineMeters };

/** Radius a report may associate a protected tree from, per TECH-SPEC 3.1. */
export const PROTECTED_TREE_RADIUS_M = 20;

/**
 * Radius within which an existing report is pointed out to someone filing a
 * new one. The same tree reported by several people stays several reports,
 * so this only informs; it never blocks or merges anything.
 */
export const NEARBY_REPORT_RADIUS_M = 20;

/** Metres per degree of latitude, used only to size the prefilter band. */
const METRES_PER_DEGREE_LAT = 111_320;

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
