/**
 * Field-level validation for POST /api/reports.
 *
 * Runs checks 3 to 11 of the server-side validation list in TECH-SPEC section
 * 6, in that order, and stops at the first step that fails. A step reports
 * every error it found, so the form can highlight several fields at once
 * without the request being validated twice.
 *
 * The rules themselves live in shared/validation.ts, which the browser form
 * imports too; this module only sequences them and shapes the errors.
 */
import { z } from 'zod';

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
import {
  EVIDENCE_CODES_WITHOUT_CAUSES,
  USER_REPORT_SOURCE_CODE,
  causes as causeTags,
  dispositions as dispositionTags,
  evidence as evidenceTags,
} from '../../../shared/tags.ts';

export interface FieldError {
  readonly field: string;
  readonly message: string;
}

/** A report that passed every check, with values in the form they are stored. */
export interface ValidatedReport {
  readonly lat: number;
  readonly lng: number;
  readonly species: string | null;
  readonly causes: readonly number[];
  readonly dispositions: readonly number[];
  readonly evidence: number;
  readonly source: number;
  readonly note: string | null;
  readonly link: string | null;
  readonly observed_at: string | null;
  readonly protected_tree_id: string | null;
  readonly inventory_tree_id: string | null;
}

export type ValidationResult =
  | { readonly ok: true; readonly report: ValidatedReport }
  | { readonly ok: false; readonly errors: readonly FieldError[] };

export interface ValidateReportOptions {
  /** Accepted coordinate range, parsed from the BBOX var. */
  readonly bbox: Bbox;
  /** Today in Asia/Taipei as YYYY-MM-DD; the latest accepted observation date. */
  readonly today: string;
}

/** Nullable free-text field: absent, null, or a string. */
const optionalText = z.string().nullish();

/**
 * Shape of the request body. `strictObject` rejects unknown fields, and
 * `source` is accepted but ignored: the server always stores the user-report
 * code, so a client that sends another value is not an error, just overridden.
 */
const reportBodySchema = z.strictObject({
  turnstile_token: z.string(),
  lat: z.number(),
  lng: z.number(),
  species: optionalText,
  causes: z.array(z.number().int()).nullish(),
  dispositions: z.array(z.number().int()).nullish(),
  evidence: z.number().int(),
  source: z.number().int().nullish(),
  note: optionalText,
  link: optionalText,
  observed_at: optionalText,
  protected_tree_id: optionalText,
  inventory_tree_id: optionalText,
});

const CAUSE_CODES: ReadonlySet<number> = new Set(causeTags.map((tag) => tag.code));
const DISPOSITION_CODES: ReadonlySet<number> = new Set(dispositionTags.map((tag) => tag.code));
const EVIDENCE_CODES: ReadonlySet<number> = new Set(evidenceTags.map((tag) => tag.code));
const EVIDENCE_WITHOUT_CAUSES: ReadonlySet<number> = new Set(EVIDENCE_CODES_WITHOUT_CAUSES);

function issuesToErrors(error: z.ZodError): FieldError[] {
  const errors: FieldError[] = [];
  for (const issue of error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        errors.push({ field: key, message: 'Unknown field' });
      }
      continue;
    }
    errors.push({
      field: issue.path.length > 0 ? issue.path.join('.') : 'body',
      message: issue.message,
    });
  }
  return errors;
}

