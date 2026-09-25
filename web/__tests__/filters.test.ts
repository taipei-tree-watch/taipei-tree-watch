import { describe, expect, it } from 'vitest';

import type { ReportRecord } from '../src/data/snapshot.ts';
import type { FilterState } from '../src/filters.ts';
import { NO_CAUSE_CODE, applyFilters, emptyFilterState, isFilterActive, matchesFilters } from '../src/filters.ts';

function report(overrides: Partial<ReportRecord> = {}): ReportRecord {
  return {
    id: 'r1',
    lat: 25.03,
    lng: 121.54,
    species: null,
    causes: [1],
    dispositions: [3],
    evidence: 1,
    source: 1,
    note: null,
    link: null,
    observedAt: '2026-06-15',
    protectedTreeId: null,
    inventoryTreeId: null,
    createdAt: '2026-06-16T00:00:00Z',
    ...overrides,
  };
}

function state(overrides: Partial<FilterState> = {}): FilterState {
  return { ...emptyFilterState(), ...overrides };
}

describe('isFilterActive', () => {
  it('is false for an untouched panel and true once any dimension is set', () => {
    expect(isFilterActive(emptyFilterState())).toBe(false);
    expect(isFilterActive(state({ causes: new Set([1]) }))).toBe(true);
    expect(isFilterActive(state({ observedTo: '2026-01-01' }))).toBe(true);
  });
});

describe('matchesFilters', () => {
  it('passes everything when no dimension is selected', () => {
    expect(matchesFilters(report(), emptyFilterState())).toBe(true);
  });

  it('filters on cause', () => {
    expect(matchesFilters(report({ causes: [1] }), state({ causes: new Set([1]) }))).toBe(true);
    expect(matchesFilters(report({ causes: [21] }), state({ causes: new Set([1]) }))).toBe(false);
  });

  it('treats reports with no cause as their own option', () => {
    const noCause = state({ causes: new Set([NO_CAUSE_CODE]) });

    expect(matchesFilters(report({ causes: [] }), noCause)).toBe(true);
    expect(matchesFilters(report({ causes: [1] }), noCause)).toBe(false);
    expect(matchesFilters(report({ causes: [] }), state({ causes: new Set([1]) }))).toBe(false);
  });

  it('filters on disposition', () => {
    expect(
      matchesFilters(report({ dispositions: [3, 6] }), state({ dispositions: new Set([6]) })),
    ).toBe(true);
    expect(matchesFilters(report({ dispositions: [3] }), state({ dispositions: new Set([6]) }))).toBe(
      false,
    );
  });

  it('filters on evidence source', () => {
    expect(matchesFilters(report({ evidence: 3 }), state({ evidence: new Set([3]) }))).toBe(true);
    expect(matchesFilters(report({ evidence: 6 }), state({ evidence: new Set([3]) }))).toBe(false);
  });

  it('includes both ends of the observation date range', () => {
    const range = state({ observedFrom: '2026-06-01', observedTo: '2026-06-30' });

    expect(matchesFilters(report({ observedAt: '2026-06-01' }), range)).toBe(true);
    expect(matchesFilters(report({ observedAt: '2026-06-30' }), range)).toBe(true);
    expect(matchesFilters(report({ observedAt: '2026-05-31' }), range)).toBe(false);
    expect(matchesFilters(report({ observedAt: '2026-07-01' }), range)).toBe(false);
  });

  it('drops reports with no observation date once a bound is set', () => {
    const undated = report({ observedAt: null });

    expect(matchesFilters(undated, emptyFilterState())).toBe(true);
    expect(matchesFilters(undated, state({ observedFrom: '2026-01-01' }))).toBe(false);
    expect(matchesFilters(undated, state({ observedTo: '2026-12-31' }))).toBe(false);
  });

  it('requires every active dimension to match', () => {
    const both = state({ causes: new Set([1]), dispositions: new Set([6]) });

    expect(matchesFilters(report({ causes: [1], dispositions: [6] }), both)).toBe(true);
    expect(matchesFilters(report({ causes: [1], dispositions: [3] }), both)).toBe(false);
  });
});

describe('applyFilters', () => {
  it('returns the input untouched when nothing is selected', () => {
    const reports = [report({ id: 'a' }), report({ id: 'b' })];

    expect(applyFilters(reports, emptyFilterState())).toBe(reports);
  });

  it('keeps only the matching reports', () => {
    const reports = [report({ id: 'a', causes: [1] }), report({ id: 'b', causes: [21] })];
    const kept = applyFilters(reports, state({ causes: new Set([21]) }));

    expect(kept.map((entry) => entry.id)).toEqual(['b']);
  });
});
