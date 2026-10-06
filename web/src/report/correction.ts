/**
 * A correction as data: the fields it may change, what the reader has changed
 * so far, the rules the Worker will apply, and the request that carries it.
 *
 * The rules mirror TECH-SPEC 6.1 and use the same shared functions as the
 * Worker, which stays the only enforcement point. Only fields that differ
 * from the report's current value are sent, compared in the stored form the
 * Worker compares them in, so a correction that changes nothing is caught
 * here rather than bounced by the server.
 */
import { haversineMeters } from '../../../shared/geo.ts';
import type { CorrectableValues, RevisionChanges } from '../../../shared/revisions.ts';
import {
  CORRECTION_MAX_DISTANCE_M,
  REASON_MAX_CHARS,
  changedFields,
  sameFieldValue,
  sortedCodes,
} from '../../../shared/revisions.ts';
import type { CauseCode, EvidenceCode } from '../../../shared/tags.ts';
import {
  DEFAULT_EVIDENCE_CODE,
  causes as causeTags,
  evidence as evidenceTags,
} from '../../../shared/tags.ts';
import type { Bbox } from '../../../shared/validation.ts';
import {
  SPECIES_MAX_CHARS,
  countCharacters,
  isAllowedLink,
  isInventoryTreeId,
  isProtectedTreeId,
  normalizeInventoryTreeId,
  roundCoordinate,
  stripUrls,
} from '../../../shared/validation.ts';
import type { ReportRecord } from '../data/snapshot.ts';
import { formatTemplate, labelForCode, labelsForCodes } from '../format.ts';
import strings from '../ui-strings.json';
import type { PickedView } from './draft.ts';
import { causesAllowed, submitBlock } from './draft.ts';
import type { FetchLike } from './submit.ts';
import { readJson } from './submit.ts';

export interface CorrectionDraft {
  readonly species: string;
  readonly causes: readonly number[];
  readonly evidence: number;
  readonly protectedTreeId: string;
  readonly inventoryTreeId: string;
  readonly reason: string;
  readonly link: string;
}

/** The report's current value in the form the Worker compares against. */
export function currentValues(report: ReportRecord): CorrectableValues {
  return {
    lat: report.lat,
    lng: report.lng,
    species: report.species,
    causes: report.causes,
    evidence: report.evidence ?? DEFAULT_EVIDENCE_CODE,
    protected_tree_id: report.protectedTreeId,
    inventory_tree_id: report.inventoryTreeId,
  };
}

export function correctionDraftFrom(report: ReportRecord): CorrectionDraft {
  return {
    species: report.species ?? '',
    causes: [...report.causes],
    evidence: report.evidence ?? DEFAULT_EVIDENCE_CODE,
    protectedTreeId: report.protectedTreeId ?? '',
    inventoryTreeId: report.inventoryTreeId ?? '',
    reason: '',
    link: '',
  };
}

function textOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** How far the crosshair is from where the report stands now, in metres. */
export function moveDistance(report: ReportRecord, view: PickedView): number {
  return haversineMeters(report, {
    lat: roundCoordinate(view.lat),
    lng: roundCoordinate(view.lng),
  });
}

/**
 * The fields the draft changes, with their values in stored form. `location`
 * is the point the reader aimed at, or null when the position stays.
 */
export function correctionChanges(
  draft: CorrectionDraft,
  report: ReportRecord,
  location: PickedView | null,
): RevisionChanges {
  const current = currentValues(report);
  const changes: Record<string, unknown> = {};

  if (location !== null) {
    const lat = roundCoordinate(location.lat);
    const lng = roundCoordinate(location.lng);
    if (lat !== current.lat || lng !== current.lng) {
      changes.lat = lat;
      changes.lng = lng;
    }
  }

  const inventory = textOrNull(draft.inventoryTreeId);
  const candidates = {
    species: textOrNull(draft.species),
    causes: causesAllowed(draft.evidence) ? sortedCodes(draft.causes as CauseCode[]) : [],
    evidence: draft.evidence as EvidenceCode,
    protected_tree_id: textOrNull(draft.protectedTreeId),
    inventory_tree_id: inventory === null ? null : normalizeInventoryTreeId(inventory),
  } as const;
  for (const field of Object.keys(candidates) as (keyof typeof candidates)[]) {
    const value = candidates[field];
    if (!sameFieldValue(field, value, current[field])) {
      changes[field] = value;
    }
  }
  return changes as RevisionChanges;
}

export type CorrectionIssueCode =
  | 'noChanges'
  | 'zoom'
  | 'bbox'
  | 'tooFar'
  | 'speciesLength'
  | 'protectedTreeId'
  | 'inventoryTreeId'
  | 'reasonMissing'
  | 'reasonLength'
  | 'linkDomain';

export interface CorrectionIssue {
  /** Request field the issue belongs to, so a server error lands on the same element. */
  readonly field: string;
  readonly code: CorrectionIssueCode;
}

/** Why an aimed point cannot be the corrected position, or null when it can. */
export function locationIssue(
  report: ReportRecord,
  view: PickedView,
  bbox: Bbox,
): 'zoom' | 'bbox' | 'tooFar' | null {
  const block = submitBlock(view, bbox);
  if (block !== null) {
    return block;
  }
  return moveDistance(report, view) > CORRECTION_MAX_DISTANCE_M ? 'tooFar' : null;
}

