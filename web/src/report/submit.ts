/**
 * The single write request the site makes.
 *
 * Outcomes are values rather than exceptions so the form can keep what the
 * reporter typed in every failing case: a rejected field set is re-editable,
 * a failed challenge only needs a new token, and a network failure needs
 * nothing but another attempt.
 */
import type { MappedErrors } from './errors.ts';
import { mapApiErrors } from './errors.ts';

export const REPORTS_URL = '/api/reports';

export type SubmitOutcome =
  | { readonly kind: 'created'; readonly id: string; readonly editToken: string }
  | { readonly kind: 'rejected'; readonly errors: MappedErrors }
  /** The challenge was not accepted; the widget has to be solved again. */
  | { readonly kind: 'turnstile' }
  /** Nothing reached the server, or the server failed. Retrying may work. */
  | { readonly kind: 'network' };

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function submitReport(
  body: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<SubmitOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(REPORTS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error('report request failed', error);
    return { kind: 'network' };
  }

  if (response.status === 201) {
    const payload = await readJson(response);
    const fields =
      typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    const id = fields.id;
    const editToken = fields.edit_token;
    if (typeof id !== 'string' || id === '' || typeof editToken !== 'string' || editToken === '') {
      console.error('report accepted without an id or edit token');
      return { kind: 'network' };
    }
    return { kind: 'created', id, editToken };
  }

  if (response.status === 403) {
    return { kind: 'turnstile' };
  }

  if (response.status === 400 || response.status === 413) {
    const errors = mapApiErrors(await readJson(response));
    console.warn('report rejected', errors);
    return { kind: 'rejected', errors };
  }

  console.error(`report request returned HTTP ${String(response.status)}`);
  return { kind: 'network' };
}
