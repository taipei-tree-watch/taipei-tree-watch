/**
 * Decode the site summary points of /removal-plans.json.
 *
 * Most trees in the Parks Office plans have no point of their own: the plan
 * names only the site, such as a park or a works compound. Each such site is
 * one point chosen by hand, carrying how many trees the plan removes or
 * transplants there and of which species. A site is an aggregate of plan
 * records, never a report, so it has no report id and is not in the snapshot.
 *
 * The `inventory_gone` column is optional as well. The file's `site_columns`
 * and `sites` are optional: an index without them
 * decodes to no sites, and a site whose case the file does not name is left
 * out, because its card could not say which plan it comes from.
 */
import type {
  CauseCode,
  DispositionCode,
  EvidenceCode,
  SourceCode,
} from '../../../shared/tags.ts';
import { REMOVAL_PLAN_SOURCE_CODES, evidence } from '../../../shared/tags.ts';
import type { Row } from './columns.ts';
import {
  DecodeError,
  asFiniteNumber,
  asText,
  buildColumnIndex,
  cell,
  isRecord,
} from './columns.ts';
import type { PlanStatus } from './removal-plans.ts';
import { PLAN_STATUSES } from './removal-plans.ts';

export const SITE_COLUMNS = [
  'id',
  'case',
  'lat',
  'lng',
  'via',
  'locations',
  'remove',
  'transplant',
  'species',
  'placed',
  'causes',
] as const;

/** How the point was chosen; the card has a sentence for each. */
export const SITE_VIA = [
  'park-centroid',
  'school-centroid',
  'site-centroid',
  'placed-trees',
  'road-segment',
  'intersection',
  'address',
  'site-plan',
] as const;
export type SiteVia = (typeof SITE_VIA)[number];

/** Lower case letters, digits and dashes, as the pipeline enforces. */
export const SITE_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;

const OFFICIAL_DOCUMENT_CODE: EvidenceCode | null =
  evidence.find((tag) => tag.slug === 'official-document')?.code ?? null;

export interface CauseCount {
  readonly code: CauseCode;
  /** How many of the site's trees the plan gives this cause for. */
  readonly count: number;
}

export interface SpeciesCount {
  /** Null when the plan does not name the species. */
  readonly name: string | null;
  readonly count: number;
}

/**
 * One site. The filter fields mirror a report's so the cause and date filters
 * treat a site like the plan trees it stands for; `source` is the plan source
 * for labelling, and `siteFilterState` decides when the data source filter
 * lets a site through.
 */
export interface PlanSite {
  readonly id: string;
  readonly lat: number;
  readonly lng: number;
  readonly via: SiteVia;
  /** The plan's own location texts this point covers. */
  readonly locations: readonly string[];
  readonly remove: number;
  readonly transplant: number;
  readonly species: readonly SpeciesCount[];
  /** Trees of the same case and location already drawn one by one. */
  readonly placed: number;
  /**
   * How many members' tags have left the Parks Office inventory, and the
   * inventory version; null when none has. A signal only.
   */
  readonly inventoryGone: { readonly count: number; readonly date: string } | null;
  readonly title: string;
  readonly status: PlanStatus;
  readonly url: string;
  /** Every cause code any member carries, for the filter and the colour. */
  readonly causes: readonly CauseCode[];
  readonly causeCounts: readonly CauseCount[];
  readonly dispositions: readonly DispositionCode[];
  readonly evidence: EvidenceCode | null;
  readonly source: SourceCode;
  /** The plan's posting date, which the date filter reads like an observation date. */
  readonly observedAt: string | null;
}

