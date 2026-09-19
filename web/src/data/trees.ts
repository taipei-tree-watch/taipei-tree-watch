/**
 * Decode the protected tree reference layer shipped as /trees.json.
 *
 * Same positional format as the report snapshot: the payload names its own
 * columns and every field is read through that list. These trees are not
 * diseased trees; they are the reference layer the reports are read against.
 */
import type { Row } from './columns.ts';
import {
  DecodeError,
  asFiniteNumber,
  asText,
  buildColumnIndex,
  cell,
  isRecord,
} from './columns.ts';

/** Column names the pipeline writes, per the tech spec's trees.json format. */
export const TREE_COLUMNS = [
  'id',
  'species',
  'lat',
  'lng',
  'dbh_m',
  'address',
  'manager',
  'site_type',
  'district',
] as const;

export interface ProtectedTree {
  readonly id: string;
  readonly species: string | null;
  readonly lat: number;
  readonly lng: number;
  /** Diameter at breast height in metres. */
  readonly dbhM: number | null;
  readonly address: string | null;
  readonly manager: string | null;
  readonly siteType: string | null;
  readonly district: string | null;
}

export interface DecodedTrees {
  /** Date the dataset was pulled, used for the open data attribution year. */
  readonly fetchedAt: string | null;
  readonly trees: readonly ProtectedTree[];
  readonly skipped: number;
}

export function decodeTrees(payload: unknown): DecodedTrees {
  if (!isRecord(payload)) {
    throw new DecodeError('trees: payload must be an object');
  }
  const index = buildColumnIndex(payload.columns, TREE_COLUMNS, 'trees');
  const rows = payload.rows;
  if (!Array.isArray(rows)) {
    throw new DecodeError('trees: rows must be an array');
  }

  const trees: ProtectedTree[] = [];
  let skipped = 0;

  for (const entry of rows) {
    if (!Array.isArray(entry)) {
      skipped += 1;
      continue;
    }
    const tree = decodeRow(entry, index);
    if (tree === null) {
      skipped += 1;
      continue;
    }
    trees.push(tree);
  }

  return { fetchedAt: asText(payload.fetched_at), trees, skipped };
}

function decodeRow(row: Row, index: ReadonlyMap<string, number>): ProtectedTree | null {
  const id = asText(cell(row, index, 'id'));
  const lat = asFiniteNumber(cell(row, index, 'lat'));
  const lng = asFiniteNumber(cell(row, index, 'lng'));
  if (id === null || lat === null || lng === null) {
    return null;
  }

  return {
    id,
    species: asText(cell(row, index, 'species')),
    lat,
    lng,
    dbhM: asFiniteNumber(cell(row, index, 'dbh_m')),
    address: asText(cell(row, index, 'address')),
    manager: asText(cell(row, index, 'manager')),
    siteType: asText(cell(row, index, 'site_type')),
    district: asText(cell(row, index, 'district')),
  };
}

/** Attribution year for the open data notice, taken from the dataset itself. */
export function attributionYear(fetchedAt: string | null): string | null {
  if (fetchedAt === null) {
    return null;
  }
  const year = /^([0-9]{4})/.exec(fetchedAt)?.[1];
  return year ?? null;
}
