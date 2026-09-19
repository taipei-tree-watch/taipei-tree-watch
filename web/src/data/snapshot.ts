/**
 * Decode the report snapshot served by GET /api/snapshot.
 *
 * The payload carries its own `columns` array; every field is read through
 * that array rather than a hard coded position, so appending or reordering
 * columns on the producing side does not break the map. Rows that cannot
 * yield a usable point are skipped and counted instead of aborting the load.
 */
import { SNAPSHOT_COLUMNS } from '../../../shared/snapshot.ts';
import type {
  CauseCode,
  DispositionCode,
  EvidenceCode,
  SourceCode,
} from '../../../shared/tags.ts';
import type { Row } from './columns.ts';
import {
  DecodeError,
  asCodes,
  asFiniteNumber,
  asText,
  buildColumnIndex,
  cell,
  isRecord,
} from './columns.ts';

/** One report, as the map and the filter panel work with it. */
export interface ReportRecord {
  readonly id: string;
  readonly lat: number;
  readonly lng: number;
  readonly species: string | null;
  readonly causes: readonly CauseCode[];
  readonly dispositions: readonly DispositionCode[];
  readonly evidence: EvidenceCode | null;
  readonly source: SourceCode | null;
  readonly note: string | null;
  readonly link: string | null;
  readonly observedAt: string | null;
  readonly protectedTreeId: string | null;
  readonly inventoryTreeId: string | null;
  readonly createdAt: string | null;
}

export interface DecodedSnapshot {
  readonly generatedAt: string | null;
  readonly reports: readonly ReportRecord[];
  /** Rows dropped for lacking an id or a usable coordinate. */
  readonly skipped: number;
}

const REQUIRED_COLUMNS = SNAPSHOT_COLUMNS;

export function decodeSnapshot(payload: unknown): DecodedSnapshot {
  if (!isRecord(payload)) {
    throw new DecodeError('snapshot: payload must be an object');
  }
  const index = buildColumnIndex(payload.columns, REQUIRED_COLUMNS, 'snapshot');
  const rows = payload.rows;
  if (!Array.isArray(rows)) {
    throw new DecodeError('snapshot: rows must be an array');
  }

  const reports: ReportRecord[] = [];
  let skipped = 0;

  for (const entry of rows) {
    if (!Array.isArray(entry)) {
      skipped += 1;
      continue;
    }
    const report = decodeRow(entry, index);
    if (report === null) {
      skipped += 1;
      continue;
    }
    reports.push(report);
  }

  return { generatedAt: asText(payload.generated_at), reports, skipped };
}

function decodeRow(row: Row, index: ReadonlyMap<string, number>): ReportRecord | null {
  const id = asText(cell(row, index, 'id'));
  const lat = asFiniteNumber(cell(row, index, 'lat'));
  const lng = asFiniteNumber(cell(row, index, 'lng'));
  if (id === null || lat === null || lng === null) {
    return null;
  }

  return {
    id,
    lat,
    lng,
    species: asText(cell(row, index, 'species')),
    causes: asCodes(cell(row, index, 'causes')) as CauseCode[],
    dispositions: asCodes(cell(row, index, 'dispositions')) as DispositionCode[],
    evidence: asFiniteNumber(cell(row, index, 'evidence')) as EvidenceCode | null,
    source: asFiniteNumber(cell(row, index, 'source')) as SourceCode | null,
    note: asText(cell(row, index, 'note')),
    link: asText(cell(row, index, 'link')),
    observedAt: asText(cell(row, index, 'observed_at')),
    protectedTreeId: asText(cell(row, index, 'protected_tree_id')),
    inventoryTreeId: asText(cell(row, index, 'inventory_tree_id')),
    createdAt: asText(cell(row, index, 'created_at')),
  };
}
