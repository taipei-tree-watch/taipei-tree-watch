/**
 * Issue edit links for reports that have none: the pure half of
 * scripts/issue-edit-links.ts, kept apart so it can be tested without D1.
 *
 * Reports created before edit links existed have a NULL `edit_token_hash`.
 * Issuing a link means generating a token, storing its SHA-256, and handing
 * the token to whoever runs the script; nobody else ever sees it, which is
 * the same position a reporter is in after submitting.
 */
import { createHash, randomBytes } from 'node:crypto';

import { EDIT_TOKEN_BYTES, isReportId } from '../shared/validation.ts';

/** A row as `SELECT id, lat, lng, species` returns it. */
export interface ReportWithoutLink {
  readonly id: string;
  readonly lat: number;
  readonly lng: number;
  readonly species: string | null;
}

export interface IssuedLink extends ReportWithoutLink {
  readonly token: string;
  readonly url: string;
}

/**
 * Visible user reports only. Official records stay closed to the web form,
 * and a hidden report is not brought back into anyone's reach.
 */
export const SELECT_REPORTS_WITHOUT_LINK =
  'SELECT id, lat, lng, species FROM reports ' +
  'WHERE edit_token_hash IS NULL AND status = 0 AND source = 1 ORDER BY id';

export function newToken(): string {
  return randomBytes(EDIT_TOKEN_BYTES).toString('base64url');
}

/** Same digest as the Worker: sha256 of the token text, lowercase hex. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function editUrl(baseUrl: string, id: string, token: string): string {
  const url = new URL(baseUrl);
  url.search = new URLSearchParams({ report: id, edit: token }).toString();
  url.hash = '';
  return url.toString();
}

export function issueLinks(
  rows: readonly ReportWithoutLink[],
  baseUrl: string,
  generate: () => string = newToken,
): IssuedLink[] {
  return rows.map((row) => {
    if (!isReportId(row.id)) {
      throw new Error(`unexpected report id ${row.id}`);
    }
    const token = generate();
    return { ...row, token, url: editUrl(baseUrl, row.id, token) };
  });
}

/**
 * One UPDATE per report. `edit_token_hash IS NULL` keeps a rerun, or a
 * report that received a link in the meantime, from being overwritten.
 * Ids were checked against the ULID alphabet and hashes are hex, so both
 * are safe to inline.
 */
export function updateSql(links: readonly IssuedLink[]): string {
  return links
    .map(
      (link) =>
        `UPDATE reports SET edit_token_hash = '${tokenHash(link.token)}' ` +
        `WHERE id = '${link.id}' AND edit_token_hash IS NULL;`,
    )
    .join('\n');
}

/** The shape web/src/report/edit-links.ts stores under `ttw:edit-links`. */
export function storageEntries(links: readonly IssuedLink[], savedAt: string): object[] {
  return links.map((link) => ({
    id: link.id,
    token: link.token,
    savedAt,
    lat: link.lat,
    lng: link.lng,
    species: link.species,
  }));
}

/**
 * A snippet for the browser console on the site: merges the entries into
 * whatever the browser already holds, then reloads so "my reports" shows them.
 */
export function importSnippet(links: readonly IssuedLink[], savedAt: string): string {
  const entries = JSON.stringify(storageEntries(links, savedAt));
  return [
    '(() => {',
    "  const key = 'ttw:edit-links';",
    `  const incoming = ${entries};`,
    '  const current = JSON.parse(localStorage.getItem(key) || "[]");',
    '  const ids = new Set(incoming.map((entry) => entry.id));',
    '  const kept = current.filter((entry) => !ids.has(entry.id));',
    '  localStorage.setItem(key, JSON.stringify([...incoming, ...kept]));',
    '  location.reload();',
    '})();',
  ].join('\n');
}
