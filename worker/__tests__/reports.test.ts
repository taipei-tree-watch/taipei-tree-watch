import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TURNSTILE_VERIFY_URL } from '../src/validate/turnstile.ts';

const CLIENT_IP = '203.0.113.7';

interface ReportRow {
  id: string;
  lat: number;
  lng: number;
  species: string | null;
  causes: string;
  dispositions: string;
  evidence: number;
  source: number;
  note: string | null;
  link: string | null;
  observed_at: string | null;
  protected_tree_id: string | null;
  inventory_tree_id: string | null;
  external_ref: string | null;
  status: number;
  reporter_hash: string | null;
  created_at: string;
}

/**
 * The Worker under test shares this isolate, so replacing the global fetch is
 * what intercepts its outbound call to Turnstile. Any other host is a bug.
 */
function mockTurnstile(success: boolean): { calls: FormData[] } {
  const calls: FormData[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    if (!request.url.startsWith(TURNSTILE_VERIFY_URL)) {
      throw new Error(`unexpected outbound request to ${request.url}`);
    }
    // Read the form here: a request body cannot be consumed once the call
    // returns, because it belongs to the Worker's I/O context.
    calls.push(await request.formData());
    return Response.json({ success, 'error-codes': success ? [] : ['invalid-input-response'] });
  });
  return { calls };
}

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return exports.default.fetch(
    new Request('https://example.com/api/reports', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'CF-Connecting-IP': CLIENT_IP,
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

/** Minimal body that passes every check. */
function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    turnstile_token: 'widget-token',
    lat: 25.0338,
    lng: 121.5645,
    evidence: 6,
    ...overrides,
  };
}

async function errorFields(response: Response): Promise<string[]> {
  const body = (await response.json()) as { errors: { field: string; message: string }[] };
  return body.errors.map((error) => error.field);
}

async function readRow(id: string): Promise<ReportRow | null> {
  return env.DB.prepare('SELECT * FROM reports WHERE id = ?').bind(id).first<ReportRow>();
}

beforeEach(() => {
  mockTurnstile(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/reports check 1: content type and body size', () => {
  it('rejects a non-JSON content type', async () => {
    const response = await post(validBody(), { 'content-type': 'text/plain' });

    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['content-type']);
  });

  it('rejects a body larger than 16 KB with 413', async () => {
    const response = await post(validBody({ note: 'a'.repeat(20_000) }));

    expect(response.status).toBe(413);
    await expect(errorFields(response)).resolves.toEqual(['body']);
  });

  it('rejects a body that is not valid JSON', async () => {
    const response = await post('{ not json');

    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['body']);
  });
});

describe('POST /api/reports check 2: Turnstile', () => {
  it('rejects a token Cloudflare does not accept with 403', async () => {
    vi.restoreAllMocks();
    mockTurnstile(false);

    const response = await post(validBody());

    expect(response.status).toBe(403);
    await expect(errorFields(response)).resolves.toEqual(['turnstile_token']);
  });

  it('rejects a missing token without calling Cloudflare', async () => {
    vi.restoreAllMocks();
    const { calls } = mockTurnstile(true);
    const body = validBody();
    delete body.turnstile_token;

    const response = await post(body);

    expect(response.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it('sends the secret, token and client IP to Cloudflare', async () => {
    vi.restoreAllMocks();
    const { calls } = mockTurnstile(true);

    await post(validBody());

    expect(calls).toHaveLength(1);
    const form = calls[0]!;
    expect(form.get('secret')).toBe('test-turnstile-secret');
    expect(form.get('response')).toBe('widget-token');
    expect(form.get('remoteip')).toBe(CLIENT_IP);
  });
});

describe('POST /api/reports check 3: schema', () => {
  it('rejects an unknown field', async () => {
    const response = await post(validBody({ spam_link: 'https://spam.example' }));

    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['spam_link']);
  });

  it('rejects a field of the wrong type', async () => {
    const response = await post(validBody({ lat: '25.0338' }));

    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['lat']);
  });

  it('rejects a missing required field', async () => {
    const body = validBody();
    delete body.evidence;

    const response = await post(body);

    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['evidence']);
  });
});

