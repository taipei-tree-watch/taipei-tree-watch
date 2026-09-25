/**
 * Find a place for the crosshair from typed or pasted text: a position
 * copied from a map application, or a protected tree number.
 *
 * Like GPS, a lookup only ever moves the camera. The reporter still aims the
 * crosshair at the crown: a copied position marks wherever the map was
 * pressed, and protected tree coordinates carry four decimals (about 11 m).
 * Everything is resolved on the page; nothing is sent anywhere.
 */
import type { Bbox } from '../../../shared/validation.ts';
import { isInsideBbox, isProtectedTreeId } from '../../../shared/validation.ts';
import type { ProtectedTree } from '../data/trees.ts';
import type { Coordinates } from './coordinates.ts';
import { parseCoordinates } from './coordinates.ts';
import { MIN_SUBMIT_ZOOM } from './draft.ts';

/** Both kinds of result are a single point, so land where a report can be sent. */
export const LOOKUP_ZOOM = MIN_SUBMIT_ZOOM;

export type LookupQuery =
  | ({ readonly kind: 'point' } & Coordinates)
  | { readonly kind: 'tree'; readonly id: string };

export type LookupOutcome =
  | ({ readonly kind: 'point' } & Coordinates)
  /** A pasted position outside the accepted range. */
  | { readonly kind: 'pointOutside' }
  | { readonly kind: 'tree'; readonly tree: ProtectedTree }
  | { readonly kind: 'treeMissing'; readonly id: string }
  /** The protected tree layer has not loaded, so no number can be checked. */
  | { readonly kind: 'treesUnavailable' }
  /** Text that is neither a position nor a tree number. */
  | { readonly kind: 'unrecognised' };

/** Full-width digits and hash as typed by a Chinese input method. */
function toHalfWidth(value: string): string {
  return value.replace(/[０-９＃]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0),
  );
}

/**
 * Classify the text. `reference` resolves a short Plus Code and should be
 * the centre of the accepted range. Blank text is null; anything else that
 * is not understood is `unrecognised`, so the reporter hears back.
 */
export function parseLookupQuery(
  raw: string,
  reference: Coordinates,
): LookupQuery | { readonly kind: 'unrecognised' } | null {
  const text = toHalfWidth(raw).trim();
  if (text === '') {
    return null;
  }

  const position = parseCoordinates(text, reference);
  if (position !== null) {
    return { kind: 'point', lat: position.lat, lng: position.lng };
  }

  const bare = text.replace(/^#\s*/, '');
  if (isProtectedTreeId(bare)) {
    // Tree signs and the dataset disagree on zero padding; the dataset has none.
    return { kind: 'tree', id: bare.replace(/^0+(?=[0-9])/, '') };
  }
  return { kind: 'unrecognised' };
}

export interface LookupDeps {
  readonly bbox: Bbox;
  readonly findTree: (id: string) => ProtectedTree | undefined;
  readonly treesLoaded: boolean;
}

export function lookupPlace(
  query: LookupQuery | { readonly kind: 'unrecognised' },
  deps: LookupDeps,
): LookupOutcome {
  if (query.kind === 'unrecognised') {
    return query;
  }
  if (query.kind === 'point') {
    return isInsideBbox(deps.bbox, query.lat, query.lng)
      ? { kind: 'point', lat: query.lat, lng: query.lng }
      : { kind: 'pointOutside' };
  }
  if (!deps.treesLoaded) {
    return { kind: 'treesUnavailable' };
  }
  const tree = deps.findTree(query.id);
  return tree === undefined ? { kind: 'treeMissing', id: query.id } : { kind: 'tree', tree };
}
