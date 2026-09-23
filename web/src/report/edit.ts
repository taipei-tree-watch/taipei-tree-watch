/**
 * Requests an edit link makes: read the current report, save a new version,
 * withdraw it. Each carries the token in an Authorization header, never in the
 * address, so it stays out of logs and caches.
 *
 * As in submit.ts, outcomes are values. `missing` is the Worker's single 404
 * answer, which covers a wrong token, a withdrawn or hidden report and an
 * unknown id alike; the caller cannot tell them apart and does not need to.
 */
import type { EditLink } from '../permalink.ts';
import { mapApiErrors } from './errors.ts';
import type { FetchLike, SubmitOutcome } from './submit.ts';
import { REPORTS_URL, readJson } from './submit.ts';

/** The report as GET /api/reports/<id> returns it, in request body field names. */
export interface EditableReport {
  readonly id: string;
  readonly lat: number;
  readonly lng: number;
  readonly species: string | null;
  readonly causes: readonly number[];
  readonly dispositions: readonly number[];
  readonly evidence: number;
  readonly note: string | null;
  readonly link: string | null;
  readonly observed_at: string | null;
  readonly protected_tree_id: string | null;
  readonly inventory_tree_id: string | null;
}

export type ReadOutcome =
  | { readonly kind: 'found'; readonly report: EditableReport }
  | { readonly kind: 'missing' }
  | { readonly kind: 'network' };

export type SaveOutcome =
  | { readonly kind: 'saved'; readonly updatedAt: string }
  | { readonly kind: 'missing' }
  | Exclude<SubmitOutcome, { readonly kind: 'created' }>;

export type WithdrawOutcome =
  | { readonly kind: 'withdrawn'; readonly updatedAt: string }
  | { readonly kind: 'missing' }
  | { readonly kind: 'network' };

export function reportUrl(id: string): string {
  return `${REPORTS_URL}/${encodeURIComponent(id)}`;
}

function authorization(link: EditLink): Record<string, string> {
  return { authorization: `Bearer ${link.token}` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function codes(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is number => typeof entry === 'number')
    : [];
}

function decodeReport(payload: unknown): EditableReport | null {
  if (!isRecord(payload)) {
    return null;
  }
  const { id, lat, lng, evidence } = payload;
  if (
    typeof id !== 'string' ||
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    typeof evidence !== 'number'
  ) {
    return null;
  }
  return {
    id,
    lat,
    lng,
    species: textOrNull(payload.species),
    causes: codes(payload.causes),
    dispositions: codes(payload.dispositions),
    evidence,
    note: textOrNull(payload.note),
    link: textOrNull(payload.link),
    observed_at: textOrNull(payload.observed_at),
    protected_tree_id: textOrNull(payload.protected_tree_id),
    inventory_tree_id: textOrNull(payload.inventory_tree_id),
  };
}

function updatedAtOf(payload: unknown): string | null {
  return isRecord(payload) ? textOrNull(payload.updated_at) : null;
}

async function send(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
): Promise<Response | null> {
  try {
    return await fetchImpl(url, init);
  } catch (error) {
    console.error('edit request failed', error);
    return null;
  }
}

export async function readEditableReport(
  link: EditLink,
  fetchImpl: FetchLike,
): Promise<ReadOutcome> {
  const response = await send(fetchImpl, reportUrl(link.id), {
    method: 'GET',
    headers: authorization(link),
  });
  if (response === null) {
    return { kind: 'network' };
  }
  if (response.status === 404) {
    return { kind: 'missing' };
  }
  if (!response.ok) {
    console.error(`edit read returned HTTP ${String(response.status)}`);
    return { kind: 'network' };
  }
  const report = decodeReport(await readJson(response));
  if (report === null) {
    console.error('edit read returned an unreadable report');
    return { kind: 'network' };
  }
  return { kind: 'found', report };
}

/** PUT the same body POST takes; the Worker runs the same checks on it. */
export async function saveReport(
  link: EditLink,
  body: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<SaveOutcome> {
  const response = await send(fetchImpl, reportUrl(link.id), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...authorization(link) },
    body: JSON.stringify(body),
  });
  if (response === null) {
    return { kind: 'network' };
  }
  if (response.status === 200) {
    const updatedAt = updatedAtOf(await readJson(response));
    if (updatedAt === null) {
      console.error('edit saved without updated_at');
      return { kind: 'network' };
    }
    return { kind: 'saved', updatedAt };
  }
  if (response.status === 404) {
    return { kind: 'missing' };
  }
  if (response.status === 403) {
    return { kind: 'turnstile' };
  }
  if (response.status === 400 || response.status === 413) {
    const errors = mapApiErrors(await readJson(response));
    console.warn('edit rejected', errors);
    return { kind: 'rejected', errors };
  }
  console.error(`edit save returned HTTP ${String(response.status)}`);
  return { kind: 'network' };
}

export async function withdrawReport(
  link: EditLink,
  fetchImpl: FetchLike,
): Promise<WithdrawOutcome> {
  const response = await send(fetchImpl, reportUrl(link.id), {
    method: 'DELETE',
    headers: authorization(link),
  });
  if (response === null) {
    return { kind: 'network' };
  }
  if (response.status === 404) {
    return { kind: 'missing' };
  }
  const updatedAt = response.ok ? updatedAtOf(await readJson(response)) : null;
  if (updatedAt === null) {
    console.error(`withdraw returned HTTP ${String(response.status)}`);
    return { kind: 'network' };
  }
  return { kind: 'withdrawn', updatedAt };
}
