import { applyD1Migrations, createScheduledController, reset } from 'cloudflare:test';
import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RevisionsFile } from '../../shared/revisions.ts';
import { REVISION_COLUMNS, REVISIONS_SCHEMA } from '../../shared/revisions.ts';
import type { Snapshot } from '../../shared/snapshot.ts';
import { SNAPSHOT_COLUMNS } from '../../shared/snapshot.ts';
import worker from '../src/index.ts';
import { REVISIONS_LATEST_KEY, SNAPSHOT_LATEST_KEY } from '../src/snapshot/store.ts';
import { TURNSTILE_VERIFY_URL } from '../src/validate/turnstile.ts';

const CLIENT_IP = '203.0.113.7';
const CRON = '*/15 * * * *';
const GENERATED_AT = '2026-09-18T08:15:00.000Z';

/** A point well inside the accepted area; 0.0001 degrees of latitude is about 11 m. */
const LAT = 25.0338;
const LNG = 121.5645;

interface Created {
  id: string;
  edit_token: string;
}

interface RevisionRecord {
  id: string;
  report_id: string;
  base_revision_id: string | null;
  changes: string;
  reason: string;
  link: string | null;
  status: number;
  reporter_hash: string;
}

function mockTurnstile(success: boolean): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const request = new Request(input as RequestInfo, init);
    if (!request.url.startsWith(TURNSTILE_VERIFY_URL)) {
      throw new Error(`unexpected outbound request to ${request.url}`);
    }
    return Promise.resolve(
      Response.json({ success, hostname: env.TURNSTILE_HOSTNAME ?? '', 'error-codes': [] }),
    );
  });
}

function call(
  method: string,
  path: string,
  options: { token?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'CF-Connecting-IP': CLIENT_IP };
  if (options.token !== undefined) {
    headers.authorization = `Bearer ${options.token}`;
  }
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  return exports.default.fetch(
    new Request(`https://example.com${path}`, {
      method,
      headers,
      body: options.body === undefined ? null : JSON.stringify(options.body),
    }),
  );
}

function reportBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { turnstile_token: 'widget-token', lat: LAT, lng: LNG, evidence: 6, ...overrides };
}

async function create(overrides: Record<string, unknown> = {}): Promise<Created> {
  const response = await call('POST', '/api/reports', { body: reportBody(overrides) });
  expect(response.status).toBe(201);
  return (await response.json()) as Created;
}

function correction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    turnstile_token: 'widget-token',
    base_revision_id: null,
    changes: { species: '樟' },
    reason: '樹牌寫的是樟樹',
    ...overrides,
  };
}

function correct(id: string, body: Record<string, unknown>): Promise<Response> {
  return call('POST', `/api/reports/${id}/revisions`, { body });
}