/** Trim a nullable string and treat the empty result as absent. */
function textOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function validateReport(body: unknown, options: ValidateReportOptions): ValidationResult {
  // Check 3: types and unknown fields.
  const parsed = reportBodySchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, errors: issuesToErrors(parsed.error) };
  }
  const input = parsed.data;

  // Check 4: coordinates inside the accepted box, then rounded for storage.
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng)) {
    return { ok: false, errors: [{ field: 'lat', message: 'Coordinates must be finite numbers' }] };
  }
  if (!isInsideBbox(options.bbox, input.lat, input.lng)) {
    return {
      ok: false,
      errors: [{ field: 'lat', message: 'Coordinates are outside the accepted area' }],
    };
  }
  const lat = roundCoordinate(input.lat);
  const lng = roundCoordinate(input.lng);

  // Check 5: every tag code exists; source is forced, never taken from input.
  const causes = input.causes ?? [];
  const dispositions = input.dispositions ?? [];
  const codeErrors: FieldError[] = [];
  for (const code of causes) {
    if (!CAUSE_CODES.has(code)) {
      codeErrors.push({ field: 'causes', message: `Unknown cause code ${code}` });
    }
  }
  for (const code of dispositions) {
    if (!DISPOSITION_CODES.has(code)) {
      codeErrors.push({ field: 'dispositions', message: `Unknown disposition code ${code}` });
    }
  }
  if (!EVIDENCE_CODES.has(input.evidence)) {
    codeErrors.push({
      field: 'evidence',
      message: `Unknown evidence code ${input.evidence}`,
    });
  }
  if (codeErrors.length > 0) {
    return { ok: false, errors: codeErrors };
  }

  // Check 6: nothing on site stated a cause, so no cause may be claimed.
  if (EVIDENCE_WITHOUT_CAUSES.has(input.evidence) && causes.length > 0) {
    return {
      ok: false,
      errors: [
        {
          field: 'causes',
          message: 'Causes must be empty for this evidence source',
        },
      ],
    };
  }

  // Check 7: species is free text, trimmed and length limited.
  const species = textOrNull(input.species);
  if (species !== null && countCharacters(species) > SPECIES_MAX_CHARS) {
    return {
      ok: false,
      errors: [
        { field: 'species', message: `Species must be at most ${SPECIES_MAX_CHARS} characters` },
      ],
    };
  }

  // Check 8: links are stripped from the note, and the limit applies to the
  // stripped text, so padding with URLs cannot squeeze past it.
  const rawNote = textOrNull(input.note);
  const strippedNote = rawNote === null ? null : textOrNull(stripUrls(rawNote));
  if (strippedNote !== null && countCharacters(strippedNote) > NOTE_MAX_CHARS) {
    return {
      ok: false,
      errors: [{ field: 'note', message: `Note must be at most ${NOTE_MAX_CHARS} characters` }],
    };
  }

  // Check 9: the single link must be https and on the domain whitelist.
  const link = textOrNull(input.link);
  if (link !== null && !isAllowedLink(link)) {
    return {
      ok: false,
      errors: [
        { field: 'link', message: 'Link must be an https URL on the allowed domain list' },
      ],
    };
  }

  // Check 10: the observation date is a real, past-or-present Taipei date.
  const observedAt = textOrNull(input.observed_at);
  if (observedAt !== null && !isObservedDateInRange(observedAt, options.today)) {
    return {
      ok: false,
      errors: [
        {
          field: 'observed_at',
          message: 'Observation date must be a real date between 2000-01-01 and today',
        },
      ],
    };
  }

  // Check 11: identifier formats only; existence is never looked up.
  const protectedTreeId = textOrNull(input.protected_tree_id);
  const inventoryTreeId = textOrNull(input.inventory_tree_id);
  const idErrors: FieldError[] = [];
  if (protectedTreeId !== null && !isProtectedTreeId(protectedTreeId)) {
    idErrors.push({ field: 'protected_tree_id', message: 'Protected tree id must be digits' });
  }
  if (inventoryTreeId !== null && !isInventoryTreeId(inventoryTreeId)) {
    idErrors.push({
      field: 'inventory_tree_id',
      message: 'Inventory tree id must be two letters followed by ten digits',
    });
  }
  if (idErrors.length > 0) {
    return { ok: false, errors: idErrors };
  }

  return {
    ok: true,
    report: {
      lat,
      lng,
      species,
      causes,
      dispositions,
      evidence: input.evidence,
      source: USER_REPORT_SOURCE_CODE,
      note: strippedNote,
      link,
      observed_at: observedAt,
      protected_tree_id: protectedTreeId,
      inventory_tree_id:
        inventoryTreeId === null ? null : normalizeInventoryTreeId(inventoryTreeId),
    },
  };
}

/** Read the widget token before the body has been validated as a whole. */
export function readTurnstileToken(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    return '';
  }
  const token = (body as Record<string, unknown>).turnstile_token;
  return typeof token === 'string' ? token : '';
}
