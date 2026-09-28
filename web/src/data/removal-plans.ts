/**
 * Decode /removal-plans.json: which Parks Office plan each imported report
 * comes from, and what that plan intends to do to the tree.
 *
 * The snapshot row of a plan tree carries the report fields only. The plan's
 * title, review status and page, and whether the tree is to be removed or
 * transplanted, arrive in this separate file keyed by report id, and are
 * attached to the report records once both have loaded. A report the file
 * does not name keeps working; its card simply cannot name the plan.
 */
import type { ReportRecord } from './snapshot.ts';
import type { Row } from './columns.ts';
import { DecodeError, asText, buildColumnIndex, cell, isRecord } from './columns.ts';

export const PLAN_COLUMNS = ['id', 'case', 'action'] as const;

export const PLAN_ACTIONS = ['remove', 'transplant'] as const;
export type PlanAction = (typeof PLAN_ACTIONS)[number];

export const PLAN_STATUSES = ['approved', 'under_review', 'unclear'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** The plan behind one imported report. */
export interface RemovalPlanRef {
  readonly title: string;
  readonly status: PlanStatus;
  /** The case page on pkl.gov.taipei. */
  readonly url: string;
  readonly action: PlanAction;
}

export type RemovalPlanIndex = ReadonlyMap<string, RemovalPlanRef>;

function isOneOf<T extends string>(values: readonly T[], value: string | null): value is T {
  return value !== null && (values as readonly string[]).includes(value);
}

interface CaseEntry {
  readonly title: string;
  readonly status: PlanStatus;
  readonly url: string;
}

function decodeCases(value: unknown): Map<string, CaseEntry> {
  if (!isRecord(value)) {
    throw new DecodeError('removal plans: cases must be an object');
  }
  const cases = new Map<string, CaseEntry>();
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      continue;
    }
    const title = asText(entry.title);
    const status = asText(entry.status);
    const url = asText(entry.url);
    if (title === null || url === null || !isOneOf(PLAN_STATUSES, status)) {
      continue;
    }
    cases.set(key, { title, status, url });
  }
  return cases;
}

export function decodeRemovalPlans(payload: unknown): RemovalPlanIndex {
  if (!isRecord(payload)) {
    throw new DecodeError('removal plans: payload must be an object');
  }
  const cases = decodeCases(payload.cases);
  const index = buildColumnIndex(payload.columns, PLAN_COLUMNS, 'removal plans');
  const rows = payload.rows;
  if (!Array.isArray(rows)) {
    throw new DecodeError('removal plans: rows must be an array');
  }

  const plans = new Map<string, RemovalPlanRef>();
  for (const entry of rows) {
    if (!Array.isArray(entry)) {
      continue;
    }
    const row = entry as Row;
    const id = asText(cell(row, index, 'id'));
    const action = asText(cell(row, index, 'action'));
    const plan = cases.get(asText(cell(row, index, 'case')) ?? '');
    if (id === null || plan === undefined || !isOneOf(PLAN_ACTIONS, action)) {
      continue;
    }
    plans.set(id, { ...plan, action });
  }
  return plans;
}

/** The same records, each with its plan when the index names one. */
export function attachPlans(
  reports: readonly ReportRecord[],
  plans: RemovalPlanIndex | null,
): readonly ReportRecord[] {
  if (plans === null || plans.size === 0) {
    return reports;
  }
  return reports.map((report) => {
    const plan = plans.get(report.id);
    return plan === undefined ? report : { ...report, plan };
  });
}
