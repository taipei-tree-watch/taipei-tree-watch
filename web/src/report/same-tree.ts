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