async function correctOk(id: string, body: Record<string, unknown>): Promise<string> {
  const response = await correct(id, body);
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function errorFields(response: Response): Promise<string[]> {
  const body = (await response.json()) as { errors: { field: string }[] };
  return body.errors.map((error) => error.field);
}

function readRevisions(reportId: string): Promise<RevisionRecord[]> {
  return env.DB.prepare('SELECT * FROM report_revisions WHERE report_id = ? ORDER BY id')
    .bind(reportId)
    .all<RevisionRecord>()
    .then((result) => result.results);
}

async function runCron(): Promise<{ snapshot: Snapshot; revisions: RevisionsFile }> {
  await worker.scheduled(
    createScheduledController({ cron: CRON, scheduledTime: Date.parse(GENERATED_AT) }),
    env,
  );
  const snapshot = await env.SNAPSHOTS.get<Snapshot>(SNAPSHOT_LATEST_KEY, 'json');
  const revisions = await env.SNAPSHOTS.get<RevisionsFile>(REVISIONS_LATEST_KEY, 'json');
  if (snapshot === null || revisions === null) {
    throw new Error('cron did not publish');
  }
  return { snapshot, revisions };
}

function column(snapshot: Snapshot, id: string, name: (typeof SNAPSHOT_COLUMNS)[number]): unknown {
  const row = snapshot.rows.find((entry) => entry[0] === id);
  return row?.[SNAPSHOT_COLUMNS.indexOf(name)];
}

beforeEach(async () => {
  await reset();
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  mockTurnstile(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/reports follows_report_id (check 13)', () => {
  it('stores the report it follows', async () => {
    const first = await create();
    const second = await create({ follows_report_id: first.id });

    const row = await env.DB.prepare('SELECT follows_report_id FROM reports WHERE id = ?')
      .bind(second.id)
      .first<{ follows_report_id: string | null }>();
    expect(row?.follows_report_id).toBe(first.id);
  });

  it('rejects an id that is not a ULID', async () => {
    const response = await call('POST', '/api/reports', {
      body: reportBody({ follows_report_id: 'not-a-ulid' }),
    });
    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['follows_report_id']);
  });

  it('rejects a report that does not exist or is hidden', async () => {
    const hidden = await create();
    await env.DB.prepare('UPDATE reports SET status = 1 WHERE id = ?').bind(hidden.id).run();

    for (const target of ['01JBZ8QF7KJ9M3N4P5R6S7T8V9', hidden.id]) {
      const response = await call('POST', '/api/reports', {
        body: reportBody({ follows_report_id: target }),
      });
      expect(response.status).toBe(400);
      await expect(errorFields(response)).resolves.toEqual(['follows_report_id']);
    }
  });

  it('is not accepted by an edit, which keeps the original link', async () => {
    const first = await create();
    const second = await create({ follows_report_id: first.id });

    const response = await call('PUT', `/api/reports/${second.id}`, {
      token: second.edit_token,
      body: reportBody({ follows_report_id: null }),
    });
    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['follows_report_id']);
  });

  it('is published in the snapshot', async () => {
    const first = await create();
    const second = await create({ follows_report_id: first.id });

    const { snapshot } = await runCron();
    expect(column(snapshot, second.id, 'follows_report_id')).toBe(first.id);
    expect(column(snapshot, first.id, 'follows_report_id')).toBeNull();
  });
});

