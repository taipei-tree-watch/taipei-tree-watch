/**
 * Colour rules for the report layer.
 *
 * A report is coloured by the most significant cause it carries. Brown root
 * rot outranks everything because the whole map exists to find its clusters;
 * the remaining causes fall into a disease group and a construction group,
 * and a report with no recorded cause gets a neutral colour rather than being
 * hidden. Buckets are keyed by the integer codes in shared/tags.ts, never by
 * label text.
 */
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

export const BUCKET_COLORS: Readonly<Record<CauseBucket, string>> = {
  'brown-root-rot': '#d7263d',
  'other-disease': '#e8871e',
  construction: '#3d7ea6',
  none: '#6b7280',
};

/** Protected trees: small, grey, clearly not a report. */
export const PROTECTED_TREE_COLOR = '#9aa5b1';

/** Ring drawn around a report this browser submitted that is not in a snapshot yet. */
export const PENDING_STROKE_COLOR = '#1f2933';

/** Cluster bubbles, and the warmer variant used when a cluster holds brown root rot. */
export const CLUSTER_COLOR = '#4c5c72';
export const CLUSTER_ALERT_COLOR = '#a8243b';

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

export function colorForCauses(codes: readonly number[]): string {
  return BUCKET_COLORS[bucketForCauses(codes)];
}

/** Every cause code in shared/tags.ts, for tests and for the legend. */
export const ALL_CAUSE_CODES: readonly number[] = causes.map((cause) => cause.code);
