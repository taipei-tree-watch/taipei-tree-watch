import { describe, expect, it } from 'vitest';

import type { FetchLike } from '../src/report/submit.ts';
import { REPORTS_URL, submitReport } from '../src/report/submit.ts';

const BODY = { turnstile_token: 'token', lat: 25.033, lng: 121.5654, evidence: 6 };

function respondWith(status: number, payload: unknown): FetchLike {
  return () =>
    Promise.resolve(
      new Response(payload === undefined ? null : JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
}

describe('submitReport', () => {
  it('posts JSON to the reports endpoint', async () => {
    let seenUrl = '';
    let seenInit: RequestInit | null = null;
    const fetchImpl: FetchLike = (url, init) => {
      seenUrl = url;
      seenInit = init;
      return Promise.resolve(new Response(JSON.stringify({ id: 'x' }), { status: 201 }));
    };

    await submitReport(BODY, fetchImpl);

    expect(seenUrl).toBe(REPORTS_URL);
    const init = seenInit as RequestInit | null;
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify(BODY));
  });

  it('returns the new id and edit token on 201', async () => {
    const outcome = await submitReport(
      BODY,
      respondWith(201, { id: '01JABC', edit_token: 'secret' }),
    );
    expect(outcome).toEqual({ kind: 'created', id: '01JABC', editToken: 'secret' });
  });

  it('treats a 201 without an id as a failure worth retrying', async () => {
    expect(await submitReport(BODY, respondWith(201, {}))).toEqual({ kind: 'network' });
  });

  it('treats a 201 without an edit token as a failure worth retrying', async () => {
    expect(await submitReport(BODY, respondWith(201, { id: '01JABC' }))).toEqual({
      kind: 'network',
    });
  });

  it('reports a failed challenge on 403', async () => {
    const outcome = await submitReport(BODY, respondWith(403, { errors: [] }));
    expect(outcome).toEqual({ kind: 'turnstile' });
  });

  it('maps field errors on 400', async () => {
    const outcome = await submitReport(
      BODY,
      respondWith(400, { errors: [{ field: 'link', message: 'bad domain' }] }),
    );
    expect(outcome.kind).toBe('rejected');
    if (outcome.kind === 'rejected') {
      expect(outcome.errors.byField.get('link')).toBe('bad domain');
    }
  });

  it('maps an oversized body on 413', async () => {
    const outcome = await submitReport(
      BODY,
      respondWith(413, { errors: [{ field: 'body', message: 'too big' }] }),
    );
    expect(outcome.kind).toBe('rejected');
  });

  it('is retryable when the request never completes', async () => {
    const outcome = await submitReport(BODY, () => Promise.reject(new Error('offline')));
    expect(outcome).toEqual({ kind: 'network' });
  });

  it('is retryable on a server error', async () => {
    expect(await submitReport(BODY, respondWith(500, { errors: [] }))).toEqual({
      kind: 'network',
    });
  });
});
