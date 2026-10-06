import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_CODES_WITHOUT_CAUSES,
  REMOVAL_PLAN_SOURCE_CODE,
  USER_REPORT_SOURCE_CODE,
  causes,
  sources,
} from '../../shared/tags.ts';
import type { Tag } from '../../shared/tags.ts';
import type { RemovalPlanRef } from '../src/data/removal-plans.ts';
import type { ReportRecord } from '../src/data/snapshot.ts';
import { formatTemplate } from '../src/format.ts';
import { reportSummary } from '../src/report/summary.ts';
import strings from '../src/ui-strings.json';

/** An on-site notice: a reference source a cause can be read off. */
const SITE_NOTICE = 1;
const [SIGHTING_ONLY] = EVIDENCE_CODES_WITHOUT_CAUSES;
const BROWN_ROOT_ROT = 1;
const ROOTS_ONLY = 3;

function report(overrides: Partial<ReportRecord> = {}): ReportRecord {
  return {
    id: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    lat: 25.033,
    lng: 121.5654,
    species: null,
    causes: [],
    dispositions: [],
    evidence: SITE_NOTICE,
    source: USER_REPORT_SOURCE_CODE,
    note: null,
    link: null,
    observedAt: null,
    protectedTreeId: null,
    inventoryTreeId: null,
    createdAt: '2026-09-19T08:00:00.000Z',
    ...overrides,
  } as ReportRecord;
}

function labelOf(tags: readonly Tag[], code: number): string {
  const tag = tags.find((entry) => entry.code === code);
  if (tag === undefined) {
    throw new Error(`no tag ${String(code)}`);
  }
  return tag.label;
}

function labels(record: ReportRecord): string[] {
  return reportSummary(record).rows.map((row) => row.label);
}

describe('reportSummary', () => {
  it('leaves out every field that was not filled in', () => {
    // The reference source and the data source are always known.
    expect(labels(report())).toEqual([strings.card.evidence, strings.card.source]);
  });

  it('names the data source of a user report', () => {
    const row = reportSummary(report()).rows.find((entry) => entry.label === strings.card.source);
    expect(row).toEqual({ label: strings.card.source, value: labelOf(sources, USER_REPORT_SOURCE_CODE) });
    expect(reportSummary(report()).caveat).toBeNull();
  });

  it('keeps the rows in the order the card reads them', () => {
    const full = report({
      species: 'A',
      causes: [BROWN_ROOT_ROT],
      dispositions: [ROOTS_ONLY],
      note: 'B',
      observedAt: '2026-09-01',
      protectedTreeId: '1234',
    });
    expect(labels(full)).toHaveLength(8);
    expect(labels(full)[0]).toBe(reportSummary(report({ species: 'A' })).rows[0]?.label);
  });

  it('states the recorded cause when the source is a document', () => {
    const summary = reportSummary(report({ causes: [BROWN_ROOT_ROT] }));
    expect(summary.notice).not.toBeNull();
  });

  it('states no cause for a sighting with no notice behind it', () => {
    const summary = reportSummary(
      report({ causes: [BROWN_ROOT_ROT], evidence: SIGHTING_ONLY }),
    );
    expect(summary.notice).toBeNull();
  });

  it('states no cause when none was recorded', () => {
    expect(reportSummary(report()).notice).toBeNull();
  });

  it('shows a link as its hostname only', () => {
    const summary = reportSummary(report({ link: 'https://www.threads.com/@a/post/1' }));
    expect(summary.link).toEqual({
      href: 'https://www.threads.com/@a/post/1',
      hostname: 'www.threads.com',
    });
  });

  it('drops a link that is not a usable address', () => {
    expect(reportSummary(report({ link: 'not a url' })).link).toBeNull();
  });

  it('drops an unknown code rather than printing a number', () => {
    const summary = reportSummary(report({ causes: [9999] as unknown as ReportRecord['causes'] }));
    expect(summary.rows.some((row) => row.value.includes('9999'))).toBe(false);
    expect(summary.notice).toBeNull();
  });

  describe('a plan tree', () => {
    const PLAN: RemovalPlanRef = {
      title: 'Wenjing green space removal plan',
      status: 'under_review',
      url: 'https://pkl.gov.taipei/News_Content.aspx?n=1&s=2',
      action: 'remove',
      inventoryGone: null,
    };
    const OFFICIAL_DOCUMENT = 3;
    const MRT_WORKS = 20;

    function planTree(overrides: Partial<ReportRecord> = {}): ReportRecord {
      return report({
        source: REMOVAL_PLAN_SOURCE_CODE,
        evidence: OFFICIAL_DOCUMENT,
        observedAt: '2026-04-17',
        link: PLAN.url,
        plan: PLAN,
        ...overrides,
      });
    }

    it('says the tree is only planned to go', () => {
      expect(reportSummary(planTree()).caveat).toBe(strings.card.plannedRemove);
      expect(reportSummary(planTree({ plan: { ...PLAN, action: 'transplant' } })).caveat).toBe(
        strings.card.plannedTransplant,
      );
    });

    it('keeps the caveat when the plan file did not load', () => {
      const summary = reportSummary(planTree({ plan: undefined }));
      expect(summary.caveat).toBe(strings.card.plannedEither);
      expect(summary.link?.hostname).toBe('pkl.gov.taipei');
    });

    it('names the plan in the source row and links to its page', () => {
      const row = reportSummary(planTree()).rows.find((entry) => entry.label === strings.card.source);
      expect(row).toEqual({
        label: strings.card.source,
        value: formatTemplate(strings.card.sourcePlanValue, {
          source: labelOf(sources, REMOVAL_PLAN_SOURCE_CODE),
          title: PLAN.title,
        }),
        href: PLAN.url,
      });
    });

    it('shows the plan status and the planned action', () => {
      const rows = reportSummary(planTree()).rows;
      expect(rows.find((entry) => entry.label === strings.card.planStatus)?.value).toBe(
        strings.planStatus.under_review,
      );
      expect(rows.find((entry) => entry.label === strings.card.planAction)?.value).toBe(
        strings.planAction.remove,
      );
    });

    it('labels the date as the posting date', () => {
      const labelsOfPlan = labels(planTree());
      expect(labelsOfPlan).toContain(strings.card.postedAt);
      expect(labelsOfPlan).not.toContain(strings.card.observedAt);
    });

    it('does not repeat the plan page as a separate link', () => {
      expect(reportSummary(planTree()).link).toBeNull();
    });

    it('reads the cause off the plan rather than a notice', () => {
      expect(reportSummary(planTree({ causes: [MRT_WORKS] })).notice).toBe(
        formatTemplate(strings.card.planReason, { causes: labelOf(causes, MRT_WORKS) }),
      );
    });

    it('says when the tag has left the inventory, naming the tag and version', () => {
      const summary = reportSummary(
        planTree({
          inventoryTreeId: 'SY1680021119',
          plan: { ...PLAN, inventoryGone: '2026-10-05' },
        }),
      );
      expect(summary.inventory).toBe(
        formatTemplate(strings.card.inventoryGone, { id: 'SY1680021119', date: '2026-10-05' }),
      );
      expect(summary.caveat).toBe(strings.card.plannedRemove);
    });

    it('says nothing about the inventory while the tag is still listed or unknown', () => {
      expect(reportSummary(planTree({ inventoryTreeId: 'SY1680021119' })).inventory).toBeNull();
      expect(
        reportSummary(planTree({ plan: { ...PLAN, inventoryGone: '2026-10-05' } })).inventory,
      ).toBeNull();
      expect(reportSummary(planTree({ plan: undefined })).inventory).toBeNull();
    });
  });
});
