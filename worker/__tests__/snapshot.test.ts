import { applyD1Migrations, createScheduledController, reset } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Snapshot } from '../../shared/snapshot.ts';
import { SNAPSHOT_COLUMNS, SNAPSHOT_SCHEMA } from '../../shared/snapshot.ts';
import worker from '../src/index.ts';
import {
  SNAPSHOT_HISTORY_LIMIT,
  SNAPSHOT_INDEX_KEY,
  SNAPSHOT_LATEST_KEY,
  snapshotHistoryKey,
} from '../src/snapshot/store.ts';

const CRON = '*/15 * * * *';
const GENERATED_AT = '2026-09-18T08:15:00.000Z';
const SNAPSHOT_URL = 'https://example.com/api/snapshot';
const CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=900';

const INSERT_REPORT =
  'INSERT INTO reports (id, lat, lng, species, causes, dispositions, evidence, source, note, link, observed_at, protected_tree_id, inventory_tree_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

interface SeedReport {
  id: string;
  lat: number;
  lng: number;
  species: string | null;
  causes: number[];
  dispositions: number[];
  evidence: number;
  source: number;
  note: string | null;
  link: string | null;
  observed_at: string | null;
  protected_tree_id: string | null;
  inventory_tree_id: string | null;
  status: number;
  created_at: string;
}

function report(overrides: Partial<SeedReport> & Pick<SeedReport, 'id'>): SeedReport {
  return {
    lat: 25.03412,
    lng: 121.54321,
    species: null,
    causes: [],
    dispositions: [],
    evidence: 6,
    source: 1,
    note: null,
    link: null,
    observed_at: null,
    protected_tree_id: null,
    inventory_tree_id: null,
    status: 0,
    created_at: '2026-09-18T07:02:11.000Z',
    ...overrides,
  };
}

async function insertReports(reports: readonly SeedReport[]): Promise<void> {
  await env.DB.batch(
    reports.map((row) =>
      env.DB.prepare(INSERT_REPORT).bind(
        row.id,
        row.lat,
        row.lng,
        row.species,
        JSON.stringify(row.causes),
        JSON.stringify(row.dispositions),
        row.evidence,
        row.source,
        row.note,
        row.link,
        row.observed_at,
        row.protected_tree_id,
        row.inventory_tree_id,
        row.status,
        row.created_at,
      ),
    ),
  );
}

async function runCron(generatedAt: string): Promise<void> {
  await worker.scheduled(
    createScheduledController({ cron: CRON, scheduledTime: Date.parse(generatedAt) }),
    env,
  );
}

async function readLatestSnapshot(): Promise<Snapshot> {
  const snapshot = await env.SNAPSHOTS.get<Snapshot>(SNAPSHOT_LATEST_KEY, 'json');
  if (snapshot === null) {
    throw new Error(`${SNAPSHOT_LATEST_KEY} is missing`);
  }
  return snapshot;
}

