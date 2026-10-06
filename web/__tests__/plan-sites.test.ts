import { describe, expect, it } from 'vitest';

import committed from '../../data/removal-plans/index.json';
import { REMOVAL_PLAN_SOURCE_CODES, USER_REPORT_SOURCE_CODE } from '../../shared/tags.ts';
import { decodePlanFile } from '../src/data/load.ts';
import type { PlanSite } from '../src/data/plan-sites.ts';
import { SITE_COLUMNS, decodePlanSites } from '../src/data/plan-sites.ts';
import { applySiteFilters, defaultFilterState, emptyFilterState } from '../src/filters.ts';
import {
  SPECIES_LISTED,
  locationText,
  sitesAtSamePoint,
  siteHeadline,
  siteSummary,
  speciesBreakdown,
} from '../src/report/site-summary.ts';
import strings from '../src/ui-strings.json';

const COLUMNS = [...SITE_COLUMNS, 'inventory_gone'] as const;
type Column = (typeof COLUMNS)[number];

const URL = 'https://pkl.gov.taipei/News_Content.aspx?n=1&s=2';

const CASES = {
  removal_A: { title: 'A 捷運移除計畫', status: 'approved', posted_at: '2026-09-23', url: URL },
  transplant_B: { title: 'B 移植計畫', status: 'unclear', posted_at: '2026-09-10', url: URL },
};

function siteRow(fields: Partial<Record<Column, unknown>> = {}): unknown[] {
  const values: Record<string, unknown> = {
    id: 'a-park',
    case: 'removal_A',
    lat: 25.07065,
    lng: 121.57833,
    via: 'park-centroid',
    locations: ['內湖區瑞光公園'],
    remove: 174,
    transplant: 0,
    species: [
      ['榕樹', 80],
      ['台灣海棗', 20],
    ],
    placed: 0,
    causes: [[20, 174]],
    inventory_gone: null,
    ...fields,
  };
  return COLUMNS.map((column) => values[column]);
}

function payload(rows: unknown[]): unknown {
  return {
    schema: 1,
    cases: CASES,
    columns: ['id', 'case', 'action', 'inventory_gone'],
    rows: [],
    site_columns: [...COLUMNS],
    sites: rows,
  };
}

function decodeOne(fields: Partial<Record<Column, unknown>> = {}): PlanSite {
  const [site] = decodePlanSites(payload([siteRow(fields)]));
  if (site === undefined) {
    throw new Error('no site decoded');
  }
  return site;
}

describe('decodePlanSites', () => {
  it('joins each site to its case and reads like a plan record', () => {
    const site = decodeOne();
    expect(site).toMatchObject({
      id: 'a-park',
      lat: 25.07065,
      lng: 121.57833,
      via: 'park-centroid',
      locations: ['內湖區瑞光公園'],
      remove: 174,
      transplant: 0,
      species: [
        { name: '榕樹', count: 80 },
        { name: '台灣海棗', count: 20 },
      ],
      title: 'A 捷運移除計畫',
      status: 'approved',
      url: URL,
      causes: [20],
      causeCounts: [{ code: 20, count: 174 }],
      dispositions: [],
      evidence: 3,
      source: REMOVAL_PLAN_SOURCE_CODES[0],
      observedAt: '2026-09-23',
    });
  });

  it('decodes an index without sites to none', () => {
    expect(decodePlanSites({ schema: 1, cases: CASES, columns: [], rows: [] })).toEqual([]);
  });

  it('skips sites it cannot name or place', () => {
    const sites = decodePlanSites(
      payload([
        siteRow({ case: 'removal_Z' }),
        siteRow({ id: 'Bad Id' }),
        siteRow({ lat: '25.07' }),
        siteRow({ via: 'guess' }),
        siteRow({ remove: 0, transplant: 0 }),
        siteRow({ id: 'kept' }),
        siteRow({ id: 'kept', case: 'transplant_B' }),
        'not a row',
      ]),
    );
    expect(sites.map((site) => site.id)).toEqual(['kept']);
  });

  it('reads an unnamed species as null and drops empty counts', () => {
    const site = decodeOne({
      species: [
        ['榕樹', 3],
        [null, 2],
        ['樟樹', 0],
        'x',
      ],
    });
    expect(site.species).toEqual([
      { name: '榕樹', count: 3 },
      { name: null, count: 2 },
    ]);
  });

  it('throws on a malformed site block, which the loader then sets aside', () => {
    expect(() => decodePlanSites({ ...(payload([]) as object), sites: {} })).toThrow();
    const decoded = decodePlanFile({ ...(payload([]) as object), sites: {} });
    expect(decoded.sites).toEqual([]);
    expect(decoded.index.size).toBe(0);
  });

  it('decodes the committed index', () => {
    const sites = decodePlanSites(committed);
    expect(sites.length).toBe(committed.sites.length);
    for (const site of sites) {
      expect(site.remove + site.transplant).toBeGreaterThan(0);
    }
  });
});