describe('POST /api/reports/<id>/revisions', () => {
  it('stores the correction with its sender and answers 201', async () => {
    const report = await create({ species: '榕' });
    const id = await correctOk(report.id, correction({ link: 'https://www.threads.net/@a/post/1' }));

    const [stored] = await readRevisions(report.id);
    expect(stored?.id).toBe(id);
    expect(JSON.parse(stored?.changes ?? '')).toEqual({ species: '樟' });
    expect(stored?.reason).toBe('樹牌寫的是樟樹');
    expect(stored?.link).toBe('https://www.threads.net/@a/post/1');
    expect(stored?.base_revision_id).toBeNull();
    expect(stored?.status).toBe(0);
    expect(stored?.reporter_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never rewrites the report row', async () => {
    const report = await create({ species: '榕' });
    await correctOk(report.id, correction());

    const row = await env.DB.prepare('SELECT species FROM reports WHERE id = ?')
      .bind(report.id)
      .first<{ species: string }>();
    expect(row?.species).toBe('榕');
  });

  it('rule 1: rejects a failed Turnstile with 403', async () => {
    const report = await create();
    vi.restoreAllMocks();
    mockTurnstile(false);

    const response = await correct(report.id, correction());
    expect(response.status).toBe(403);
    await expect(readRevisions(report.id)).resolves.toEqual([]);
  });

  it('rule 1: rejects unknown fields, also inside changes', async () => {
    const report = await create();
    const top = await correct(report.id, correction({ extra: 1 }));
    expect(top.status).toBe(400);
    await expect(errorFields(top)).resolves.toEqual(['extra']);

    const inner = await correct(report.id, correction({ changes: { note: 'x' } }));
    expect(inner.status).toBe(400);
    await expect(errorFields(inner)).resolves.toEqual(['changes.note']);
  });

  it('rule 2: answers 404 for an unknown, hidden or official report', async () => {
    const hidden = await create();
    await env.DB.prepare('UPDATE reports SET status = 2 WHERE id = ?').bind(hidden.id).run();
    const official = await create();
    await env.DB.prepare('UPDATE reports SET source = 2 WHERE id = ?').bind(official.id).run();

    for (const id of ['01JBZ8QF7KJ9M3N4P5R6S7T8V9', 'not-a-ulid', hidden.id, official.id]) {
      const response = await correct(id, correction());
      expect(response.status).toBe(404);
    }
  });

  it('rule 3: needs at least one field, and coordinates in pairs', async () => {
    const report = await create();
    const empty = await correct(report.id, correction({ changes: {} }));
    expect(empty.status).toBe(400);
    await expect(errorFields(empty)).resolves.toEqual(['changes']);

    const half = await correct(report.id, correction({ changes: { lat: LAT + 0.0001 } }));
    expect(half.status).toBe(400);
    await expect(errorFields(half)).resolves.toEqual(['changes']);
  });

  it('rule 3: checks each value by the report rule for that field', async () => {
    const report = await create();
    const cases: [Record<string, unknown>, string][] = [
      [{ lat: 30, lng: 121 }, 'changes.lat'],
      [{ causes: [999] }, 'changes.causes'],
      [{ evidence: 99 }, 'changes.evidence'],
      [{ species: 'x'.repeat(51) }, 'changes.species'],
      [{ protected_tree_id: 'A1' }, 'changes.protected_tree_id'],
      [{ inventory_tree_id: '123' }, 'changes.inventory_tree_id'],
    ];
    for (const [changes, field] of cases) {
      const response = await correct(report.id, correction({ changes }));
      expect(response.status).toBe(400);
      await expect(errorFields(response)).resolves.toEqual([field]);
    }
  });

  it('rule 3: stores values in their normalised form', async () => {
    const report = await create({ evidence: 1 });
    await correctOk(
      report.id,
      correction({
        changes: { causes: [21, 1, 21], inventory_tree_id: 'bt0614021096', species: '  樟 ' },
      }),
    );
    const [stored] = await readRevisions(report.id);
    expect(JSON.parse(stored?.changes ?? '')).toEqual({
      causes: [1, 21],
      species: '樟',
      inventory_tree_id: 'BT0614021096',
    });
  });

  it('rule 4: checks causes against the corrected evidence', async () => {
    const report = await create({ evidence: 1, causes: [1] });
    const response = await correct(report.id, correction({ changes: { evidence: 6 } }));
    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['changes.causes']);

    await correctOk(report.id, correction({ changes: { evidence: 6, causes: [] } }));
  });

  it('rule 5: moves the point 30 m at most from where it is now', async () => {
    const report = await create();
    const far = await correct(
      report.id,
      correction({ changes: { lat: LAT + 0.0003, lng: LNG } }),
    );
    expect(far.status).toBe(400);
    await expect(errorFields(far)).resolves.toEqual(['changes.lat']);

    const first = await correctOk(
      report.id,
      correction({ changes: { lat: LAT + 0.0002, lng: LNG } }),
    );
    // Measured from the corrected point, not the original one.
    await correctOk(
      report.id,
      correction({ base_revision_id: first, changes: { lat: LAT + 0.0004, lng: LNG } }),
    );
  });

  it('rule 6: rejects a field that keeps its current value', async () => {
    const report = await create({ species: '樟', evidence: 1, causes: [21, 1] });
    const same = await correct(report.id, correction({ changes: { species: '樟' } }));
    expect(same.status).toBe(400);
    await expect(errorFields(same)).resolves.toEqual(['changes.species']);

    const reordered = await correct(report.id, correction({ changes: { causes: [1, 21] } }));
    expect(reordered.status).toBe(400);
    await expect(errorFields(reordered)).resolves.toEqual(['changes.causes']);

    const unmoved = await correct(report.id, correction({ changes: { lat: LAT, lng: LNG } }));
    expect(unmoved.status).toBe(400);
    await expect(errorFields(unmoved)).resolves.toEqual(['changes.lat']);
  });

  it('rule 7: needs a reason and allows only whitelisted links', async () => {
    const report = await create();
    const cases: [Record<string, unknown>, string][] = [
      [{ reason: '   ' }, 'reason'],
      [{ reason: 'https://example.com/only-a-link' }, 'reason'],
      [{ reason: '字'.repeat(101) }, 'reason'],
      [{ link: 'https://example.com/x' }, 'link'],
    ];
    for (const [overrides, field] of cases) {
      const response = await correct(report.id, correction(overrides));
      expect(response.status).toBe(400);
      await expect(errorFields(response)).resolves.toEqual([field]);
    }
    await correctOk(report.id, correction({ reason: '字'.repeat(100) }));
  });

  it('rule 8: answers 409 unless the base is the latest active revision', async () => {
    const report = await create();
    const first = await correctOk(report.id, correction());

    const stale = await correct(report.id, correction({ changes: { species: '楓' } }));
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as { latest_revision_id: string | null };
    expect(body.latest_revision_id).toBe(first);

    await correctOk(report.id, correction({ base_revision_id: first, changes: { species: '楓' } }));

    // Once the first is reverted, the second is the latest again.
    const [, second] = await readRevisions(report.id);
    await env.DB.prepare('UPDATE report_revisions SET status = 1 WHERE id = ?')
      .bind(first)
      .run();
    await correctOk(
      report.id,
      correction({ base_revision_id: second?.id ?? null, changes: { species: '榕' } }),
    );
  });
});

