/**
 * Colour rules for the report layer, in both colour schemes.
 *
 * A report is coloured by the most significant cause it carries. Brown root
 * rot outranks everything because the whole map exists to find its clusters;
 * the remaining causes fall into a disease group and a construction group,
 * and a report with no recorded cause gets a neutral colour rather than being
 * hidden. Buckets are keyed by the integer codes in shared/tags.ts, never by
 * label text.
 *
 * Every colour here has a light and a dark value. The dark values are lifted
 * so they stay apart from each other on the dimmed basemap, and the halo that
 * separates a point from the map flips with the scheme. The same values are
 * mirrored as CSS custom properties in style.css for the filter swatches; a
 * test compares the two lists so they cannot drift.
 */
import type { ColorScheme } from '../theme.ts';
import { causes } from '../../../shared/tags.ts';

export type CauseBucket = 'brown-root-rot' | 'other-disease' | 'construction' | 'none';

/**
 * Bucket for every cause code. Codes 1 to 9 describe the tree's own condition
 * or the risk it poses, codes 20 and up are works that removed a healthy tree.
 */
const BUCKET_BY_CAUSE_CODE: ReadonlyMap<number, CauseBucket> = new Map([
  [1, 'brown-root-rot'],
  [2, 'other-disease'],
  [3, 'other-disease'],
  [4, 'other-disease'],
  [5, 'other-disease'],
  [6, 'other-disease'],
  [7, 'other-disease'],
  [8, 'other-disease'],
  [9, 'other-disease'],
  [20, 'construction'],
  [21, 'construction'],
  [22, 'construction'],
  [23, 'construction'],
  [24, 'construction'],
]);

/** Most significant first; the first bucket present on a report wins. */
const BUCKET_PRIORITY: readonly CauseBucket[] = [
  'brown-root-rot',
  'other-disease',
  'construction',
  'none',
];

export interface MapPalette {
  /** Report point fill, by cause bucket. */
  readonly buckets: Readonly<Record<CauseBucket, string>>;
  /** Protected trees: small, muted, clearly not a report. */
  readonly protectedTree: string;
  /** Ring around a report this browser submitted that is not in a snapshot yet. */
  readonly pendingStroke: string;
  /** Outline that lifts a point or cluster off the basemap. */
  readonly halo: string;
  readonly cluster: string;
  /** Warmer cluster bubble, used when a cluster holds brown root rot. */
  readonly clusterAlert: string;
}

const LIGHT_PALETTE: MapPalette = {
  buckets: {
    'brown-root-rot': '#d7263d',
    'other-disease': '#e8871e',
    construction: '#3d7ea6',
    none: '#6b7280',
  },
  protectedTree: '#9aa5b1',
  pendingStroke: '#1f2933',
  halo: '#ffffff',
  cluster: '#4c5c72',
  clusterAlert: '#a8243b',
};

const DARK_PALETTE: MapPalette = {
  buckets: {
    'brown-root-rot': '#ff5d6c',
    'other-disease': '#ffa94d',
    construction: '#5fb3e6',
    none: '#9aa5b4',
  },
  protectedTree: '#66707b',
  pendingStroke: '#f4f6f8',
  halo: '#0d1117',
  cluster: '#7089ab',
  clusterAlert: '#e0566d',
};

export const MAP_PALETTES: Readonly<Record<ColorScheme, MapPalette>> = {
  light: LIGHT_PALETTE,
  dark: DARK_PALETTE,
};

export function paletteFor(scheme: ColorScheme): MapPalette {
  return MAP_PALETTES[scheme];
}

/** Bucket of a single cause code, or null when the code is not mapped. */
export function bucketForCause(code: number): CauseBucket | null {
  return BUCKET_BY_CAUSE_CODE.get(code) ?? null;
}

/** Bucket of a whole report: the highest priority bucket among its causes. */
export function bucketForCauses(codes: readonly number[]): CauseBucket {
  let best: CauseBucket = 'none';
  let bestRank = BUCKET_PRIORITY.indexOf('none');

  for (const code of codes) {
    const bucket = bucketForCause(code);
    if (bucket === null) {
      continue;
    }
    const rank = BUCKET_PRIORITY.indexOf(bucket);
    if (rank >= 0 && rank < bestRank) {
      best = bucket;
      bestRank = rank;
    }
  }
  return best;
}

export function colorForCauses(codes: readonly number[], scheme: ColorScheme): string {
  return paletteFor(scheme).buckets[bucketForCauses(codes)];
}

/**
 * CSS custom property holding a bucket colour. The filter swatches use the
 * property rather than a resolved colour, so they follow the scheme without
 * being repainted from JavaScript.
 */
export function bucketColorVar(bucket: CauseBucket): string {
  return `var(--bucket-${bucket})`;
}

/** Every cause code in shared/tags.ts, for tests and for the legend. */
export const ALL_CAUSE_CODES: readonly number[] = causes.map((cause) => cause.code);