describe('site summary', () => {
  it('leads with the trees the plan lists at the site', () => {
    expect(siteHeadline(decodeOne())).toBe('此地點計畫移除 174 株');
    expect(siteHeadline(decodeOne({ remove: 0, transplant: 145 }))).toBe('此地點計畫移植 145 株');
    expect(siteHeadline(decodeOne({ remove: 6, transplant: 4 }))).toBe(
      '此地點計畫移除 6 株、移植 4 株',
    );
  });

  it('says the point marks the site, not a tree', () => {
    const summary = siteSummary(decodeOne());
    expect(summary.caveat).toBe(strings.site.caveat);
    expect(summary.caveat).toContain('不是某一棵樹的位置');
  });

  it('lists location, species, causes, plan, status, date and how the point was chosen', () => {
    const summary = siteSummary(decodeOne());
    expect(summary.rows).toEqual([
      { label: '地點', value: '內湖區瑞光公園' },
      { label: '樹種', value: '榕樹 80 株、台灣海棗 20 株' },
      { label: '計畫書記載的原因', value: '捷運工程 174 株' },
      { label: '資料來源', value: '公園處移除計畫書 · A 捷運移除計畫', href: URL },
      { label: '計畫狀態', value: '已核准' },
      { label: '上網日期', value: '2026-09-23' },
      { label: '點位', value: strings.site.via['park-centroid'] },
    ]);
    expect(summary.placed).toBeNull();
  });

  it('passes on the inventory signal for members whose tags are gone', () => {
    expect(siteSummary(decodeOne()).inventory).toBeNull();
    const site = decodeOne({ inventory_gone: [128, '2026-10-05'] });
    expect(site.inventoryGone).toEqual({ count: 128, date: '2026-10-05' });
    expect(siteSummary(site).inventory).toBe(
      '其中 128 株的樹籤編號已不在公園處行道樹及公園樹清冊（2026-10-05 版）。這只是訊號，可能是已移除，也可能是重編號或資料修正。',
    );
    expect(decodeOne({ inventory_gone: [0, '2026-10-05'] }).inventoryGone).toBeNull();
  });

  it('lists each location once, skipping a cut-off copy of another', () => {
    expect(locationText(['北市松仁路旁人行道', '北市松仁路旁人行'])).toBe('北市松仁路旁人行道');
    expect(locationText(['大度路三段北側', '大度路三段南側'])).toBe('大度路三段北側、大度路三段南側');
  });

  it('points to the trees of the same location that are drawn one by one', () => {
    expect(siteSummary(decodeOne({ placed: 110 })).placed).toBe(
      '同一地點另有 110 株有逐株位置，以空心圓另外畫在地圖上。',
    );
  });

  it('folds the less common species into one item and keeps the unnamed last', () => {
    const species = [
      ...Array.from({ length: SPECIES_LISTED + 2 }, (_, position) => ({
        name: `樹${String(position)}`,
        count: 10 - position,
      })),
      { name: null, count: 4 },
    ];
    const text = speciesBreakdown(species);
    expect(text?.split('、')).toEqual([
      ...Array.from({ length: SPECIES_LISTED }, (_, position) => `樹${String(position)} ${String(10 - position)} 株`),
      '其他 2 種 7 株',
      '未記載樹種 4 株',
    ]);
    expect(speciesBreakdown([])).toBeNull();
  });

  it('has a sentence for every way a point is chosen', () => {
    for (const via of Object.keys(strings.site.via)) {
      expect(siteSummary(decodeOne({ via })).rows.at(-1)?.value).toBe(
        strings.site.via[via as keyof typeof strings.site.via],
      );
    }
  });

  it('finds the other sites drawn on the very same point', () => {
    const sites = decodePlanSites(
      payload([
        siteRow({ id: 'a' }),
        siteRow({ id: 'b', case: 'transplant_B' }),
        siteRow({ id: 'c', lat: 25.07066 }),
      ]),
    );
    const [first] = sites;
    expect(first).toBeDefined();
    expect(sitesAtSamePoint(first as PlanSite, sites).map((site) => site.id)).toEqual(['b']);
  });
});

describe('sites under the filters', () => {
  const sites = decodePlanSites(
    payload([
      siteRow({ id: 'mrt' }),
      siteRow({ id: 'rot', causes: [[1, 2], [20, 10]] }),
      siteRow({ id: 'older', case: 'transplant_B', causes: [] }),
    ]),
  );

  it('stay off the default map, which shows user reports only', () => {
    expect(applySiteFilters(sites, defaultFilterState())).toEqual([]);
  });

  it('appear when either plan source is ticked', () => {
    for (const code of REMOVAL_PLAN_SOURCE_CODES) {
      const state = { ...emptyFilterState(), sources: new Set<number>([USER_REPORT_SOURCE_CODE, code]) };
      expect(applySiteFilters(sites, state).map((site) => site.id)).toEqual(['mrt', 'rot', 'older']);
    }
    expect(applySiteFilters(sites, emptyFilterState())).toHaveLength(3);
  });

  it('follow the cause and date filters like plan trees', () => {
    const rot = { ...emptyFilterState(), causes: new Set([1]) };
    expect(applySiteFilters(sites, rot).map((site) => site.id)).toEqual(['rot']);
    const recent = { ...emptyFilterState(), observedFrom: '2026-09-20' };
    expect(applySiteFilters(sites, recent).map((site) => site.id)).toEqual(['mrt', 'rot']);
  });
});
