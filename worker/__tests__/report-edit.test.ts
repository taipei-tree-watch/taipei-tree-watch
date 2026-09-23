import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashEditToken } from '../src/routes/edit-token.ts';
import { TURNSTILE_VERIFY_URL } from '../src/validate/turnstile.ts';

const CLIENT_IP = '203.0.113.7';

interface Created {
  id: string;
  edit_token: string;
}

interface StoredRow {
  lat: number;
  species: string | null;
  causes: string;
  status: number;
  reporter_hash: string | null;
  edit_token_hash: string | null;
  created_at: string;
  updated_at: string | null;
}

function mockTurnstile(success: boolean): { calls: number } {
  const counter = { calls: 0 };
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const request = new Request(input as RequestInfo, init);
    if (!request.url.startsWith(TURNSTILE_VERIFY_URL)) {
      throw new Error(`unexpected outbound request to ${request.url}`);
    }
    counter.calls += 1;
    return Promise.resolve(
      Response.json({ success, hostname: env.TURNSTILE_HOSTNAME ?? '', 'error-codes': [] }),
    );
  });
  return counter;
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

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    turnstile_token: 'widget-token',
    lat: 25.0338,
    lng: 121.5645,
    evidence: 6,
    ...overrides,
  };
}

async function create(overrides: Record<string, unknown> = {}): Promise<Created> {
  const response = await call('POST', '/api/reports', { body: body(overrides) });
  expect(response.status).toBe(201);
  return (await response.json()) as Created;
}

function readRow(id: string): Promise<StoredRow | null> {
  return env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first<StoredRow>();
}

/** A token of the right shape that no report was issued. */
const STRANGER_TOKEN = 'A'.repeat(43);

beforeEach(() => {
  mockTurnstile(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/reports edit token', () => {
  it('returns a 43 character token and stores only its hash', async () => {
    const { id, edit_token: token } = await create();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await readRow(id);
    expect(row?.edit_token_hash).toBe(await hashEditToken(token));
    expect(row?.edit_token_hash).not.toContain(token);
    expect(row?.updated_at).toBeNull();
  });

  it('issues a different token for every report', async () => {
    const first = await create();
    const second = await create();

    expect(first.edit_token).not.toBe(second.edit_token);
  });
});

describe('GET /api/reports/<id>', () => {
  it('returns the current fields to the token holder, uncached', async () => {
    const { id, edit_token: token } = await create({ species: '榕', causes: [1], evidence: 1 });

    const response = await call('GET', `/api/reports/${id}`, { token });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload).toMatchObject({
      id,
      species: '榕',
      causes: [1],
      dispositions: [],
      evidence: 1,
    });
    expect(payload).not.toHaveProperty('reporter_hash');
    expect(payload).not.toHaveProperty('edit_token_hash');
  });

  it('answers 404 without a token, with a wrong token and for an unknown id', async () => {
    const { id, edit_token: token } = await create();

    const responses = await Promise.all([
      call('GET', `/api/reports/${id}`),
      call('GET', `/api/reports/${id}`, { token: STRANGER_TOKEN }),
      call('GET', `/api/reports/${id}`, { token: 'short' }),
      call('GET', '/api/reports/01ARZ3NDEKTSV4RRFFQ69G5FAV', { token }),
      call('GET', '/api/reports/not-a-ulid', { token }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404, 404]);
  });

  it('does not open a report created before edit links existed', async () => {
    await env.DB.prepare(
      `INSERT INTO reports (id, lat, lng, evidence, created_at)
       VALUES ('01ARZ3NDEKTSV4RRFFQ69G5FAW', 25.03, 121.56, 6, '2026-09-01T00:00:00.000Z')`,
    ).run();

    const response = await call('GET', '/api/reports/01ARZ3NDEKTSV4RRFFQ69G5FAW', {
      token: STRANGER_TOKEN,
    });

    expect(response.status).toBe(404);
  });
});

describe('PUT /api/reports/<id>', () => {
  it('replaces the fields, keeps who reported it and when, and stamps updated_at', async () => {
    const { id, edit_token: token } = await create({ species: '榕' });
    const before = await readRow(id);

    const response = await call('PUT', `/api/reports/${id}`, {
      token,
      body: body({ lat: 25.04, species: '樟', causes: [1], evidence: 1 }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { id: string; updated_at: string };
    expect(payload.id).toBe(id);
    const after = await readRow(id);
    expect(after).toMatchObject({
      lat: 25.04,
      species: '樟',
      causes: '[1]',
      status: 0,
      reporter_hash: before?.reporter_hash,
      created_at: before?.created_at,
      updated_at: payload.updated_at,
    });
  });

  it('clears a field the new body leaves out', async () => {
    const { id, edit_token: token } = await create({ species: '榕' });

    await call('PUT', `/api/reports/${id}`, { token, body: body() });

    expect((await readRow(id))?.species).toBeNull();
  });

  it('runs the same field checks as POST', async () => {
    const { id, edit_token: token } = await create();

    const response = await call('PUT', `/api/reports/${id}`, {
      token,
      body: body({ link: 'https://spam.example/' }),
    });

    expect(response.status).toBe(400);
    expect((await readRow(id))?.updated_at).toBeNull();
  });

  it('requires Turnstile', async () => {
    const { id, edit_token: token } = await create();
    vi.restoreAllMocks();
    mockTurnstile(false);

    const response = await call('PUT', `/api/reports/${id}`, { token, body: body() });

    expect(response.status).toBe(403);
  });

  it('answers 404 to a wrong token, skipping Turnstile when it is malformed', async () => {
    const { id } = await create();
    vi.restoreAllMocks();
    const turnstile = mockTurnstile(true);

    const malformed = await call('PUT', `/api/reports/${id}`, { body: body() });
    expect(malformed.status).toBe(404);
    expect(turnstile.calls).toBe(0);

    const wrong = await call('PUT', `/api/reports/${id}`, {
      token: STRANGER_TOKEN,
      body: body({ species: 'x' }),
    });
    expect(wrong.status).toBe(404);
    expect((await readRow(id))?.species).toBeNull();
  });
});

describe('DELETE /api/reports/<id>', () => {
  it('withdraws the report with status 2 and keeps the row', async () => {
    const { id, edit_token: token } = await create();

    const response = await call('DELETE', `/api/reports/${id}`, { token });

    expect(response.status).toBe(200);
    const row = await readRow(id);
    expect(row?.status).toBe(2);
    expect(row?.updated_at).not.toBeNull();
  });

  it('leaves a withdrawn report closed to every edit route', async () => {
    const { id, edit_token: token } = await create();
    await call('DELETE', `/api/reports/${id}`, { token });

    const responses = await Promise.all([
      call('GET', `/api/reports/${id}`, { token }),
      call('PUT', `/api/reports/${id}`, { token, body: body() }),
      call('DELETE', `/api/reports/${id}`, { token }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404]);
    expect((await readRow(id))?.status).toBe(2);
  });

  it('cannot bring back a report the operator hid', async () => {
    const { id, edit_token: token } = await create();
    await env.DB.prepare('UPDATE reports SET status = 1 WHERE id = ?').bind(id).run();

    const response = await call('DELETE', `/api/reports/${id}`, { token });

    expect(response.status).toBe(404);
    expect((await readRow(id))?.status).toBe(1);
  });

  it('rejects another method on the report path', async () => {
    const { id, edit_token: token } = await create();

    const response = await call('PATCH', `/api/reports/${id}`, { token });

    expect(response.status).toBe(405);
  });
});
