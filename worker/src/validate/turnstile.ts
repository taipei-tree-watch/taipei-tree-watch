/**
 * Turnstile server-side verification.
 *
 * The widget token is single-use and bound to the client that solved it, so the
 * client IP is sent along and Cloudflare rejects a token replayed from
 * elsewhere. The hostname siteverify reports is the page that served the
 * widget, so comparing it against the expected hostname rejects a token
 * farmed from a copy of the form hosted elsewhere. A network or parsing
 * failure counts as a failed verification: an unverified submission must never
 * reach the database.
 */

export const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface TurnstileResponse {
  success?: boolean;
  hostname?: string;
}

export interface VerifyTurnstileParams {
  /** Secret key from the Turnstile dashboard. */
  readonly secret: string;
  /** Token produced by the widget and posted by the form. */
  readonly token: string;
  /** Value of the CF-Connecting-IP header, if the request carried one. */
  readonly remoteip: string | null;
  /**
   * Hostname the widget is expected to have been served from. An empty string
   * skips the comparison, which is how local development and the test suite
   * run: siteverify answers "example.com" for Cloudflare's test keys.
   */
  readonly expectedHostname: string;
}

export async function verifyTurnstile({
  secret,
  token,
  remoteip,
  expectedHostname,
}: VerifyTurnstileParams): Promise<boolean> {
  if (token === '') {
    return false;
  }

  const body = new URLSearchParams({ secret, response: token });
  if (remoteip !== null && remoteip !== '') {
    body.set('remoteip', remoteip);
  }

  let response: Response;
  try {
    response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch {
    return false;
  }

  if (!response.ok) {
    return false;
  }

  try {
    const result = (await response.json()) as TurnstileResponse;
    if (result.success !== true) {
      return false;
    }
    if (expectedHostname === '') {
      return true;
    }
    return result.hostname === expectedHostname;
  } catch {
    return false;
  }
}