/** Everything that keeps the submit button disabled, in the order the form shows it. */
export function correctionIssues(
  draft: CorrectionDraft,
  report: ReportRecord,
  location: PickedView | null,
  bbox: Bbox,
): readonly CorrectionIssue[] {
  const issues: CorrectionIssue[] = [];

  if (location !== null) {
    const issue = locationIssue(report, location, bbox);
    if (issue !== null) {
      issues.push({ field: 'lat', code: issue });
    }
  }

  const species = textOrNull(draft.species);
  if (species !== null && countCharacters(species) > SPECIES_MAX_CHARS) {
    issues.push({ field: 'species', code: 'speciesLength' });
  }
  const protectedTreeId = textOrNull(draft.protectedTreeId);
  if (protectedTreeId !== null && !isProtectedTreeId(protectedTreeId)) {
    issues.push({ field: 'protected_tree_id', code: 'protectedTreeId' });
  }
  const inventoryTreeId = textOrNull(draft.inventoryTreeId);
  if (inventoryTreeId !== null && !isInventoryTreeId(inventoryTreeId)) {
    issues.push({ field: 'inventory_tree_id', code: 'inventoryTreeId' });
  }

  const reason = stripUrls(draft.reason.trim());
  if (reason === '') {
    issues.push({ field: 'reason', code: 'reasonMissing' });
  } else if (countCharacters(reason) > REASON_MAX_CHARS) {
    issues.push({ field: 'reason', code: 'reasonLength' });
  }
  const link = textOrNull(draft.link);
  if (link !== null && !isAllowedLink(link)) {
    issues.push({ field: 'link', code: 'linkDomain' });
  }

  if (changedFields(correctionChanges(draft, report, location)).length === 0) {
    issues.push({ field: 'changes', code: 'noChanges' });
  }
  return issues;
}

export function buildCorrectionBody(
  draft: CorrectionDraft,
  changes: RevisionChanges,
  baseRevisionId: string | null,
  turnstileToken: string,
): Record<string, unknown> {
  return {
    turnstile_token: turnstileToken,
    base_revision_id: baseRevisionId,
    changes,
    reason: stripUrls(draft.reason.trim()),
    link: textOrNull(draft.link),
  };
}

export type CorrectionOutcome =
  | { readonly kind: 'created'; readonly id: string }
  | { readonly kind: 'rejected'; readonly fields: readonly string[] }
  /** Someone else corrected the report since this page loaded it. */
  | { readonly kind: 'conflict' }
  /** The report is gone or cannot be corrected. */
  | { readonly kind: 'missing' }
  | { readonly kind: 'turnstile' }
  | { readonly kind: 'network' };

export function revisionsUrl(reportId: string): string {
  return `/api/reports/${encodeURIComponent(reportId)}/revisions`;
}

function errorFields(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null) {
    return [];
  }
  const errors = (payload as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) {
    return [];
  }
  return errors
    .map((entry: unknown) =>
      typeof entry === 'object' && entry !== null ? (entry as { field?: unknown }).field : null,
    )
    .filter((field): field is string => typeof field === 'string');
}

export async function submitCorrection(
  reportId: string,
  body: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<CorrectionOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(revisionsUrl(reportId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error('correction request failed', error);
    return { kind: 'network' };
  }

  if (response.status === 201) {
    const payload = await readJson(response);
    const id = (payload as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || id === '') {
      console.error('correction accepted without an id');
      return { kind: 'network' };
    }
    return { kind: 'created', id };
  }
  if (response.status === 409) {
    return { kind: 'conflict' };
  }
  if (response.status === 404) {
    return { kind: 'missing' };
  }
  if (response.status === 403) {
    return { kind: 'turnstile' };
  }
  if (response.status === 400 || response.status === 413) {
    const fields = errorFields(await readJson(response));
    console.warn('correction rejected', fields);
    return { kind: 'rejected', fields };
  }
  console.error(`correction request returned HTTP ${String(response.status)}`);
  return { kind: 'network' };
}

export interface RevisionLine {
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

function shown(value: string | null | undefined): string {
  return value === null || value === undefined || value === '' ? strings.revisions.empty : value;
}

function causeText(codes: readonly number[] | undefined): string {
  const labels = labelsForCodes(causeTags, codes ?? []);
  return labels.length === 0 ? strings.revisions.empty : labels.join(strings.card.listSeparator);
}

/** "What changed from what to what" for one revision, one line per field. */
export function describeRevision(
  changes: RevisionChanges,
  previous: RevisionChanges,
): readonly RevisionLine[] {
  const lines: RevisionLine[] = [];
  if (
    changes.lat !== undefined &&
    changes.lng !== undefined &&
    previous.lat !== undefined &&
    previous.lng !== undefined
  ) {
    const distance = haversineMeters(
      { lat: previous.lat, lng: previous.lng },
      { lat: changes.lat, lng: changes.lng },
    );
    lines.push({
      label: strings.revisions.fields.location,
      from: strings.revisions.locationFrom,
      to: formatTemplate(strings.revisions.locationMoved, { distance: distance.toFixed(0) }),
    });
  }
  if ('species' in changes) {
    lines.push({
      label: strings.revisions.fields.species,
      from: shown(previous.species),
      to: shown(changes.species),
    });
  }
  if ('evidence' in changes) {
    lines.push({
      label: strings.revisions.fields.evidence,
      from: shown(labelForCode(evidenceTags, previous.evidence ?? null)),
      to: shown(labelForCode(evidenceTags, changes.evidence ?? null)),
    });
  }
  if ('causes' in changes) {
    lines.push({
      label: strings.revisions.fields.causes,
      from: causeText(previous.causes),
      to: causeText(changes.causes),
    });
  }
  if ('protected_tree_id' in changes) {
    lines.push({
      label: strings.revisions.fields.protectedTreeId,
      from: shown(previous.protected_tree_id),
      to: shown(changes.protected_tree_id),
    });
  }
  if ('inventory_tree_id' in changes) {
    lines.push({
      label: strings.revisions.fields.inventoryTreeId,
      from: shown(previous.inventory_tree_id),
      to: shown(changes.inventory_tree_id),
    });
  }
  return lines;
}
