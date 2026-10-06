/**
 * Snapshot format: the read-only dump of visible reports that the Worker cron
 * writes to KV and the frontend loads in one request.
 *
 * Rows are positional arrays; `SNAPSHOT_COLUMNS` fixes the order and
 * `SnapshotRow` fixes the type of each position. Bump `SNAPSHOT_SCHEMA`
 * whenever the column list or a column type changes.
 *
 * Every field that a correction can change holds the current value: the
 * report row with its active revisions applied.
 */
import type { CauseCode, DispositionCode, EvidenceCode, SourceCode } from './tags.ts';

export const SNAPSHOT_SCHEMA = 2;

/**
 * The columns every schema has carried. A reader requires only these, so a
 * schema 1 snapshot restored from history still loads.
 */
export const SNAPSHOT_BASE_COLUMNS = [
  'id',
  'lat',
  'lng',
  'species',
  'causes',
  'dispositions',
  'evidence',
  'source',
  'note',
  'link',
  'observed_at',
  'protected_tree_id',
  'inventory_tree_id',
  'created_at',
] as const;

export const SNAPSHOT_COLUMNS = [
  ...SNAPSHOT_BASE_COLUMNS,
  'follows_report_id',
  'revision_count',
  'revised_at',
] as const;

export type SnapshotColumn = (typeof SNAPSHOT_COLUMNS)[number];

export type SnapshotRow = readonly [
  id: string,
  lat: number,
  lng: number,
  species: string | null,
  causes: readonly CauseCode[],
  dispositions: readonly DispositionCode[],
  evidence: EvidenceCode,
  source: SourceCode,
  note: string | null,
  link: string | null,
  observed_at: string | null,
  protected_tree_id: string | null,
  inventory_tree_id: string | null,
  created_at: string,
  /** Earlier report of the same tree, which may no longer be visible. */
  follows_report_id: string | null,
  /** Active revisions applied to this row. */
  revision_count: number,
  /** `created_at` of the latest active revision; null when there is none. */
  revised_at: string | null,
];

/** Compile-time guard: the row tuple must have exactly one slot per column. */
export const SNAPSHOT_COLUMN_COUNT: SnapshotRow['length'] = SNAPSHOT_COLUMNS.length;

export interface Snapshot {
  readonly schema: typeof SNAPSHOT_SCHEMA;
  /** ISO 8601 UTC timestamp of when the cron produced this snapshot. */
  readonly generated_at: string;
  readonly columns: typeof SNAPSHOT_COLUMNS;
  readonly rows: readonly SnapshotRow[];
}
