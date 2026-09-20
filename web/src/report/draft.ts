/**
 * The report form as data: field values, the rules that constrain them, and
 * the request body they turn into.
 *
 * Every rule here mirrors one of the server-side checks in TECH-SPEC section
 * 6 and calls the same shared/validation.ts function the Worker calls. The
 * server remains the only enforcement point; this module exists so the form
 * can disable the submit button and point at the offending field first.
 *
 * Issues are reported as codes rather than sentences, so this file stays
 * ASCII and the UI owns every string a reader sees.
 */
import {
  DEFAULT_EVIDENCE_CODE,
  EVIDENCE_CODES_WITHOUT_CAUSES,
  type EvidenceCode,
} from '../../../shared/tags.ts';
import type { Bbox } from '../../../shared/validation.ts';
import {
  NOTE_MAX_CHARS,
  SPECIES_MAX_CHARS,
  countCharacters,
  isAllowedLink,
  isInsideBbox,
  isInventoryTreeId,
  isObservedDateInRange,
  isProtectedTreeId,
  normalizeInventoryTreeId,
  roundCoordinate,
  stripUrls,
} from '../../../shared/validation.ts';
import { linkHostname } from '../format.ts';

/** Below this zoom the crosshair cannot be aimed at a single tree. */
export const MIN_SUBMIT_ZOOM = 18;

/** Free-text and code selections exactly as the form holds them. */
export interface ReportDraft {
  readonly species: string;
  readonly causes: readonly number[];
  readonly dispositions: readonly number[];
  readonly evidence: number;
  readonly note: string;
  readonly link: string;
  readonly observedAt: string;
  readonly protectedTreeId: string;
  readonly inventoryTreeId: string;
}

/** Where the crosshair currently sits. */
export interface PickedView {
  readonly lat: number;
  readonly lng: number;
  readonly zoom: number;
}

export function emptyDraft(): ReportDraft {
  return {
    species: '',
    causes: [],
    dispositions: [],
    evidence: DEFAULT_EVIDENCE_CODE,
    note: '',
    link: '',
    observedAt: '',
    protectedTreeId: '',
    inventoryTreeId: '',
  };
}

const EVIDENCE_WITHOUT_CAUSES: ReadonlySet<number> = new Set(EVIDENCE_CODES_WITHOUT_CAUSES);

/**
 * False when the chosen evidence source states no cause, in which case the
 * cause block is collapsed and any earlier selection is dropped.
 */
export function causesAllowed(evidence: number): boolean {
  return !EVIDENCE_WITHOUT_CAUSES.has(evidence);
}

/** Switch evidence source, clearing causes when the new source allows none. */
export function withEvidence(draft: ReportDraft, evidence: EvidenceCode): ReportDraft {
  return {
    ...draft,
    evidence,
    causes: causesAllowed(evidence) ? draft.causes : [],
  };
}

/** Why the submit button is disabled, or null when the point is usable. */
export type SubmitBlock = 'zoom' | 'bbox' | null;

/**
 * Zoom as the form displays it, to one decimal. The map's zoom buttons land on
 * values such as 17.9999, which the sheet shows as 18.0; comparing the rounded
 * value keeps the threshold consistent with what the reporter reads.
 */
export function displayedZoom(zoom: number): number {
  return Math.round(zoom * 10) / 10;
}

export function submitBlock(view: PickedView, bbox: Bbox): SubmitBlock {
  if (!isInsideBbox(bbox, view.lat, view.lng)) {
    return 'bbox';
  }
  if (displayedZoom(view.zoom) < MIN_SUBMIT_ZOOM) {
    return 'zoom';
  }
  return null;
}

export type DraftIssueCode =
  | 'speciesLength'
  | 'noteLength'
  | 'linkDomain'
  | 'observedRange'
  | 'protectedTreeId'
  | 'inventoryTreeId';

export interface DraftIssue {
  /** Request body field name, so an API error lands on the same element. */
  readonly field: string;
  readonly code: DraftIssueCode;
}

/** Trim a field and treat the empty result as absent, as the Worker does. */
function textOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * What the live link check adds beside the field.
 *
 * Only an accepted domain is named here. A rejected domain is reported once,
 * by the field error `draftIssues` raises for it, so that the hint and the
 * error do not state the same refusal twice.
 */
export type LinkFeedback =
  | { readonly kind: 'idle' }
  | { readonly kind: 'accepted'; readonly domain: string };

export function linkFeedback(value: string): LinkFeedback {
  const link = textOrNull(value);
  if (link === null || !isAllowedLink(link)) {
    return { kind: 'idle' };
  }
  return { kind: 'accepted', domain: linkHostname(link) ?? '' };
}

/**
 * Field-level problems the form can see without asking the server.
 * `today` is the Asia/Taipei date, which the caller reads once per render.
 */
export function draftIssues(draft: ReportDraft, today: string): readonly DraftIssue[] {
  const issues: DraftIssue[] = [];

  const species = textOrNull(draft.species);
  if (species !== null && countCharacters(species) > SPECIES_MAX_CHARS) {
    issues.push({ field: 'species', code: 'speciesLength' });
  }

  const note = textOrNull(stripUrls(draft.note));
  if (note !== null && countCharacters(note) > NOTE_MAX_CHARS) {
    issues.push({ field: 'note', code: 'noteLength' });
  }

  const link = textOrNull(draft.link);
  if (link !== null && !isAllowedLink(link)) {
    issues.push({ field: 'link', code: 'linkDomain' });
  }

  const observedAt = textOrNull(draft.observedAt);
  if (observedAt !== null && !isObservedDateInRange(observedAt, today)) {
    issues.push({ field: 'observed_at', code: 'observedRange' });
  }

  const protectedTreeId = textOrNull(draft.protectedTreeId);
  if (protectedTreeId !== null && !isProtectedTreeId(protectedTreeId)) {
    issues.push({ field: 'protected_tree_id', code: 'protectedTreeId' });
  }

  const inventoryTreeId = textOrNull(draft.inventoryTreeId);
  if (inventoryTreeId !== null && !isInventoryTreeId(inventoryTreeId)) {
    issues.push({ field: 'inventory_tree_id', code: 'inventoryTreeId' });
  }

  return issues;
}

/**
 * The POST /api/reports body.
 *
 * `source` is left out: the Worker forces the user-report code and its schema
 * rejects unknown keys, so sending nothing is both accepted and honest about
 * who decides. Causes are emptied here as well as in the form, so a stale
 * selection can never survive an evidence switch.
 */
export function buildRequestBody(
  draft: ReportDraft,
  view: PickedView,
  turnstileToken: string,
): Record<string, unknown> {
  const inventoryTreeId = textOrNull(draft.inventoryTreeId);

  return {
    turnstile_token: turnstileToken,
    lat: roundCoordinate(view.lat),
    lng: roundCoordinate(view.lng),
    species: textOrNull(draft.species),
    causes: causesAllowed(draft.evidence) ? [...draft.causes] : [],
    dispositions: [...draft.dispositions],
    evidence: draft.evidence,
    note: textOrNull(stripUrls(draft.note)),
    link: textOrNull(draft.link),
    observed_at: textOrNull(draft.observedAt),
    protected_tree_id: textOrNull(draft.protectedTreeId),
    inventory_tree_id:
      inventoryTreeId === null ? null : normalizeInventoryTreeId(inventoryTreeId),
  };
}