describe('POST /api/reports check 4: coordinates', () => {
  it('rejects a point outside the bounding box', async () => {
    const response = await post(validBody({ lat: 22.6273, lng: 120.3014 }));

    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['lat']);
  });

  it('rounds accepted coordinates to five decimals', async () => {
    const response = await post(validBody({ lat: 25.033812345, lng: 121.564567891 }));
    const { id } = (await response.json()) as { id: string };

    const row = await readRow(id);
    expect(row?.lat).toBe(25.03381);
    expect(row?.lng).toBe(121.56457);
  });
});

describe('POST /api/reports check 5: tag codes and forced source', () => {
  it('rejects an unknown cause code', async () => {
    const response = await post(validBody({ evidence: 1, causes: [1, 999] }));

    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['causes']);
  });

  it('rejects an unknown disposition code', async () => {
    const response = await post(validBody({ dispositions: [99] }));

    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['dispositions']);
  });

  it('rejects an unknown evidence code', async () => {
    const response = await post(validBody({ evidence: 42 }));

    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['evidence']);
  });

  it('stores source 1 even when the client sends another value', async () => {
    const response = await post(validBody({ source: 2 }));

    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect((await readRow(id))?.source).toBe(1);
  });
});

describe('POST /api/reports check 6: evidence without causes', () => {
  it('rejects causes when the evidence is a sighting only', async () => {
    const response = await post(validBody({ evidence: 6, causes: [1] }));

    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['causes']);
  });

  it('rejects causes when the evidence is a high-risk tag', async () => {
    const response = await post(validBody({ evidence: 5, causes: [1] }));

    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['causes']);
  });

  it('accepts causes when the evidence is a site notice', async () => {
    const response = await post(validBody({ evidence: 1, causes: [1, 3] }));

    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect((await readRow(id))?.causes).toBe('[1,3]');
  });
});

describe('POST /api/reports check 7: species', () => {
  it('rejects a species longer than 50 characters', async () => {
    const response = await post(validBody({ species: '榕'.repeat(51) }));

    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['species']);
  });

  it('trims surrounding whitespace', async () => {
    const response = await post(validBody({ species: '  榕  ' }));
    const { id } = (await response.json()) as { id: string };

    expect((await readRow(id))?.species).toBe('榕');
  });
});

describe('POST /api/reports check 8: note', () => {
  it('rejects a note longer than 300 characters after stripping', async () => {
    const response = await post(validBody({ note: '樹'.repeat(301) }));

    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['note']);
  });

  it('strips every URL from the note', async () => {
    const response = await post(
      validBody({ note: '公告見 https://spam.example/a 與 www.spam.example 兩處' }),
    );
    const { id } = (await response.json()) as { id: string };

    expect((await readRow(id))?.note).toBe('公告見 與 兩處');
  });

  it('accepts a note that only exceeds the limit before stripping', async () => {
    const response = await post(
      validBody({ note: `短說明 https://spam.example/${'a'.repeat(400)}` }),
    );

    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect((await readRow(id))?.note).toBe('短說明');
  });
});

describe('POST /api/reports check 9: link whitelist', () => {
  it('rejects a domain outside the whitelist', async () => {
    const response = await post(validBody({ link: 'https://spam.example/a' }));

    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['link']);
  });

  it('rejects a domain that only ends with a whitelisted string', async () => {
    const response = await post(validBody({ link: 'https://evilthreads.net/a' }));

    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['link']);
  });

  it('rejects http', async () => {
    const response = await post(validBody({ link: 'http://threads.net/a' }));

    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['link']);
  });

  it('accepts a subdomain of a whitelisted domain', async () => {
    const response = await post(validBody({ link: 'https://www.threads.net/@a/post/1' }));

    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    expect((await readRow(id))?.link).toBe('https://www.threads.net/@a/post/1');
  });
});

