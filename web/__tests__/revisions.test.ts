import { describe, expect, it, vi } from 'vitest';

import { REVISION_COLUMNS } from '../../shared/revisions.ts';
import {
  REVISIONS_URL,
  createRevisionsLoader,
  decodeRevisions,
  latestRevisionId,
} from '../src/data/revisions.ts';
import type { ReportRecord } from '../src/data/snapshot.ts';
import {
  correctionChanges,
  correctionDraftFrom,
  correctionIssues,
  describeRevision,
  submitCorrection,
} from '../src/report/correction.ts';
import { sameTreeReports } from '../src/report/same-tree.ts';
import strings from '../src/ui-strings.json';

const BBOX = { minLng: 121.43, minLat: 24.94, maxLng: 121.68, maxLat: 25.24 };

const REPORT: ReportRecord = {
  id: '01JBZ8QF7KJ9M3N4P5R6S7T8V9',
  lat: 25.04,
  lng: 121.54,
  species: '榕',
  causes: [21, 1],
  dispositions: [],
  evidence: 1,
  source: 1,
  note: null,
  link: null,
  observedAt: null,
  protectedTreeId: null,
  inventoryTreeId: null,
  createdAt: '2026-09-01T00:00:00.000Z',
};

const AT_REPORT = { lat: REPORT.lat, lng: REPORT.lng, zoom: 19 };

describe('decodeRevisions', () => {
  it('groups revisions by report in the order they apply', () => {
    const byReport = decodeRevisions({
      schema: 1,
      generated_at: '2026-09-18T08:15:00Z',
      columns: [...REVISION_COLUMNS],
      rows: [
        ['02', 'A', { species: '楓' }, { species: '樟' }, 'second', null, '2026-09-18T07:31:00Z'],
        ['01', 'A', { species: '樟' }, { species: '榕' }, 'first', 'https://x.com/1', null],
        ['03', 'B', { evidence: 6 }, { evidence: 1 }, 'other', null, null],
        ['bad'],
      ],
    });

    expect(byReport.get('A')?.map((entry) => entry.id)).toEqual(['01', '02']);
    expect(byReport.get('A')?.[0]).toEqual({
      id: '01',
      reportId: 'A',
      changes: { species: '樟' },
      previous: { species: '榕' },
      reason: 'first',
      link: 'https://x.com/1',
      createdAt: null,
    });
    expect(latestRevisionId(byReport, 'A')).toBe('02');
    expect(latestRevisionId(byReport, 'C')).toBeNull();
  });

  it('rejects a payload without the revision columns', () => {
    expect(() => decodeRevisions({ columns: ['id'], rows: [] })).toThrow();
  });
});

describe('createRevisionsLoader', () => {
  it('asks once, and again only after a failure', async () => {
    const payload = { schema: 1, generated_at: 'x', columns: [...REVISION_COLUMNS], rows: [] };
    const fetchImpl = vi
      .fn<(input: string) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValue(Response.json(payload));
    const load = createRevisionsLoader(fetchImpl);

    await expect(load()).rejects.toThrow();
    await load();
    await load();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledWith(REVISIONS_URL);
  });
});

describe('correctionChanges', () => {
  it('is empty for an untouched draft, whatever order causes were stored in', () => {
    expect(correctionChanges(correctionDraftFrom(REPORT), REPORT, null)).toEqual({});
  });

  it('keeps only changed fields, in stored form', () => {
    const draft = {
      ...correctionDraftFrom(REPORT),
      species: ' 樟 ',
      inventoryTreeId: 'bt0614021096',
      protectedTreeId: '',
    };
    expect(correctionChanges(draft, REPORT, null)).toEqual({
      species: '樟',
      inventory_tree_id: 'BT0614021096',
    });
  });

  it('clears causes with an evidence source that allows none', () => {
    const draft = { ...correctionDraftFrom(REPORT), evidence: 6 };
    expect(correctionChanges(draft, REPORT, null)).toEqual({ causes: [], evidence: 6 });
  });

  it('moves the point only to an aimed position that differs', () => {
    const draft = correctionDraftFrom(REPORT);
    expect(correctionChanges(draft, REPORT, AT_REPORT)).toEqual({});
    expect(
      correctionChanges(draft, REPORT, { ...AT_REPORT, lat: REPORT.lat + 0.000123 }),
    ).toEqual({ lat: 25.04012, lng: REPORT.lng });
  });
});