/** History key of a backfilled version, one per minute of an earlier hour. */
function backfilledKey(minute: number): string {
  return snapshotHistoryKey(`2026-09-18T00:${String(minute).padStart(2, '0')}:00.000Z`);
}

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe('snapshot cron', () => {
  it('publishes visible reports in the shared column order', async () => {
    await insertReports([
      report({
        id: '01A',
        species: 'Ficus microcarpa',
        causes: [1, 21],
        dispositions: [4],
        evidence: 1,
        note: 'notice on the trunk',
        link: 'https://www.threads.net/@example/post/1',
        observed_at: '2026-09-10',
        protected_tree_id: '1525',
      }),
      report({ id: '01B' }),
      report({ id: '01C', status: 1 }),
    ]);

    await runCron(GENERATED_AT);
    const snapshot = await readLatestSnapshot();

    expect(snapshot.schema).toBe(SNAPSHOT_SCHEMA);
    expect(snapshot.generated_at).toBe(GENERATED_AT);
    expect(snapshot.columns).toEqual([...SNAPSHOT_COLUMNS]);
    expect(snapshot.rows.map((row) => row[0])).toEqual(['01A', '01B']);
    expect(snapshot.rows[0]).toHaveLength(SNAPSHOT_COLUMNS.length);
    expect(snapshot.rows[0]).toEqual([
      '01A',
      25.03412,
      121.54321,
      'Ficus microcarpa',
      [1, 21],
      [4],
      1,
      1,
      'notice on the trunk',
      'https://www.threads.net/@example/post/1',
      '2026-09-10',
      '1525',
      null,
      '2026-09-18T07:02:11.000Z',
    ]);
    expect(snapshot.rows[1]).toEqual([
      '01B',
      25.03412,
      121.54321,
      null,
      [],
      [],
      6,
      1,
      null,
      null,
      null,
      null,
      null,
      '2026-09-18T07:02:11.000Z',
    ]);
  });

  it('writes the timestamped version and records it in the index', async () => {
    await insertReports([report({ id: '01A' })]);
    await runCron(GENERATED_AT);

    const latest = await env.SNAPSHOTS.get(SNAPSHOT_LATEST_KEY, 'text');
    const history = await env.SNAPSHOTS.get(snapshotHistoryKey(GENERATED_AT), 'text');

    expect(history).toBe(latest);
    await expect(env.SNAPSHOTS.get<string[]>(SNAPSHOT_INDEX_KEY, 'json')).resolves.toEqual([
      snapshotHistoryKey(GENERATED_AT),
    ]);
  });

  it('keeps 48 versions and deletes the oldest beyond that', async () => {
    const backfilled = Array.from({ length: SNAPSHOT_HISTORY_LIMIT }, (_, minute) =>
      backfilledKey(minute),
    );
    for (const key of backfilled) {
      await env.SNAPSHOTS.put(key, '{}');
    }
    await env.SNAPSHOTS.put(SNAPSHOT_INDEX_KEY, JSON.stringify(backfilled));

    await runCron(GENERATED_AT);

    const index = await env.SNAPSHOTS.get<string[]>(SNAPSHOT_INDEX_KEY, 'json');
    expect(index).toHaveLength(SNAPSHOT_HISTORY_LIMIT);
    expect(index?.at(0)).toBe(backfilledKey(1));
    expect(index?.at(-1)).toBe(snapshotHistoryKey(GENERATED_AT));
    await expect(env.SNAPSHOTS.get(backfilledKey(0), 'text')).resolves.toBeNull();
    await expect(env.SNAPSHOTS.get(backfilledKey(1), 'text')).resolves.toBe('{}');
  });
});

describe('GET /api/snapshot', () => {
  it('serves an empty snapshot that is not cached while KV holds none', async () => {
    const response = await exports.default.fetch(SNAPSHOT_URL);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('etag')).toBeNull();

    const snapshot = (await response.json()) as Snapshot;
    expect(snapshot.schema).toBe(SNAPSHOT_SCHEMA);
    expect(snapshot.columns).toEqual([...SNAPSHOT_COLUMNS]);
    expect(snapshot.rows).toEqual([]);
  });

  it('serves the stored snapshot with caching headers and a generated_at ETag', async () => {
    await insertReports([report({ id: '01A' })]);
    await runCron(GENERATED_AT);

    const response = await exports.default.fetch(SNAPSHOT_URL);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe(CACHE_CONTROL);
    expect(response.headers.get('etag')).toBe(`"${GENERATED_AT}"`);

    const snapshot = (await response.json()) as Snapshot;
    expect(snapshot.rows).toHaveLength(1);
  });

  it('answers 304 without a body when If-None-Match carries the current ETag', async () => {
    await insertReports([report({ id: '01A' })]);
    await runCron(GENERATED_AT);

    const response = await exports.default.fetch(SNAPSHOT_URL, {
      headers: { 'If-None-Match': `"${GENERATED_AT}"` },
    });

    expect(response.status).toBe(304);
    expect(response.headers.get('etag')).toBe(`"${GENERATED_AT}"`);
    await expect(response.text()).resolves.toBe('');
  });

  it('serves the body when If-None-Match carries an older ETag', async () => {
    await insertReports([report({ id: '01A' })]);
    await runCron(GENERATED_AT);

    const response = await exports.default.fetch(SNAPSHOT_URL, {
      headers: { 'If-None-Match': '"2026-09-18T08:00:00.000Z"' },
    });

    expect(response.status).toBe(200);
    const snapshot = (await response.json()) as Snapshot;
    expect(snapshot.generated_at).toBe(GENERATED_AT);
  });

  it('falls back to the document when a hand-restored snapshot has no metadata', async () => {
    const restored: Snapshot = {
      schema: SNAPSHOT_SCHEMA,
      generated_at: '2026-09-17T23:45:00.000Z',
      columns: SNAPSHOT_COLUMNS,
      rows: [],
    };
    await env.SNAPSHOTS.put(SNAPSHOT_LATEST_KEY, JSON.stringify(restored));

    const response = await exports.default.fetch(SNAPSHOT_URL);

    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"2026-09-17T23:45:00.000Z"');
    expect(response.headers.get('cache-control')).toBe(CACHE_CONTROL);
  });
});