interface SiteCase {
  readonly title: string;
  readonly status: PlanStatus;
  readonly url: string;
  readonly postedAt: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isOneOf<T extends string>(values: readonly T[], value: string | null): value is T {
  return value !== null && (values as readonly string[]).includes(value);
}

function asCount(value: unknown): number | null {
  const number = asFiniteNumber(value);
  return number !== null && Number.isInteger(number) && number >= 0 ? number : null;
}

function decodeCases(value: unknown): Map<string, SiteCase> {
  const cases = new Map<string, SiteCase>();
  if (!isRecord(value)) {
    return cases;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      continue;
    }
    const title = asText(entry.title);
    const status = asText(entry.status);
    const url = asText(entry.url);
    const posted = asText(entry.posted_at);
    if (title === null || url === null || !isOneOf(PLAN_STATUSES, status)) {
      continue;
    }
    cases.set(key, {
      title,
      status,
      url,
      postedAt: posted !== null && ISO_DATE.test(posted) ? posted : null,
    });
  }
  return cases;
}

function decodeSpecies(value: unknown): SpeciesCount[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const species: SpeciesCount[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry)) {
      continue;
    }
    const count = asCount(entry[1]);
    if (count === null || count === 0) {
      continue;
    }
    species.push({ name: asText(entry[0]), count });
  }
  return species;
}

function decodeCauses(value: unknown): CauseCount[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const causes: CauseCount[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry)) {
      continue;
    }
    const code = asCount(entry[0]);
    const count = asCount(entry[1]);
    if (code === null || count === null || count === 0) {
      continue;
    }
    causes.push({ code: code as CauseCode, count });
  }
  return causes;
}

function decodeGone(value: unknown): PlanSite['inventoryGone'] {
  if (!Array.isArray(value)) {
    return null;
  }
  const count = asCount(value[0]);
  const date = asText(value[1]);
  if (count === null || count === 0 || date === null || !ISO_DATE.test(date)) {
    return null;
  }
  return { count, date };
}

function decodeLocations(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(asText).filter((text): text is string => text !== null);
}

export function decodePlanSites(payload: unknown): readonly PlanSite[] {
  if (!isRecord(payload)) {
    throw new DecodeError('plan sites: payload must be an object');
  }
  if (payload.sites === undefined) {
    return [];
  }
  const rows = payload.sites;
  if (!Array.isArray(rows)) {
    throw new DecodeError('plan sites: sites must be an array');
  }
  const index = buildColumnIndex(payload.site_columns, SITE_COLUMNS, 'plan sites');
  const cases = decodeCases(payload.cases);

  const sites: PlanSite[] = [];
  const seen = new Set<string>();
  for (const entry of rows) {
    if (!Array.isArray(entry)) {
      continue;
    }
    const row = entry as Row;
    const id = asText(cell(row, index, 'id'));
    const plan = cases.get(asText(cell(row, index, 'case')) ?? '');
    const lat = asFiniteNumber(cell(row, index, 'lat'));
    const lng = asFiniteNumber(cell(row, index, 'lng'));
    const via = asText(cell(row, index, 'via'));
    const remove = asCount(cell(row, index, 'remove'));
    const transplant = asCount(cell(row, index, 'transplant'));
    if (
      id === null ||
      !SITE_ID.test(id) ||
      seen.has(id) ||
      plan === undefined ||
      lat === null ||
      lng === null ||
      !isOneOf(SITE_VIA, via) ||
      remove === null ||
      transplant === null ||
      remove + transplant === 0
    ) {
      continue;
    }
    seen.add(id);
    const causeCounts = decodeCauses(cell(row, index, 'causes'));
    sites.push({
      id,
      lat,
      lng,
      via,
      locations: decodeLocations(cell(row, index, 'locations')),
      remove,
      transplant,
      species: decodeSpecies(cell(row, index, 'species')),
      placed: asCount(cell(row, index, 'placed')) ?? 0,
      inventoryGone: decodeGone(cell(row, index, 'inventory_gone')),
      title: plan.title,
      status: plan.status,
      url: plan.url,
      causes: causeCounts.map((entry) => entry.code),
      causeCounts,
      dispositions: [],
      evidence: OFFICIAL_DOCUMENT_CODE,
      source: REMOVAL_PLAN_SOURCE_CODES[0],
      observedAt: plan.postedAt,
    });
  }
  return sites;
}

/** How many plan trees a site stands for. */
export function siteTreeCount(site: PlanSite): number {
  return site.remove + site.transplant;
}
