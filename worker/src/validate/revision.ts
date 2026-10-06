/**
 * Field-level validation for POST /api/reports/<id>/revisions.
 *
 * The body is parsed first (check 1 of TECH-SPEC 6.1, before anything reads
 * D1); the rest needs the report's current value, so `validateCorrection`
 * runs checks 3 to 7 against it. The conflict check (8) is left to the route
 * because it answers 409, not 400.
 *
 * Values are checked with the same rules as a new report and come back in
 * stored form, so what is saved can be compared and applied directly.
 */
import { z } from 'zod';

import type { CorrectableValues, RevisionChanges } from '../../../shared/revisions.ts';
import {
  CORRECTION_MAX_DISTANCE_M,
  REASON_MAX_CHARS,
  applyChanges,
  breaksCauseRule,
  sameFieldValue,
  sortedCodes,
} from '../../../shared/revisions.ts';
import { haversineMeters } from '../../../shared/geo.ts';
import type { Bbox } from '../../../shared/validation.ts';
import {
  SPECIES_MAX_CHARS,
  countCharacters,
  isAllowedLink,
  isInsideBbox,
  isInventoryTreeId,
  isProtectedTreeId,
  isReportId,
  normalizeInventoryTreeId,
  roundCoordinate,
  stripUrls,
} from '../../../shared/validation.ts';
import type { CauseCode, EvidenceCode } from '../../../shared/tags.ts';
import { causes as causeTags, evidence as evidenceTags } from '../../../shared/tags.ts';
import type { FieldError } from './report.ts';

const optionalText = z.string().nullish();

const changesSchema = z.strictObject({
  lat: z.number().optional(),
  lng: z.number().optional(),
  species: optionalText,
  causes: z.array(z.number().int()).optional(),
  evidence: z.number().int().optional(),
  protected_tree_id: optionalText,
  inventory_tree_id: optionalText,
});

const revisionBodySchema = z.strictObject({
  turnstile_token: z.string(),
  base_revision_id: z.string().nullable(),
  changes: changesSchema,
  reason: z.string(),
  link: optionalText,
});

export type RevisionBody = z.infer<typeof revisionBodySchema>;

export interface ValidatedCorrection {
  readonly changes: RevisionChanges;
  readonly reason: string;
  readonly link: string | null;
}

export type CorrectionResult =
  | { readonly ok: true; readonly correction: ValidatedCorrection }
  | { readonly ok: false; readonly errors: readonly FieldError[] };

const CAUSE_CODES: ReadonlySet<number> = new Set(causeTags.map((tag) => tag.code));
const EVIDENCE_CODES: ReadonlySet<number> = new Set(evidenceTags.map((tag) => tag.code));

function fail(field: string, message: string): CorrectionResult {
  return { ok: false, errors: [{ field, message }] };
}

function textOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Check 1 (types and unknown fields), plus the shape of `base_revision_id`. */
export function parseRevisionBody(
  body: unknown,
): { ok: true; body: RevisionBody } | { ok: false; errors: FieldError[] } {
  const parsed = revisionBodySchema.safeParse(body);
  if (!parsed.success) {
    const errors: FieldError[] = [];
    for (const issue of parsed.error.issues) {
      if (issue.code === 'unrecognized_keys') {
        const prefix = issue.path.length > 0 ? `${issue.path.join('.')}.` : '';
        for (const key of issue.keys) {
          errors.push({ field: `${prefix}${key}`, message: 'Unknown field' });
        }
        continue;
      }
      errors.push({
        field: issue.path.length > 0 ? issue.path.join('.') : 'body',
        message: issue.message,
      });
    }
    return { ok: false, errors };
  }
  const baseRevisionId = parsed.data.base_revision_id;
  if (baseRevisionId !== null && !isReportId(baseRevisionId)) {
    return {
      ok: false,
      errors: [{ field: 'base_revision_id', message: 'Base revision id must be a ULID' }],
    };
  }
  return { ok: true, body: parsed.data };
}

export interface ValidateCorrectionOptions {
  readonly bbox: Bbox;
  /** The report's value with every active revision applied. */
  readonly current: CorrectableValues;
}

