import { describe, expect, it } from 'vitest';

import { SNAPSHOT_COLUMNS } from '../../shared/snapshot.ts';
import { DecodeError } from '../src/data/columns.ts';
import { decodeSnapshot } from '../src/data/snapshot.ts';
import { decodeTrees } from '../src/data/trees.ts';

const FIELDS: Readonly<Record<string, unknown>> = {
  id: '01JTREEWATCH000000000001',
  lat: 25.03412,
  lng: 121.54321,
  species: '\u6995',
  causes: [1],
  dispositions: [3],
  evidence: 1,
  source: 1,
  note: 'note',
  link: 'https://www.threads.net/@a/post/1',
  observed_at: '2026-09-10',
  protected_tree_id: '1525',
  inventory_tree_id: null,
  created_at: '2026-09-18T07:02:11Z',
};

function rowFor(columns: readonly string[]): unknown[] {
  return columns.map((column) => FIELDS[column] ?? null);
}

function payloadFor(columns: readonly string[]): unknown {
  return {
    schema: 1,
    generated_at: '2026-09-18T08:15:00Z',
    columns: [...columns],
    rows: [rowFor(columns)],
  };
}

describe('decodeSnapshot', () => {
  it('maps every column of a row onto the report', () => {
    const decoded = decodeSnapshot(payloadFor(SNAPSHOT_COLUMNS));

    expect(decoded.generatedAt).toBe('2026-09-18T08:15:00Z');
    expect(decoded.skipped).toBe(0);
    expect(decoded.reports).toHaveLength(1);
    expect(decoded.reports[0]).toEqual({
      id: '01JTREEWATCH000000000001',
      lat: 25.03412,
      lng: 121.54321,
      species: '\u6995',
      causes: [1],
      dispositions: [3],
      evidence: 1,
      source: 1,
      note: 'note',
      link: 'https://www.threads.net/@a/post/1',
      observedAt: '2026-09-10',
      protectedTreeId: '1525',
      inventoryTreeId: null,
      createdAt: '2026-09-18T07:02:11Z',
    });
  });

  it('reads fields by column name, so a reordered producer still decodes', () => {
    const reversed = [...SNAPSHOT_COLUMNS].reverse();
    const shuffled = decodeSnapshot(payloadFor(reversed));
    const canonical = decodeSnapshot(payloadFor(SNAPSHOT_COLUMNS));

    expect(shuffled.reports).toEqual(canonical.reports);
  });

  it('tolerates a column appended after the known ones', () => {
    const extended = [...SNAPSHOT_COLUMNS, 'future_column'];
    const decoded = decodeSnapshot({
      columns: extended,
      rows: [[...rowFor(SNAPSHOT_COLUMNS), 'ignored']],
    });

    expect(decoded.reports[0]?.id).toBe('01JTREEWATCH000000000001');
  });

  it('skips rows without an id or a usable coordinate, keeping the rest', () => {
    const columns = [...SNAPSHOT_COLUMNS];
    const broken = rowFor(columns);
    broken[columns.indexOf('lat')] = null;

    const decoded = decodeSnapshot({
      columns,
      rows: [broken, rowFor(columns)],
    });

    expect(decoded.reports).toHaveLength(1);
    expect(decoded.skipped).toBe(1);
  });

  it('rejects a payload that is missing a required column', () => {
    const columns = SNAPSHOT_COLUMNS.filter((column) => column !== 'lng');

    expect(() => decodeSnapshot({ columns, rows: [] })).toThrow(DecodeError);
  });
});

describe('decodeTrees', () => {
  const TREE_ROW = ['768', '\u6995', 25.0232, 121.5056, 1.13, 'address', 'manager', 'park', 'district'];

  it('decodes the protected tree columns and the fetch date', () => {
    const decoded = decodeTrees({
      schema: 1,
      fetched_at: '2026-09-19',
      columns: ['id', 'species', 'lat', 'lng', 'dbh_m', 'address', 'manager', 'site_type', 'district'],
      rows: [TREE_ROW],
    });

    expect(decoded.fetchedAt).toBe('2026-09-19');
    expect(decoded.trees[0]).toEqual({
      id: '768',
      species: '\u6995',
      lat: 25.0232,
      lng: 121.5056,
      dbhM: 1.13,
      address: 'address',
      manager: 'manager',
      siteType: 'park',
      district: 'district',
    });
  });

  it('reads protected trees by column name as well', () => {
    const columns = ['district', 'site_type', 'manager', 'address', 'dbh_m', 'lng', 'lat', 'species', 'id'];
    const decoded = decodeTrees({ columns, rows: [[...TREE_ROW].reverse()] });

    expect(decoded.trees[0]?.id).toBe('768');
    expect(decoded.trees[0]?.lat).toBe(25.0232);
  });
});