describe('cron applies revisions', () => {
  it('publishes the corrected value and the revision count', async () => {
    const report = await create({ species: '榕' });
    const first = await correctOk(report.id, correction());
    await correctOk(
      report.id,
      correction({ base_revision_id: first, changes: { lat: LAT + 0.0001, lng: LNG } }),
    );

    const { snapshot, revisions } = await runCron();
    expect(column(snapshot, report.id, 'species')).toBe('樟');
    expect(column(snapshot, report.id, 'lat')).toBe(LAT + 0.0001);
    expect(column(snapshot, report.id, 'revision_count')).toBe(2);
    expect(column(snapshot, report.id, 'revised_at')).toBe(revisions.rows.at(-1)?.[6]);

    expect(revisions.schema).toBe(REVISIONS_SCHEMA);
    expect(revisions.columns).toEqual([...REVISION_COLUMNS]);
    expect(revisions.rows.map((row) => [row[0], row[1], row[2], row[3]])).toEqual([
      [first, report.id, { species: '樟' }, { species: '榕' }],
      [expect.any(String), report.id, { lat: LAT + 0.0001, lng: LNG }, { lat: LAT, lng: LNG }],
    ]);
  });

  it('drops a reverted revision; later ones still apply', async () => {
    const report = await create({ species: '榕' });
    const first = await correctOk(report.id, correction({ changes: { species: '樟' } }));
    const second = await correctOk(
      report.id,
      correction({ base_revision_id: first, changes: { species: '楓' } }),
    );

    await env.DB.prepare('UPDATE report_revisions SET status = 1 WHERE id = ?')
      .bind(second)
      .run();
    let published = await runCron();
    expect(column(published.snapshot, report.id, 'species')).toBe('樟');
    expect(published.revisions.rows.map((row) => row[0])).toEqual([first]);

    await env.DB.prepare('UPDATE report_revisions SET status = CASE id WHEN ? THEN 1 ELSE 0 END')
      .bind(first)
      .run();
    published = await runCron();
    expect(column(published.snapshot, report.id, 'species')).toBe('楓');
    // Previous is computed as if the reverted revision never existed.
    expect(published.revisions.rows.map((row) => row[3])).toEqual([{ species: '榕' }]);
  });

  it('reverts every revision of one sender at once', async () => {
    const report = await create({ species: '榕' });
    const first = await correctOk(report.id, correction());
    await correctOk(report.id, correction({ base_revision_id: first, changes: { species: '楓' } }));

    const reverted = await env.DB.prepare(
      'UPDATE report_revisions SET status = 1 WHERE reporter_hash = (SELECT reporter_hash FROM report_revisions WHERE id = ?)',
    )
      .bind(first)
      .run();
    expect(reverted.meta.changes).toBe(2);

    const { snapshot, revisions } = await runCron();
    expect(column(snapshot, report.id, 'species')).toBe('榕');
    expect(column(snapshot, report.id, 'revision_count')).toBe(0);
    expect(column(snapshot, report.id, 'revised_at')).toBeNull();
    expect(revisions.rows).toEqual([]);
  });

  it('skips a revision whose causes no longer fit the evidence', async () => {
    const report = await create({ evidence: 6 });
    const first = await correctOk(report.id, correction({ changes: { evidence: 1 } }));
    const second = await correctOk(
      report.id,
      correction({ base_revision_id: first, changes: { causes: [1] } }),
    );
    await env.DB.prepare('UPDATE report_revisions SET status = 1 WHERE id = ?').bind(first).run();

    const { snapshot, revisions } = await runCron();
    expect(column(snapshot, report.id, 'causes')).toEqual([]);
    expect(revisions.rows.map((row) => row[0])).not.toContain(second);

    // The skipped revision is not the base a new correction has to name.
    await correctOk(report.id, correction({ base_revision_id: null }));
  });

  it('leaves out revisions of reports that are no longer visible', async () => {
    const report = await create();
    await correctOk(report.id, correction());
    await env.DB.prepare('UPDATE reports SET status = 1 WHERE id = ?').bind(report.id).run();

    const { revisions } = await runCron();
    expect(revisions.rows).toEqual([]);
  });
});

