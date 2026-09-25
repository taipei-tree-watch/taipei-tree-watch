/**
 * What a report says, as plain rows, so that the detail card and the sheet
 * shown after a submission present one report the same way.
 *
 * This layer decides which rows exist and what they read; the callers only
 * turn them into elements. Keeping the decision here is what lets it be
 * tested, and it is the reason a submitted report cannot drift from the same
 * report seen later on the map.
 */
import {
  EVIDENCE_CODES_WITHOUT_CAUSES,
  causes,
  dispositions,
  evidence,
} from '../../../shared/tags.ts';
import type { Tag } from '../../../shared/tags.ts';
import type { ReportRecord } from '../data/snapshot.ts';
import { formatTemplate, labelForCode, labelsForCodes, linkHostname } from '../format.ts';
import strings from '../ui-strings.json';

export interface SummaryRow {
  readonly label: string;
  readonly value: string;
}

export interface SummaryLink {
  readonly href: string;
  /** Shown in place of the address, so a long link cannot carry a message. */
  readonly hostname: string;
}

export interface ReportSummary {
  /** The cause sentence, when the report is entitled to one. */
  readonly notice: string | null;
  readonly rows: readonly SummaryRow[];
  readonly link: SummaryLink | null;
}

function joined(tags: readonly Tag[], codes: readonly number[]): string | null {
  if (codes.length === 0) {
    return null;
  }
  const labels = labelsForCodes(tags, codes);
  return labels.length === 0 ? null : labels.join(strings.card.listSeparator);
}

/**
 * The cause sentence appears only when a cause was recorded and the reference
 * source is something written down. A sighting with no notice carries no
 * recorded cause, so the sentence would claim more than the data says.
 */
function noticeSentence(report: ReportRecord): string | null {
  if (
    report.evidence !== null &&
    (EVIDENCE_CODES_WITHOUT_CAUSES as readonly number[]).includes(report.evidence)
  ) {
    return null;
  }
  const labels = joined(causes, report.causes);
  if (labels === null) {
    return null;
  }
  return formatTemplate(strings.card.noticeReason, { causes: labels });
}

function link(value: string | null): SummaryLink | null {
  if (value === null) {
    return null;
  }
  const hostname = linkHostname(value);
  return hostname === null ? null : { href: value, hostname };
}

export function reportSummary(report: ReportRecord): ReportSummary {
  const candidates: readonly (readonly [string, string | null])[] = [
    [strings.card.species, report.species],
    [strings.card.causes, joined(causes, report.causes)],
    [strings.card.dispositions, joined(dispositions, report.dispositions)],
    [strings.card.evidence, labelForCode(evidence, report.evidence)],
    [strings.card.observedAt, report.observedAt],
    [strings.card.note, report.note],
    [
      strings.card.protectedTree,
      report.protectedTreeId === null
        ? null
        : formatTemplate(strings.card.protectedTreeValue, { id: report.protectedTreeId }),
    ],
  ];

  return {
    notice: noticeSentence(report),
    rows: candidates
      .filter((entry): entry is readonly [string, string] => entry[1] !== null)
      .map(([label, value]) => ({ label, value })),
    link: link(report.link),
  };
}
