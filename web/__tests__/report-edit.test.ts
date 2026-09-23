import { describe, expect, it } from 'vitest';

import { readEditableReport, reportUrl, saveReport, withdrawReport } from '../src/report/edit.ts';
import type { FetchLike } from '../src/report/submit.ts';
import { draftFromReport, pendingFromBody } from '../src/ui/report-form.ts';

const LINK = { id: '01JBZ8QF7KJ9M3N4P5R6S7T8V9', token: 'a'.repeat(43) };
const BODY = { turnstile_token: 't', lat: 25.03, lng: 121.56, evidence: 6 };

function respondWith(status: number, payload: unknown, seen: RequestInit[] = []): FetchLike {
  return (_url, init) => {
    seen.push(init);
    return Promise.resolve(new Response(JSON.stringify(payload), { status }));
  };
}

const REPORT = {
  id: LINK.id,
  lat: 25.03,
  lng: 121.56,
  species: '榕',
  causes: [1],
  dispositions: [4],
  evidence: 1,
  note: null,
  link: 'https://www.threads.net/@a/post/1',
  observed_at: '2026-09-10',
  protected_tree_id: null,
  inventory_tree_id: null,
};

describe('readEditableReport', () => {
  it('sends the token as a bearer header, never in the address', async () => {
    const seen: RequestInit[] = [];
    let url = '';
    const fetchImpl: FetchLike = (input, init) => {
      url = input;
      return respondWith(200, REPORT, seen)(input, init);
    };

    const outcome = await readEditableReport(LINK, fetchImpl);

    expect(outcome).toEqual({ kind: 'found', report: REPORT });
    expect(url).toBe(reportUrl(LINK.id));
    expect(url).not.toContain(LINK.token);
    expect((seen[0]?.headers as Record<string, string>).authorization).toBe(
      `Bearer ${LINK.token}`,
    );
  });

  it('tells a dead link from a failed request', async () => {
    expect(await readEditableReport(LINK, respondWith(404, {}))).toEqual({ kind: 'missing' });
    expect(await readEditableReport(LINK, respondWith(500, {}))).toEqual({ kind: 'network' });
    expect(await readEditableReport(LINK, () => Promise.reject(new Error('offline')))).toEqual({
      kind: 'network',
    });
  });
});

describe('saveReport', () => {
  it('PUTs the body and returns the server time of the change', async () => {
    const seen: RequestInit[] = [];
    const outcome = await saveReport(
      LINK,
      BODY,
      respondWith(200, { id: LINK.id, updated_at: '2026-09-23T10:00:00.000Z' }, seen),
    );

    expect(outcome).toEqual({ kind: 'saved', updatedAt: '2026-09-23T10:00:00.000Z' });
    expect(seen[0]?.method).toBe('PUT');
    expect(seen[0]?.body).toBe(JSON.stringify(BODY));
  });

  it('maps 404, 403 and 400 like the create request does', async () => {
    expect((await saveReport(LINK, BODY, respondWith(404, {}))).kind).toBe('missing');
    expect((await saveReport(LINK, BODY, respondWith(403, {}))).kind).toBe('turnstile');
    const rejected = await saveReport(
      LINK,
      BODY,
      respondWith(400, { errors: [{ field: 'link', message: 'bad' }] }),
    );
    expect(rejected.kind).toBe('rejected');
  });
});

describe('withdrawReport', () => {
  it('DELETEs and returns the server time of the withdrawal', async () => {
    const seen: RequestInit[] = [];
    const outcome = await withdrawReport(
      LINK,
      respondWith(200, { id: LINK.id, updated_at: '2026-09-23T10:00:00.000Z' }, seen),
    );

    expect(outcome).toEqual({ kind: 'withdrawn', updatedAt: '2026-09-23T10:00:00.000Z' });
    expect(seen[0]?.method).toBe('DELETE');
  });

  it('reports a dead link', async () => {
    expect(await withdrawReport(LINK, respondWith(404, {}))).toEqual({ kind: 'missing' });
  });
});

describe('form helpers', () => {
  it('turns a stored report back into a draft', () => {
    expect(draftFromReport(REPORT)).toEqual({
      species: '榕',
      causes: [1],
      dispositions: [4],
      evidence: 1,
      note: '',
      link: 'https://www.threads.net/@a/post/1',
      observedAt: '2026-09-10',
      protectedTreeId: '',
      inventoryTreeId: '',
    });
  });

  it('records an edit with its server time and a withdrawal as withdrawn', () => {
    const body = { ...BODY, species: null, causes: [], dispositions: [], note: null, link: null };
    const edited = pendingFromBody(LINK.id, body, 'local', {
      updatedAt: 'server',
      withdrawn: false,
    });
    const created = pendingFromBody(LINK.id, body, 'local', null);

    expect(edited).toMatchObject({ id: LINK.id, updatedAt: 'server', withdrawn: false });
    expect(created).toMatchObject({ updatedAt: null, withdrawn: false, submittedAt: 'local' });
  });
});
