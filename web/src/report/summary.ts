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
  REMOVAL_PLAN_SOURCE_CODE,
  causes,
  dispositions,
  evidence,
  sources,
} from '../../../shared/tags.ts';
import type { Tag } from '../../../shared/tags.ts';
import type { ReportRecord } from '../data/snapshot.ts';
import { formatTemplate, labelForCode, labelsForCodes, linkHostname } from '../format.ts';
import strings from '../ui-strings.json';

export interface SummaryRow {
  readonly label: string;
  readonly value: string;
  /** Set when the value names a page the reader can open, such as the plan. */
  readonly href?: string;
}

export interface SummaryLink {
  readonly href: string;
  /** Shown in place of the address, so a long link cannot carry a message. */
  readonly hostname: string;
}

export interface ReportSummary {
  /**
   * Heads a plan tree: the plan lists the tree, nobody has seen it go, so the
   * card must not read as a record of a removal.
   */
  readonly caveat: string | null;
  /** A plan tree whose tag has left the Parks Office inventory: a signal only. */
  readonly inventory: string | null;
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
  const template =
    report.source === REMOVAL_PLAN_SOURCE_CODE ? strings.card.planReason : strings.card.noticeReason;
  return formatTemplate(template, { causes: labels });
}

function planCaveat(report: ReportRecord): string | null {
  if (report.source !== REMOVAL_PLAN_SOURCE_CODE) {
    return null;
  }
  // Without the plan file the action is unknown, and a transplant must not be
  // announced as a removal.
  if (report.plan === undefined) {
    return strings.card.plannedEither;
  }
  return report.plan.action === 'transplant'
    ? strings.card.plannedTransplant
    : strings.card.plannedRemove;
}

function inventorySentence(report: ReportRecord): string | null {
  const date = report.plan?.inventoryGone ?? null;
  if (date === null || report.inventoryTreeId === null) {
    return null;
  }
  return formatTemplate(strings.card.inventoryGone, { id: report.inventoryTreeId, date });
}

/** The data source, naming the plan and linking to its page when it is known. */
function sourceRow(report: ReportRecord): SummaryRow | null {
  const label = labelForCode(sources, report.source);
  if (label === null) {
    return null;
  }
  if (report.plan === undefined) {
    return { label: strings.card.source, value: label };
  }
  return {
    label: strings.card.source,
    value: formatTemplate(strings.card.sourcePlanValue, { source: label, title: report.plan.title }),
    href: report.plan.url,
  };
}

function link(value: string | null): SummaryLink | null {
  if (value === null) {
    return null;
  }
  const hostname = linkHostname(value);
  return hostname === null ? null : { href: value, hostname };
}

function textRow(label: string, value: string | null): SummaryRow | null {
  return value === null ? null : { label, value };
}

export function reportSummary(report: ReportRecord): ReportSummary {
  const plan = report.plan;
  const isPlan = report.source === REMOVAL_PLAN_SOURCE_CODE;
  const candidates: readonly (SummaryRow | null)[] = [
    textRow(strings.card.species, report.species),
    textRow(strings.card.causes, joined(causes, report.causes)),
    textRow(strings.card.dispositions, joined(dispositions, report.dispositions)),
    textRow(strings.card.evidence, labelForCode(evidence, report.evidence)),
    sourceRow(report),
    textRow(strings.card.planStatus, plan === undefined ? null : strings.planStatus[plan.status]),
    textRow(strings.card.planAction, plan === undefined ? null : strings.planAction[plan.action]),
    // A plan says when it went online, not when anyone stood at the tree.
    textRow(isPlan ? strings.card.postedAt : strings.card.observedAt, report.observedAt),
    textRow(strings.card.note, report.note),
    textRow(
      strings.card.protectedTree,
      report.protectedTreeId === null
        ? null
        : formatTemplate(strings.card.protectedTreeValue, { id: report.protectedTreeId }),
    ),
  ];

  // The source row already links to the plan's page; a second row with the
  // same address would only repeat it.
  const linkValue = plan !== undefined && report.link === plan.url ? null : report.link;

  return {
    caveat: planCaveat(report),
    inventory: inventorySentence(report),
    notice: noticeSentence(report),
    rows: candidates.filter((entry): entry is SummaryRow => entry !== null),
    link: link(linkValue),
  };
}
