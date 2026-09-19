/**
 * Builds the snapshot object that the cron writes to KV.
 *
 * The SELECT column list is generated from `SNAPSHOT_COLUMNS`, so the positional
 * rows always match the shared column order. Rows are read with `raw()` because
 * the snapshot is positional anyway and object rows would allocate one object
 * plus fourteen keys per report.
 */
import type { Snapshot, SnapshotRow } from '../../../shared/snapshot.ts';
import { SNAPSHOT_COLUMNS, SNAPSHOT_SCHEMA } from '../../../shared/snapshot.ts';
import type { CauseCode, DispositionCode, EvidenceCode, SourceCode } from '../../../shared/tags.ts';

/**
 * One report as D1 returns it: same order as `SNAPSHOT_COLUMNS`, with `causes`
 * and `dispositions` still JSON text and no `reporter_hash` or `status`.
 */
type RawReportRow = readonly [
  id: string,
  lat: number,
  lng: number,
  species: string | null,
  causes: string,
  dispositions: string,
  evidence: number,
  source: number,
  note: string | null,
  link: string | null,
  observed_at: string | null,
  protected_tree_id: string | null,
  inventory_tree_id: string | null,
  created_at: string,
];

/** Visible reports only; hidden rows (`status = 1`) never reach the snapshot. */
const SELECT_VISIBLE_REPORTS = `SELECT ${SNAPSHOT_COLUMNS.join(', ')} FROM reports WHERE status = 0 ORDER BY id`;

function parseCodes<Code extends number>(json: string): readonly Code[] {
  return JSON.parse(json) as readonly Code[];
}

function toSnapshotRow(raw: RawReportRow): SnapshotRow {
  const [
    id,
    lat,
    lng,
    species,
    causes,
    dispositions,
    evidence,
    source,
    note,
    link,
    observedAt,
    protectedTreeId,
    inventoryTreeId,
    createdAt,
  ] = raw;

  return [
    id,
    lat,
    lng,
    species,
    parseCodes<CauseCode>(causes),
    parseCodes<DispositionCode>(dispositions),
    evidence as EvidenceCode,
    source as SourceCode,
    note,
    link,
    observedAt,
    protectedTreeId,
    inventoryTreeId,
    createdAt,
  ];
}

/** Reads every visible report and lays it out in the shared snapshot format. */
export async function buildSnapshot(db: D1Database, generatedAt: Date): Promise<Snapshot> {
  const rows = await db.prepare(SELECT_VISIBLE_REPORTS).raw<RawReportRow>();

  return {
    schema: SNAPSHOT_SCHEMA,
    generated_at: generatedAt.toISOString(),
    columns: SNAPSHOT_COLUMNS,
    rows: rows.map(toSnapshotRow),
  };
}

/** Served while KV holds no snapshot yet, so the frontend still gets a valid document. */
export function emptySnapshot(generatedAt: Date): Snapshot {
  return {
    schema: SNAPSHOT_SCHEMA,
    generated_at: generatedAt.toISOString(),
    columns: SNAPSHOT_COLUMNS,
    rows: [],
  };
}
