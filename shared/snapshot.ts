/**
 * Snapshot format: the read-only dump of visible reports that the Worker cron
 * writes to KV and the frontend loads in one request.
 *
 * Rows are positional arrays; `SNAPSHOT_COLUMNS` fixes the order and
 * `SnapshotRow` fixes the type of each position. Bump `SNAPSHOT_SCHEMA`
 * whenever the column list or a column type changes.
 */
import type { CauseCode, DispositionCode, EvidenceCode, SourceCode } from './tags.ts';

export const SNAPSHOT_SCHEMA = 1;

export const SNAPSHOT_COLUMNS = [
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
