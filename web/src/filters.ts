/**
 * Client side filtering of the loaded snapshot.
 *
 * Every dimension is a set of selected codes; an empty set means the
 * dimension is not filtering. A report passes when it satisfies all active
 * dimensions. Nothing here touches the DOM, so the rules are testable on
 * their own and the panel only has to hand over a state object.
 */
import { REMOVAL_PLAN_SOURCE_CODES, USER_REPORT_SOURCE_CODE } from '../../shared/tags.ts';
import type { ReportRecord } from './data/snapshot.ts';

/**
 * What the filters read. A report has these fields, and so does a plan site
 * summary point, which the data source, cause and date filters treat like the
 * plan trees it stands for.
 */
export type Filterable = Pick<
  ReportRecord,
  'causes' | 'dispositions' | 'evidence' | 'source' | 'observedAt'
>;

/**
 * Pseudo code for "no cause recorded". It is not a tag and is never stored:
 * it exists so the panel can isolate removals with no notice behind them,
 * which the spec calls out as a signal of its own. Real cause codes start at 1.
 */
export const NO_CAUSE_CODE = 0;

export interface FilterState {
  readonly causes: ReadonlySet<number>;
  readonly dispositions: ReadonlySet<number>;
  readonly evidence: ReadonlySet<number>;
  readonly sources: ReadonlySet<number>;
  /** Inclusive YYYY-MM-DD bounds on the observation date. */
  readonly observedFrom: string | null;
  readonly observedTo: string | null;
}

export function emptyFilterState(): FilterState {
  return {
    causes: new Set(),
    dispositions: new Set(),
    evidence: new Set(),
    sources: new Set(),
    observedFrom: null,
    observedTo: null,
  };
}

/**
 * What the map shows before the reader touches the panel: user reports only.
 * Imported official records, such as plan trees, are opt in through the data
 * source group, so a first look at the map is what people saw on site.
 */
export function defaultFilterState(): FilterState {
  return { ...emptyFilterState(), sources: new Set([USER_REPORT_SOURCE_CODE]) };
}

export function isFilterActive(state: FilterState): boolean {
  return (
    state.causes.size > 0 ||
    state.dispositions.size > 0 ||
    state.evidence.size > 0 ||
    state.sources.size > 0 ||
    state.observedFrom !== null ||
    state.observedTo !== null
  );
}

function matchesCauses(report: Filterable, selected: ReadonlySet<number>): boolean {
  if (selected.size === 0) {
    return true;
  }
  if (report.causes.length === 0) {
    return selected.has(NO_CAUSE_CODE);
  }
  return report.causes.some((code) => selected.has(code));
}

function matchesAny(codes: readonly number[], selected: ReadonlySet<number>): boolean {
  if (selected.size === 0) {
    return true;
  }
  return codes.some((code) => selected.has(code));
}

function matchesSingle(code: number | null, selected: ReadonlySet<number>): boolean {
  if (selected.size === 0) {
    return true;
  }
  return code !== null && selected.has(code);
}

/**
 * Date bounds compare as plain strings, which is correct for YYYY-MM-DD.
 * A report with no observation date cannot be placed on the timeline, so an
 * active bound excludes it; the panel says so next to the inputs.
 */
function matchesObserved(report: Filterable, state: FilterState): boolean {
  if (state.observedFrom === null && state.observedTo === null) {
    return true;
  }
  if (report.observedAt === null) {
    return false;
  }
  if (state.observedFrom !== null && report.observedAt < state.observedFrom) {
    return false;
  }
  if (state.observedTo !== null && report.observedAt > state.observedTo) {
    return false;
  }
  return true;
}

export function matchesFilters(report: Filterable, state: FilterState): boolean {
  return (
    matchesCauses(report, state.causes) &&
    matchesAny(report.dispositions, state.dispositions) &&
    matchesSingle(report.evidence, state.evidence) &&
    matchesSingle(report.source, state.sources) &&
    matchesObserved(report, state)
  );
}

/**
 * Plan sites under the filters. A site stands for plan trees that have no
 * point, so it belongs to neither plan source: the data source filter lets it
 * through whenever either of them is ticked, and every other dimension applies
 * as it does to the plan trees.
 */
export function applySiteFilters<T extends Filterable>(
  sites: readonly T[],
  state: FilterState,
): readonly T[] {
  if (state.sources.size > 0 && !REMOVAL_PLAN_SOURCE_CODES.some((code) => state.sources.has(code))) {
    return [];
  }
  return applyFilters(sites, { ...state, sources: new Set() });
}

export function applyFilters<T extends Filterable>(
  reports: readonly T[],
  state: FilterState,
): readonly T[] {
  if (!isFilterActive(state)) {
    return reports;
  }
  return reports.filter((report) => matchesFilters(report, state));
}

/**
 * Reports per data source under every active dimension except the data source
 * itself, so each source option tells how many reports ticking it would add.
 */
export function countBySource(
  reports: readonly ReportRecord[],
  state: FilterState,
): ReadonlyMap<number, number> {
  const counts = new Map<number, number>();
  for (const report of applyFilters(reports, { ...state, sources: new Set() })) {
    if (report.source !== null) {
      counts.set(report.source, (counts.get(report.source) ?? 0) + 1);
    }
  }
  return counts;
}
