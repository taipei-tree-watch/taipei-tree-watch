/**
 * Corrections: which fields they may change, how revisions apply to a report,
 * and the public revisions file the cron writes next to the snapshot.
 *
 * A correction changes what the tree is, where it stands and what the
 * evidence says, never what the original reporter saw that day. The report
 * row is revision 0; its current value is that row with every active
 * revision applied in id order, later revisions overriding earlier ones.
 */
import type { CauseCode, EvidenceCode } from './tags.ts';
import { EVIDENCE_CODES_WITHOUT_CAUSES } from './tags.ts';

/** `lat` and `lng` only ever change together. */
export const CORRECTABLE_FIELDS = [
  'lat',
  'lng',
  'species',
  'causes',
  'evidence',
  'protected_tree_id',
  'inventory_tree_id',
] as const;

export type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];

/** The part of a report a correction can change, in stored form. */
export interface CorrectableValues {
  readonly lat: number;
  readonly lng: number;
  readonly species: string | null;
  readonly causes: readonly CauseCode[];
  readonly evidence: EvidenceCode;
  readonly protected_tree_id: string | null;
  readonly inventory_tree_id: string | null;
}

/** The fields one revision changed, with their new values. */
export type RevisionChanges = Partial<CorrectableValues>;

/** Furthest a single correction may move a report, in metres. */
export const CORRECTION_MAX_DISTANCE_M = 30;

/** Maximum length of a correction reason after URL stripping, in code points. */
export const REASON_MAX_CHARS = 100;

/** Revision status: in effect. */
export const REVISION_ACTIVE = 0;
/** Revision status: reverted by the operator. */
export const REVISION_REVERTED = 1;
/** Revision status: the reporter's edit link later changed the same field. */
export const REVISION_SUPERSEDED = 2;

const EVIDENCE_WITHOUT_CAUSES: ReadonlySet<number> = new Set(EVIDENCE_CODES_WITHOUT_CAUSES);

function isCorrectableField(key: string): key is CorrectableField {
  return (CORRECTABLE_FIELDS as readonly string[]).includes(key);
}

/** The fields a revision changed, in `CORRECTABLE_FIELDS` order. */
export function changedFields(changes: RevisionChanges): CorrectableField[] {
  return CORRECTABLE_FIELDS.filter((field) => changes[field] !== undefined);
}

/** Causes compare as sets: order and repeats carry no meaning. */
export function sortedCodes<Code extends number>(codes: readonly Code[]): Code[] {
  return [...new Set(codes)].sort((a, b) => a - b);
}

export function sameFieldValue<Field extends CorrectableField>(
  field: Field,
  a: CorrectableValues[Field],
  b: CorrectableValues[Field],
): boolean {
  if (field === 'causes') {
    const left = sortedCodes(a as readonly CauseCode[]);
    const right = sortedCodes(b as readonly CauseCode[]);
    return left.length === right.length && left.every((code, i) => code === right[i]);
  }
  return a === b;
}

export function applyChanges(
  current: CorrectableValues,
  changes: RevisionChanges,
): CorrectableValues {
  const next: Record<string, unknown> = { ...current };
  for (const field of changedFields(changes)) {
    next[field] = changes[field];
  }
  return next as unknown as CorrectableValues;
}

/** The values `changes` replaces, for showing "from what to what". */
export function previousValues(
  current: CorrectableValues,
  changes: RevisionChanges,
): RevisionChanges {
  const previous: Record<string, unknown> = {};
  for (const field of changedFields(changes)) {
    previous[field] = current[field];
  }
  return previous as RevisionChanges;
}

/** Rule 6 of the report checks: no cause without a notice that states one. */
export function breaksCauseRule(values: Pick<CorrectableValues, 'causes' | 'evidence'>): boolean {
  return EVIDENCE_WITHOUT_CAUSES.has(values.evidence) && values.causes.length > 0;
}

/**
 * Read a stored `changes` object back. Unknown keys are dropped rather than
 * trusted, so a hand-edited row cannot put other fields into the snapshot.
 */
export function parseChanges(json: string): RevisionChanges {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (isCorrectableField(key)) {
      changes[key] = value;
    }
  }
  return changes as RevisionChanges;
}

export interface AppliedRevision {
  readonly id: string;
  readonly changes: RevisionChanges;
  readonly previous: RevisionChanges;
}

export interface ReplayResult {
  readonly current: CorrectableValues;
  /** Revisions that took effect, in order. */
  readonly applied: readonly AppliedRevision[];
}

/**
 * Apply `revisions` (already in id order) to the report row. A revision that
 * would leave causes under an evidence source that allows none is skipped:
 * that can only happen once a revision it depended on was reverted, and
 * showing the combination would claim a cause nothing on site stated.
 */
export function replayRevisions(
  original: CorrectableValues,
  revisions: readonly { readonly id: string; readonly changes: RevisionChanges }[],
): ReplayResult {
  let current = original;
  const applied: AppliedRevision[] = [];
  for (const revision of revisions) {
    const next = applyChanges(current, revision.changes);
    if (breaksCauseRule(next)) {
      continue;
    }
    applied.push({
      id: revision.id,
      changes: revision.changes,
      previous: previousValues(current, revision.changes),
    });
    current = next;
  }
  return { current, applied };
}

export const REVISIONS_SCHEMA = 1;

export const REVISION_COLUMNS = [
  'id',
  'report_id',
  'changes',
  'previous',
  'reason',
  'link',
  'created_at',
] as const;

export type RevisionRow = readonly [
  id: string,
  report_id: string,
  changes: RevisionChanges,
  previous: RevisionChanges,
  reason: string,
  link: string | null,
  created_at: string,
];

/** Compile-time guard: the row tuple must have exactly one slot per column. */
export const REVISION_COLUMN_COUNT: RevisionRow['length'] = REVISION_COLUMNS.length;

/**
 * Every revision in effect on a visible report. Reverted and superseded
 * revisions are left out: reverted ones are mostly the vandalism the revert
 * removed.
 */
export interface RevisionsFile {
  readonly schema: typeof REVISIONS_SCHEMA;
  readonly generated_at: string;
  readonly columns: typeof REVISION_COLUMNS;
  readonly rows: readonly RevisionRow[];
}
