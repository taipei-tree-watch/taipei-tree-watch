/**
 * Which feature a tap selects when more than one sits under the finger.
 *
 * The points are a few pixels across, too small to hit reliably on a phone,
 * so the map is queried over a box around the tap rather than the single
 * pixel under it. That box routinely covers several features at once, and
 * the layers genuinely overlap: a report is often filed against the very
 * protected tree it is drawn on top of.
 *
 * Priority runs from the most specific answer to the least. A report is what
 * the reporter asked about, a cluster only says where to zoom next, and the
 * protected tree layer is reference material sitting behind both.
 */

/** Half the side of the square queried around the tap, in screen pixels. */
export const TAP_RADIUS_PX = 12;

export interface HitCandidate {
  readonly layerId: string;
}

/**
 * The first candidate whose layer comes earliest in `priority`. Candidates on
 * layers the caller did not rank are ignored, so an unrelated layer added to
 * the query can never win.
 */
export function pickHit<T extends HitCandidate>(
  candidates: readonly T[],
  priority: readonly string[],
): T | null {
  for (const layerId of priority) {
    const hit = candidates.find((candidate) => candidate.layerId === layerId);
    if (hit !== undefined) {
      return hit;
    }
  }
  return null;
}