/** Checks 3 to 7 of TECH-SPEC 6.1, in order, stopping at the first failure. */
export function validateCorrection(
  body: RevisionBody,
  options: ValidateCorrectionOptions,
): CorrectionResult {
  const { current } = options;
  const input = body.changes;
  const changes: Record<string, unknown> = {};

  // Check 3: at least one field; each value by the rule for that field.
  if (Object.keys(input).length === 0) {
    return fail('changes', 'A correction must change at least one field');
  }
  if ((input.lat === undefined) !== (input.lng === undefined)) {
    return fail('changes', 'lat and lng must be corrected together');
  }
  if (input.lat !== undefined && input.lng !== undefined) {
    if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
      return fail('changes.lat', 'Coordinates must be finite numbers');
    }
    if (!isInsideBbox(options.bbox, input.lat, input.lng)) {
      return fail('changes.lat', 'Coordinates are outside the accepted area');
    }
    changes.lat = roundCoordinate(input.lat);
    changes.lng = roundCoordinate(input.lng);
  }
  if (input.causes !== undefined) {
    const unknown = input.causes.find((code) => !CAUSE_CODES.has(code));
    if (unknown !== undefined) {
      return fail('changes.causes', `Unknown cause code ${String(unknown)}`);
    }
    changes.causes = sortedCodes(input.causes as CauseCode[]);
  }
  if (input.evidence !== undefined) {
    if (!EVIDENCE_CODES.has(input.evidence)) {
      return fail('changes.evidence', `Unknown evidence code ${String(input.evidence)}`);
    }
    changes.evidence = input.evidence as EvidenceCode;
  }
  if ('species' in input) {
    const species = textOrNull(input.species);
    if (species !== null && countCharacters(species) > SPECIES_MAX_CHARS) {
      return fail('changes.species', `Species must be at most ${SPECIES_MAX_CHARS} characters`);
    }
    changes.species = species;
  }
  if ('protected_tree_id' in input) {
    const value = textOrNull(input.protected_tree_id);
    if (value !== null && !isProtectedTreeId(value)) {
      return fail('changes.protected_tree_id', 'Protected tree id must be digits');
    }
    changes.protected_tree_id = value;
  }
  if ('inventory_tree_id' in input) {
    const value = textOrNull(input.inventory_tree_id);
    if (value !== null && !isInventoryTreeId(value)) {
      return fail(
        'changes.inventory_tree_id',
        'Inventory tree id must be two letters followed by ten digits',
      );
    }
    changes.inventory_tree_id = value === null ? null : normalizeInventoryTreeId(value);
  }
  const normalized = changes as RevisionChanges;

  // Check 4: the corrected report as a whole keeps causes and evidence consistent.
  if (breaksCauseRule(applyChanges(current, normalized))) {
    return fail('changes.causes', 'Causes must be empty for this evidence source');
  }

  // Check 5: a correction moves the point a short way at most.
  if (normalized.lat !== undefined && normalized.lng !== undefined) {
    const distance = haversineMeters(current, { lat: normalized.lat, lng: normalized.lng });
    if (distance > CORRECTION_MAX_DISTANCE_M) {
      return fail(
        'changes.lat',
        `A correction may move the report at most ${String(CORRECTION_MAX_DISTANCE_M)} m`,
      );
    }
  }

  // Check 6: every field must change; the coordinate pair counts as one field.
  const unchanged: FieldError[] = [];
  if (
    normalized.lat !== undefined &&
    normalized.lng !== undefined &&
    normalized.lat === current.lat &&
    normalized.lng === current.lng
  ) {
    unchanged.push({ field: 'changes.lat', message: 'Value is unchanged' });
  }
  for (const field of [
    'species',
    'causes',
    'evidence',
    'protected_tree_id',
    'inventory_tree_id',
  ] as const) {
    const value = normalized[field];
    if (value !== undefined && sameFieldValue(field, value, current[field])) {
      unchanged.push({ field: `changes.${field}`, message: 'Value is unchanged' });
    }
  }
  if (unchanged.length > 0) {
    return { ok: false, errors: unchanged };
  }

  // Check 7: a reason is required; links go in the link field only.
  const reason = stripUrls(body.reason.trim());
  if (reason === '') {
    return fail('reason', 'A reason is required');
  }
  if (countCharacters(reason) > REASON_MAX_CHARS) {
    return fail('reason', `Reason must be at most ${REASON_MAX_CHARS} characters`);
  }
  const link = textOrNull(body.link);
  if (link !== null && !isAllowedLink(link)) {
    return fail('link', 'Link must be an https URL on the allowed domain list');
  }

  return { ok: true, correction: { changes: normalized, reason, link } };
}
