/**
 * Edit links this browser holds: "my reports".
 *
 * An entry is written when this browser submits a report and when an edit
 * link is opened here, and it lives only in this browser's localStorage.
 * There is no account behind it, so another browser, a private window or
 * cleared site data sees none of them; the link itself is the only thing that
 * carries the right to edit across devices.
 *
 * Entries never expire. They are removed when the report is withdrawn, or
 * when the Worker no longer recognises the link, because a token that stopped
 * working never starts again.
 *
 * Storage is best effort, as in pending.ts: every access is guarded and a
 * failure degrades to an empty list.
 */
import { isEditToken } from '../../../shared/validation.ts';
import type { StorageLike } from './pending.ts';

export const EDIT_LINKS_STORAGE_KEY = 'ttw:edit-links';

export interface StoredEditLink {
  readonly id: string;
  readonly token: string;
  /** When this browser first stored the link, as an ISO timestamp. */
  readonly savedAt: string;
  /**
   * What the list shows until the report itself is at hand. Null when the
   * link was opened before its report could be read.
   */
  readonly lat: number | null;
  readonly lng: number | null;
  readonly species: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseEntry(value: unknown): StoredEditLink | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = textOrNull(value.id);
  const token = textOrNull(value.token);
  const savedAt = textOrNull(value.savedAt);
  if (id === null || token === null || savedAt === null || !isEditToken(token)) {
    return null;
  }
  return {
    id,
    token,
    savedAt,
    lat: numberOrNull(value.lat),
    lng: numberOrNull(value.lng),
    species: textOrNull(value.species),
  };
}

function newestFirst(entries: StoredEditLink[]): StoredEditLink[] {
  return entries.sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));
}

function write(storage: StorageLike, entries: readonly StoredEditLink[]): void {
  try {
    storage.setItem(EDIT_LINKS_STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    console.warn('could not persist edit links', error);
  }
}

/** Stored links, newest first, with malformed entries dropped. */
export function readEditLinks(storage: StorageLike): StoredEditLink[] {
  let raw: string | null;
  try {
    raw = storage.getItem(EDIT_LINKS_STORAGE_KEY);
  } catch (error) {
    console.warn('could not read edit links', error);
    return [];
  }
  if (raw === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return newestFirst(
    parsed.map(parseEntry).filter((entry): entry is StoredEditLink => entry !== null),
  );
}

export function findEditLink(
  links: readonly StoredEditLink[],
  id: string,
): StoredEditLink | undefined {
  return links.find((entry) => entry.id === id);
}

export interface EditLinkDetails {
  readonly lat?: number | null;
  readonly lng?: number | null;
  readonly species?: string | null;
}

/**
 * Store a link, or refresh the one already stored for that report.
 *
 * An existing entry keeps its `savedAt`, so the list order means "first
 * seen here". A newer token for the same report replaces the old one.
 * Details left undefined keep what the entry already had.
 */
export function saveEditLink(
  storage: StorageLike,
  link: { readonly id: string; readonly token: string },
  details: EditLinkDetails,
  now: Date,
): StoredEditLink[] {
  const current = readEditLinks(storage);
  const existing = findEditLink(current, link.id);
  const entry: StoredEditLink = {
    id: link.id,
    token: link.token,
    savedAt: existing?.savedAt ?? now.toISOString(),
    lat: details.lat !== undefined ? details.lat : (existing?.lat ?? null),
    lng: details.lng !== undefined ? details.lng : (existing?.lng ?? null),
    species: details.species !== undefined ? details.species : (existing?.species ?? null),
  };
  const next = newestFirst([entry, ...current.filter((other) => other.id !== link.id)]);
  write(storage, next);
  return next;
}

export function removeEditLink(storage: StorageLike, id: string): StoredEditLink[] {
  const current = readEditLinks(storage);
  const next = current.filter((entry) => entry.id !== id);
  if (next.length !== current.length) {
    write(storage, next);
  }
  return next;
}
