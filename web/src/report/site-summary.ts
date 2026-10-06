/**
 * What a plan site's card says, as plain rows, so the wording can be tested
 * without a DOM.
 *
 * A site stands for every tree a plan lists at one location without a point
 * of its own. The card leads with that: the point marks the site, not a tree,
 * and nothing has been seen removed. Counts come straight from the plan.
 */
import { causes } from '../../../shared/tags.ts';
import type { PlanSite, SpeciesCount } from '../data/plan-sites.ts';
import { siteTreeCount } from '../data/plan-sites.ts';
import { formatTemplate, labelForCode } from '../format.ts';
import strings from '../ui-strings.json';
import type { SummaryRow } from './summary.ts';

/** Species named one by one before the rest are folded into a single item. */
export const SPECIES_LISTED = 6;

export interface SiteSummary {
  readonly caveat: string;
  readonly headline: string;
  readonly rows: readonly SummaryRow[];
  /** Members whose tags have left the Parks Office inventory: a signal only. */
  readonly inventory: string | null;
  /** Other trees of the same location that have a point of their own. */
  readonly placed: string | null;
}

export function siteHeadline(site: PlanSite): string {
  if (site.transplant === 0) {
    return formatTemplate(strings.site.headlineRemove, { count: site.remove });
  }
  if (site.remove === 0) {
    return formatTemplate(strings.site.headlineTransplant, { count: site.transplant });
  }
  return formatTemplate(strings.site.headlineBoth, {
    remove: site.remove,
    transplant: site.transplant,
  });
}

function speciesItem(entry: SpeciesCount): string {
  return formatTemplate(strings.site.speciesItem, {
    name: entry.name ?? strings.site.speciesUnnamed,
    count: entry.count,
  });
}

/** The most common species, then one item for the rest; an unnamed species stays last. */
export function speciesBreakdown(species: readonly SpeciesCount[]): string | null {
  if (species.length === 0) {
    return null;
  }
  const named = species.filter((entry) => entry.name !== null);
  const unnamed = species.filter((entry) => entry.name === null);
  const shown = named.slice(0, SPECIES_LISTED);
  const rest = named.slice(SPECIES_LISTED);
  const items = shown.map(speciesItem);
  if (rest.length > 0) {
    items.push(
      formatTemplate(strings.site.speciesOther, {
        kinds: rest.length,
        count: rest.reduce((sum, entry) => sum + entry.count, 0),
      }),
    );
  }
  items.push(...unnamed.map(speciesItem));
  return items.join(strings.card.listSeparator);
}

function causeBreakdown(site: PlanSite): string | null {
  const items = site.causeCounts
    .map((entry) => {
      const label = labelForCode(causes, entry.code);
      return label === null
        ? null
        : formatTemplate(strings.site.causeItem, { label, count: entry.count });
    })
    .filter((item): item is string => item !== null);
  return items.length === 0 ? null : items.join(strings.card.listSeparator);
}

/**
 * The plan's location texts, leaving out one that is only a cut-off copy of
 * another (「北市松仁路旁人行」 next to 「北市松仁路旁人行道」).
 */
export function locationText(locations: readonly string[]): string {
  return locations
    .filter((text) => !locations.some((other) => other !== text && other.startsWith(text)))
    .join(strings.card.listSeparator);
}

function row(label: string, value: string | null, href?: string): SummaryRow | null {
  if (value === null || value.length === 0) {
    return null;
  }
  return href === undefined ? { label, value } : { label, value, href };
}

export function siteSummary(site: PlanSite): SiteSummary {
  const candidates: readonly (SummaryRow | null)[] = [
    row(strings.site.location, locationText(site.locations)),
    row(strings.site.species, speciesBreakdown(site.species)),
    row(strings.site.causes, causeBreakdown(site)),
    row(
      strings.card.source,
      // A site's trees have no point, so neither plan source label (plan
      // coordinate, inventory position) describes it.
      formatTemplate(strings.card.sourcePlanValue, { source: strings.site.source, title: site.title }),
      site.url,
    ),
    row(strings.card.planStatus, strings.planStatus[site.status]),
    row(strings.card.postedAt, site.observedAt),
    row(strings.site.point, strings.site.via[site.via]),
  ];
  return {
    caveat: strings.site.caveat,
    headline: siteHeadline(site),
    inventory:
      site.inventoryGone === null
        ? null
        : formatTemplate(strings.site.inventoryGone, site.inventoryGone),
    rows: candidates.filter((entry): entry is SummaryRow => entry !== null),
    placed: site.placed > 0 ? formatTemplate(strings.site.placed, { count: site.placed }) : null,
  };
}

/** Other sites drawn on exactly the same point, which a tap could not tell apart. */
export function sitesAtSamePoint(site: PlanSite, all: readonly PlanSite[]): readonly PlanSite[] {
  return all.filter(
    (other) => other.id !== site.id && other.lat === site.lat && other.lng === site.lng,
  );
}

export function sameSpotItem(site: PlanSite): string {
  return formatTemplate(strings.site.sameSpotItem, {
    title: site.title,
    count: siteTreeCount(site),
  });
}
