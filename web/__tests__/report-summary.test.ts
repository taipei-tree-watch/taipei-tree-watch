import { describe, expect, it } from 'vitest';

import { EVIDENCE_CODES_WITHOUT_CAUSES, USER_REPORT_SOURCE_CODE } from '../../shared/tags.ts';
import type { ReportRecord } from '../src/data/snapshot.ts';
import { reportSummary } from '../src/report/summary.ts';

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

function labels(record: ReportRecord): string[] {
  return reportSummary(record).rows.map((row) => row.label);
}

describe('reportSummary', () => {
  it('leaves out every field that was not filled in', () => {
    // The reference source and the data source are always known.
    expect(labels(report())).toHaveLength(2);
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
});
