/**
 * Decode the revisions file served by GET /api/revisions and load it on
 * demand.
 *
 * Nothing on the map needs it: the snapshot already carries every corrected
 * value and a count. It is fetched only when a card lists a report's
 * corrections or a correction needs the version it is based on, and then
 * kept for the rest of the visit.
 */
import { REVISION_COLUMNS } from '../../../shared/revisions.ts';
import type { RevisionChanges } from '../../../shared/revisions.ts';
import { DecodeError, asText, buildColumnIndex, cell, isRecord } from './columns.ts';

export const REVISIONS_URL = '/api/revisions';

export interface RevisionEntry {
  readonly id: string;
  readonly reportId: string;
  readonly changes: RevisionChanges;
  /** What the same fields held before this revision applied. */
  readonly previous: RevisionChanges;
  readonly reason: string;
  readonly link: string | null;
  readonly createdAt: string | null;
}

/** Revisions of each report, oldest first. */
export type RevisionsByReport = ReadonlyMap<string, readonly RevisionEntry[]>;

function asChanges(value: unknown): RevisionChanges {
  return isRecord(value) ? (value as RevisionChanges) : {};
}

export function decodeRevisions(payload: unknown): RevisionsByReport {
  if (!isRecord(payload)) {
    throw new DecodeError('revisions: payload must be an object');
  }
  const index = buildColumnIndex(payload.columns, REVISION_COLUMNS, 'revisions');
  const rows = payload.rows;
  if (!Array.isArray(rows)) {
    throw new DecodeError('revisions: rows must be an array');
  }

  const byReport = new Map<string, RevisionEntry[]>();
  for (const row of rows) {
    if (!Array.isArray(row)) {
      continue;
    }
    const id = asText(cell(row, index, 'id'));
    const reportId = asText(cell(row, index, 'report_id'));
    if (id === null || reportId === null) {
      continue;
    }
    const list = byReport.get(reportId) ?? [];
    list.push({
      id,
      reportId,
      changes: asChanges(cell(row, index, 'changes')),
      previous: asChanges(cell(row, index, 'previous')),
      reason: asText(cell(row, index, 'reason')) ?? '',
      link: asText(cell(row, index, 'link')),
      createdAt: asText(cell(row, index, 'created_at')),
    });
    byReport.set(reportId, list);
  }
  for (const list of byReport.values()) {
    list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return byReport;
}

/** The revision a new correction of `reportId` is based on; null when uncorrected. */
export function latestRevisionId(revisions: RevisionsByReport, reportId: string): string | null {
  return revisions.get(reportId)?.at(-1)?.id ?? null;
}

export type RevisionsLoader = () => Promise<RevisionsByReport>;

/**
 * One request per visit. A failure is not remembered, so the next card that
 * asks tries again.
 */
export function createRevisionsLoader(
  fetchImpl: (input: string) => Promise<Response>,
): RevisionsLoader {
  let pending: Promise<RevisionsByReport> | null = null;
  return () => {
    pending ??= fetchImpl(REVISIONS_URL)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`${REVISIONS_URL}: HTTP ${String(response.status)}`);
        }
        return decodeRevisions(await response.json());
      })
      .catch((error: unknown) => {
        pending = null;
        throw error;
      });
    return pending;
  };
}