describe('an edit link change supersedes earlier corrections of the field', () => {
  it('marks overlapping revisions superseded and keeps the rest', async () => {
    const report = await create({ species: '榕' });
    const species = await correctOk(report.id, correction({ changes: { species: '樟' } }));
    const tree = await correctOk(
      report.id,
      correction({ base_revision_id: species, changes: { protected_tree_id: '1525' } }),
    );

    const response = await call('PUT', `/api/reports/${report.id}`, {
      token: report.edit_token,
      body: reportBody({ species: '楓' }),
    });
    expect(response.status).toBe(200);

    const stored = await readRevisions(report.id);
    expect(stored.map((row) => [row.id, row.status])).toEqual([
      [species, 2],
      [tree, 0],
    ]);

    const { snapshot } = await runCron();
    expect(column(snapshot, report.id, 'species')).toBe('楓');
    expect(column(snapshot, report.id, 'protected_tree_id')).toBe('1525');
  });

  it('leaves corrections alone when the edit keeps those fields', async () => {
    const report = await create({ species: '榕' });
    await correctOk(report.id, correction());

    const response = await call('PUT', `/api/reports/${report.id}`, {
      token: report.edit_token,
      body: reportBody({ species: '榕', note: '補充說明' }),
    });
    expect(response.status).toBe(200);

    const [stored] = await readRevisions(report.id);
    expect(stored?.status).toBe(0);
  });

  it('a correction after the edit still applies', async () => {
    const report = await create({ species: '榕' });
    await call('PUT', `/api/reports/${report.id}`, {
      token: report.edit_token,
      body: reportBody({ species: '楓' }),
    });
    await correctOk(report.id, correction({ changes: { species: '樟' } }));

    const { snapshot } = await runCron();
    expect(column(snapshot, report.id, 'species')).toBe('樟');
  });
});

describe('GET /api/revisions', () => {
  it('serves an empty file that is not cached while KV holds none', async () => {
    const response = await call('GET', '/api/revisions');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const file = (await response.json()) as RevisionsFile;
    expect(file.rows).toEqual([]);
    expect(file.columns).toEqual([...REVISION_COLUMNS]);
  });

  it('serves the published file with the snapshot caching rules', async () => {
    const report = await create();
    await correctOk(report.id, correction());
    await runCron();

    const response = await call('GET', '/api/revisions');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=300, stale-while-revalidate=900',
    );
    expect(response.headers.get('etag')).toBe(`"${GENERATED_AT}"`);
    const file = (await response.json()) as RevisionsFile;
    expect(file.rows).toHaveLength(1);
  });
});
