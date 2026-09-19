/**
 * Turnstile server-side verification.
 *
 * The widget token is single-use and bound to the client that solved it, so the
 * client IP is sent along and Cloudflare rejects a token replayed from
 * elsewhere. A network or parsing failure counts as a failed verification:
 * an unverified submission must never reach the database.
 */

export const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

interface TurnstileResponse {
  success?: boolean;
}

export interface VerifyTurnstileParams {
  /** Secret key from the Turnstile dashboard. */
  readonly secret: string;
  /** Token produced by the widget and posted by the form. */
  readonly token: string;
  /** Value of the CF-Connecting-IP header, if the request carried one. */
  readonly remoteip: string | null;
}

export async function verifyTurnstile({
  secret,
  token,
  remoteip,
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
    return result.success === true;
  } catch {
    return false;
  }
}