describe('correctionIssues', () => {
  function codes(...args: Parameters<typeof correctionIssues>): string[] {
    return correctionIssues(...args).map((issue) => issue.code);
  }

  it('needs a change and a reason', () => {
    expect(codes(correctionDraftFrom(REPORT), REPORT, null, BBOX)).toEqual([
      'reasonMissing',
      'noChanges',
    ]);
    const draft = { ...correctionDraftFrom(REPORT), species: '樟', reason: '樹牌' };
    expect(codes(draft, REPORT, null, BBOX)).toEqual([]);
  });

  it('holds the aimed point to 30 m, zoom 18 and the accepted area', () => {
    const draft = { ...correctionDraftFrom(REPORT), reason: '偏了' };
    expect(codes(draft, REPORT, { ...AT_REPORT, lat: REPORT.lat + 0.0004 }, BBOX)).toContain(
      'tooFar',
    );
    expect(codes(draft, REPORT, { ...AT_REPORT, zoom: 16 }, BBOX)).toContain('zoom');
  });

  it('checks the reason after stripping links, and the link domain', () => {
    const draft = {
      ...correctionDraftFrom(REPORT),
      species: '樟',
      reason: 'https://example.com/a',
      link: 'https://example.com/b',
    };
    expect(codes(draft, REPORT, null, BBOX)).toEqual(['reasonMissing', 'linkDomain']);
    expect(codes({ ...draft, reason: '字'.repeat(101), link: '' }, REPORT, null, BBOX)).toEqual([
      'reasonLength',
    ]);
  });
});

describe('describeRevision', () => {
  it('reads each change from what to what', () => {
    expect(
      describeRevision(
        { species: '樟', causes: [1], lat: 25.0401, lng: 121.54 },
        { species: null, causes: [], lat: 25.04, lng: 121.54 },
      ),
    ).toEqual([
      {
        label: strings.revisions.fields.location,
        from: strings.revisions.locationFrom,
        to: '移動約 11 公尺',
      },
      { label: strings.revisions.fields.species, from: strings.revisions.empty, to: '樟' },
      { label: strings.revisions.fields.causes, from: strings.revisions.empty, to: '褐根病' },
    ]);
  });
});

describe('submitCorrection', () => {
  it.each([
    [201, { id: 'R' }, { kind: 'created', id: 'R' }],
    [409, {}, { kind: 'conflict' }],
    [404, {}, { kind: 'missing' }],
    [403, {}, { kind: 'turnstile' }],
    [400, { errors: [{ field: 'reason' }] }, { kind: 'rejected', fields: ['reason'] }],
    [500, {}, { kind: 'network' }],
  ])('maps HTTP %i', async (status, body, expected) => {
    const fetchImpl = vi.fn(() => Promise.resolve(Response.json(body, { status })));
    await expect(submitCorrection(REPORT.id, {}, fetchImpl)).resolves.toEqual(expected);
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/reports/${REPORT.id}/revisions`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('treats a request that never arrived as a network failure', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error('offline')));
    await expect(submitCorrection(REPORT.id, {}, fetchImpl)).resolves.toEqual({ kind: 'network' });
  });
});

describe('sameTreeReports', () => {
  const at = (id: string, observedAt: string | null, followsReportId: string | null) => ({
    ...REPORT,
    id,
    observedAt,
    followsReportId,
  });

  it('follows links both ways and sorts by observation date', () => {
    const a = at('A', '2026-01-01', null);
    const b = at('B', '2026-03-01', 'A');
    const c = at('C', '2026-02-01', 'B');
    const d = at('D', '2026-02-15', 'A');
    const unrelated = at('E', null, null);
    const all = [a, b, c, d, unrelated];

    expect(sameTreeReports(c, all).map((entry) => entry.id)).toEqual(['A', 'D', 'B']);
    expect(sameTreeReports(unrelated, all)).toEqual([]);
  });

  it('stops at a report that is no longer visible', () => {
    const b = at('B', null, 'GONE');
    expect(sameTreeReports(b, [b])).toEqual([]);
  });
});
