/**
 * Turn a rejected POST /api/reports response into per-field form errors.
 *
 * The Worker answers 400 with { errors: [{ field, message }] }, where `field`
 * is a request body field for a failed value check but can also be a request
 * level name such as `body` or `content-type`. Only the first kind has an
 * element to attach to; the rest are collected so the form can still say that
 * something was rejected.
 *
 * Server messages are English and stay out of the interface: the form owns
 * the wording and keys it by field. They are returned all the same, for the
 * console, because they are the only detail a silent mismatch leaves behind.
 */

/** Request body fields the form renders an error slot for. */
export const FORM_FIELDS = [
  'lat',
  'lng',
  'species',
  'causes',
  'dispositions',
  'evidence',
  'note',
  'link',
  'observed_at',
  'protected_tree_id',
  'inventory_tree_id',
  'turnstile_token',
] as const;

export type FormField = (typeof FORM_FIELDS)[number];

const FIELD_SET: ReadonlySet<string> = new Set(FORM_FIELDS);

export function isFormField(value: string): value is FormField {
  return FIELD_SET.has(value);
}

export interface MappedErrors {
  /** Field name to the server's message, first message per field. */
  readonly byField: ReadonlyMap<FormField, string>;
  /** Messages whose field has no element, keyed by the name the server used. */
  readonly general: readonly { readonly field: string; readonly message: string }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read the `errors` array out of a response body. A body that does not carry
 * one yields no field errors and one general entry, so the form never claims
 * a rejection was about nothing.
 */
export function mapApiErrors(payload: unknown): MappedErrors {
  const byField = new Map<FormField, string>();
  const general: { field: string; message: string }[] = [];

  const errors = isRecord(payload) ? payload.errors : undefined;
  if (!Array.isArray(errors) || errors.length === 0) {
    return { byField, general: [{ field: 'body', message: 'Request was rejected' }] };
  }

  for (const entry of errors) {
    if (!isRecord(entry)) {
      continue;
    }
    const field = typeof entry.field === 'string' ? entry.field : 'body';
    const message = typeof entry.message === 'string' ? entry.message : '';
    if (isFormField(field)) {
      if (!byField.has(field)) {
        byField.set(field, message);
      }
      continue;
    }
    general.push({ field, message });
  }

  if (byField.size === 0 && general.length === 0) {
    general.push({ field: 'body', message: 'Request was rejected' });
  }

  return { byField, general };
}