describe('POST /api/reports check 10: observation date', () => {
  it('rejects a date in the future', async () => {
    const tomorrow = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const response = await post(validBody({ observed_at: tomorrow }));

    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['observed_at']);
  });

  it('rejects a date before 2000-01-01', async () => {
    const response = await post(validBody({ observed_at: '1999-12-31' }));

    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['observed_at']);
  });

  it('rejects a date that does not exist', async () => {
    const response = await post(validBody({ observed_at: '2026-02-30' }));

    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['observed_at']);
  });
});

describe('POST /api/reports check 11: tree identifiers', () => {
  it('rejects a protected tree id that is not digits', async () => {
    const response = await post(validBody({ protected_tree_id: 'A1525' }));

    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['protected_tree_id']);
  });

  it('rejects an inventory tree id in the wrong format', async () => {
    const response = await post(validBody({ inventory_tree_id: 'BT12345' }));

    expect(response.status).toBe(400);
    await expect(errorFields(response)).resolves.toEqual(['inventory_tree_id']);
  });

  it('accepts both identifiers in the documented format', async () => {
    const response = await post(
      validBody({ protected_tree_id: '1525', inventory_tree_id: 'BT0614021096' }),
    );

    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };
    const row = await readRow(id);
    expect(row?.protected_tree_id).toBe('1525');
    expect(row?.inventory_tree_id).toBe('BT0614021096');
  });
});

describe('POST /api/reports check 12: reporter hash', () => {
  it('stores a sha256 hex digest and never the raw IP', async () => {
    const response = await post(validBody());
    const { id } = (await response.json()) as { id: string };

    const row = await readRow(id);
    expect(row?.reporter_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.reporter_hash).not.toContain(CLIENT_IP);
  });

  it('gives the same IP the same hash and a different IP a different one', async () => {
    const first = await post(validBody());
    const second = await post(validBody());
    const other = await post(validBody(), { 'CF-Connecting-IP': '198.51.100.9' });

    const ids = await Promise.all(
      [first, second, other].map(async (response) => ((await response.json()) as { id: string }).id),
    );
    const rows = await Promise.all(ids.map(readRow));

    expect(rows[0]?.reporter_hash).toBe(rows[1]?.reporter_hash);
    expect(rows[0]?.reporter_hash).not.toBe(rows[2]?.reporter_hash);
  });
});

describe('POST /api/reports success', () => {
  it('stores a complete report and returns 201 with its ULID', async () => {
    const response = await post(
      validBody({
        lat: 25.033812345,
        lng: 121.564567891,
        species: '  榕  ',
        causes: [1, 3],
        dispositions: [4],
        evidence: 1,
        source: 3,
        note: '公告記載原因為褐根病 https://spam.example/a',
        link: 'https://www.threads.net/@a/post/1',
        observed_at: '2026-09-10',
        protected_tree_id: '1525',
        inventory_tree_id: 'bt0614021096',
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toContain('application/json');

    const { id } = (await response.json()) as { id: string };
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    const row = await readRow(id);
    expect(row).not.toBeNull();
    expect(row).toMatchObject({
      id,
      lat: 25.03381,
      lng: 121.56457,
      species: '榕',
      causes: '[1,3]',
      dispositions: '[4]',
      evidence: 1,
      source: 1,
      note: '公告記載原因為褐根病',
      link: 'https://www.threads.net/@a/post/1',
      observed_at: '2026-09-10',
      protected_tree_id: '1525',
      inventory_tree_id: 'BT0614021096',
      external_ref: null,
      status: 0,
    });
    expect(row?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('stores empty tag arrays when the client omits them', async () => {
    const response = await post(validBody());
    const { id } = (await response.json()) as { id: string };

    const row = await readRow(id);
    expect(row?.causes).toBe('[]');
    expect(row?.dispositions).toBe('[]');
    expect(row?.species).toBeNull();
    expect(row?.note).toBeNull();
    expect(row?.link).toBeNull();
    expect(row?.observed_at).toBeNull();
  });

  it('gives each report a distinct id', async () => {
    const first = await post(validBody());
    const second = await post(validBody());

    const firstId = ((await first.json()) as { id: string }).id;
    const secondId = ((await second.json()) as { id: string }).id;
    expect(firstId).not.toBe(secondId);
  });
});
