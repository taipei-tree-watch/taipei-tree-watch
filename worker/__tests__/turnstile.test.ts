import { afterEach, describe, expect, it, vi } from 'vitest';

import { TURNSTILE_VERIFY_URL, verifyTurnstile } from '../src/validate/turnstile.ts';

const EXPECTED_HOSTNAME = 'taipei-tree-watch.taipeitreewatch.workers.dev';

/** Replacing the global fetch is what intercepts the call to siteverify. */
function mockSiteverify(payload: unknown): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    if (!request.url.startsWith(TURNSTILE_VERIFY_URL)) {
      throw new Error(`unexpected outbound request to ${request.url}`);
    }
    await request.formData();
    return Response.json(payload);
  });
}

function verify(
  payload: unknown,
  expectedHostname: string,
  token = 'widget-token',
): Promise<boolean> {
  mockSiteverify(payload);
  return verifyTurnstile({
    secret: 'test-turnstile-secret',
    token,
    remoteip: '203.0.113.7',
    expectedHostname,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('verifyTurnstile hostname comparison', () => {
  it('accepts a token whose hostname matches', async () => {
    await expect(
      verify({ success: true, hostname: EXPECTED_HOSTNAME }, EXPECTED_HOSTNAME),
    ).resolves.toBe(true);
  });

  it('rejects a token solved on another host', async () => {
    await expect(verify({ success: true, hostname: 'evil.example' }, EXPECTED_HOSTNAME)).resolves.toBe(
      false,
    );
  });

  it('rejects a response with no hostname at all', async () => {
    await expect(verify({ success: true }, EXPECTED_HOSTNAME)).resolves.toBe(false);
  });

  it('skips the comparison when no hostname is configured', async () => {
    await expect(verify({ success: true, hostname: 'example.com' }, '')).resolves.toBe(true);
  });

  it('still rejects an unsuccessful verification when the hostname matches', async () => {
    await expect(
      verify({ success: false, hostname: EXPECTED_HOSTNAME }, EXPECTED_HOSTNAME),
    ).resolves.toBe(false);
  });

  it('never calls siteverify for an empty token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(
      verifyTurnstile({
        secret: 'test-turnstile-secret',
        token: '',
        remoteip: null,
        expectedHostname: '',
      }),
    ).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
