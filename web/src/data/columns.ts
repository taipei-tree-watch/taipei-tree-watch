/**
 * Positional row decoding.
 *
 * Snapshot and trees.json both ship their own `columns` array next to the
 * rows. Every field is read through the index that array gives it, so a
 * producer that appends or reorders columns stays readable here.
 */

export class DecodeError extends Error {}

export type Row = readonly unknown[];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Map each required column name to its position in the payload's own column
 * list. Throws when the payload is malformed or a required column is missing,
 * because a partial decode would silently drop data.
 */
export function buildColumnIndex(
  columns: unknown,
  required: readonly string[],
  label: string,
): ReadonlyMap<string, number> {
  if (!Array.isArray(columns)) {
    throw new DecodeError(`${label}: columns must be an array`);
  }
  const index = new Map<string, number>();
  columns.forEach((name, position) => {
    if (typeof name === 'string' && !index.has(name)) {
      index.set(name, position);
    }
  });
  const missing = required.filter((name) => !index.has(name));
  if (missing.length > 0) {
    throw new DecodeError(`${label}: missing columns ${missing.join(', ')}`);
  }
  return index;
}

export function cell(row: Row, index: ReadonlyMap<string, number>, column: string): unknown {
  const position = index.get(column);
  return position === undefined ? undefined : row[position];
}

export function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function asText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Tag columns hold arrays of integer codes; anything else decodes to empty. */
export function asCodes(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is number => typeof entry === 'number' && Number.isInteger(entry));
}
