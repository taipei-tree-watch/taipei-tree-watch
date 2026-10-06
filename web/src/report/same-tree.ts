/**
 * The "is this the tree someone already reported?" exchange in the picker.
 *
 * The answer belongs to one existing report. When the crosshair moves on to
 * a different report, or to none, the earlier answer no longer applies and
 * the question is asked afresh.
 *
 * Answering "same tree" never merges anything: a follow-up is an ordinary
 * new report that happens to start from what the earlier one said.
 */
import type { ReportRecord } from '../data/snapshot.ts';
import type { ReportDraft } from './draft.ts';

/**
 * `same` is the reporter saying it is one tree, still deciding whether
 * anything changed; `update` is having chosen to report the change.
 */
export type SameTreeAnswer = 'same' | 'different' | 'update';

export interface SameTreeCheck {
  readonly reportId: string;
  readonly answer: SameTreeAnswer;
}

/** What the nearby report box shows. `none` hides it. */
export type SameTreeStage = 'none' | 'ask' | SameTreeAnswer;

export function sameTreeStage(
  nearestReportId: string | null,
  check: SameTreeCheck | null,
): SameTreeStage {
  if (nearestReportId === null) {
    return 'none';
  }
  if (check === null || check.reportId !== nearestReportId) {
    return 'ask';
  }
  return check.answer;
}

/**
 * Carry over what identifies the tree, never what describes its condition:
 * the condition is what the follow-up is about. Fields the reporter already
 * filled are left alone.
 */
export function prefillFromReport(draft: ReportDraft, report: ReportRecord): ReportDraft {
  return {
    ...draft,
    species: draft.species === '' ? (report.species ?? '') : draft.species,
    protectedTreeId:
      draft.protectedTreeId === '' ? (report.protectedTreeId ?? '') : draft.protectedTreeId,
    inventoryTreeId:
      draft.inventoryTreeId === '' ? (report.inventoryTreeId ?? '') : draft.inventoryTreeId,
  };
}

/** When a report describes the tree: the observation date, else when it was sent. */
function sortKey(report: ReportRecord): string {
  return report.observedAt ?? report.createdAt?.slice(0, 10) ?? '';
}

/**
 * The other reports of the same tree: everything reachable from `report`
 * through follow-up links in either direction, oldest first. A link to a
 * report that is no longer visible simply ends the chain there.
 */
export function sameTreeReports(
  report: ReportRecord,
  reports: readonly ReportRecord[],
): ReportRecord[] {
  const byId = new Map(reports.map((entry) => [entry.id, entry]));
  const neighbours = new Map<string, string[]>();
  const connect = (a: string, b: string): void => {
    neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
    neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
  };
  for (const entry of reports) {
    if (entry.followsReportId != null && byId.has(entry.followsReportId)) {
      connect(entry.id, entry.followsReportId);
    }
  }
  if (report.followsReportId != null && byId.has(report.followsReportId)) {
    connect(report.id, report.followsReportId);
  }

  const seen = new Set<string>([report.id]);
  const queue = [report.id];
  const found: ReportRecord[] = [];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const id of neighbours.get(next) ?? []) {
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      queue.push(id);
      const entry = byId.get(id);
      if (entry !== undefined) {
        found.push(entry);
      }
    }
  }
  return found.sort((a, b) => {
    const byDate = sortKey(a).localeCompare(sortKey(b));
    return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
  });
}
