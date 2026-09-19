/**
 * Reports this browser has submitted but has not yet seen in a snapshot.
 *
 * The snapshot is rebuilt on a cron, so a reporter would otherwise watch
 * their own point fail to appear for a quarter of an hour. Entries are held
 * in localStorage, drawn on the map with a pending style, and dropped as soon
 * as a snapshot carries the same id.
 *
 * Storage is best effort: a private window can refuse it, and a refusal must
 * not break submitting. Every access is guarded and a failure degrades to an
 * empty list.
 */
import { USER_REPORT_SOURCE_CODE } from '../../../shared/tags.ts';
import type {
  CauseCode,
  DispositionCode,
  EvidenceCode,
} from '../../../shared/tags.ts';
import type { ReportRecord } from '../data/snapshot.ts';

export const PENDING_STORAGE_KEY = 'ttw:pending-reports';

/**
 * An entry the snapshot never claims is a report that was hidden or lost.
 * Dropping it after a day keeps a stale point from following the reporter
 * around for ever.
 */
export const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface PendingReport {
  readonly id: string;
  readonly lat: number;
  readonly lng: number;
  readonly species: string | null;
  readonly causes: readonly number[];
  readonly dispositions: readonly number[];
  readonly evidence: number | null;
  readonly note: string | null;
  readonly link: string | null;
  readonly observedAt: string | null;
  readonly protectedTreeId: string | null;
  readonly inventoryTreeId: string | null;
  /** When this browser sent the report, as an ISO timestamp. */
  readonly submittedAt: string;
}

/** The slice of the Storage interface this module uses. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
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

function codes(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is number => typeof entry === 'number');
}

function parseEntry(value: unknown): PendingReport | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = textOrNull(value.id);
  const lat = numberOrNull(value.lat);
  const lng = numberOrNull(value.lng);
  const submittedAt = textOrNull(value.submittedAt);
  if (id === null || lat === null || lng === null || submittedAt === null) {
    return null;
  }

  return {
    id,
    lat,
    lng,
    species: textOrNull(value.species),
    causes: codes(value.causes),
    dispositions: codes(value.dispositions),
    evidence: numberOrNull(value.evidence),
    note: textOrNull(value.note),
    link: textOrNull(value.link),
    observedAt: textOrNull(value.observedAt),
    protectedTreeId: textOrNull(value.protectedTreeId),
    inventoryTreeId: textOrNull(value.inventoryTreeId),
    submittedAt,
  };
}

function isFresh(entry: PendingReport, now: Date): boolean {
  const submitted = Date.parse(entry.submittedAt);
  if (Number.isNaN(submitted)) {
    return false;
  }
  return now.getTime() - submitted < PENDING_MAX_AGE_MS;
}

function write(storage: StorageLike, entries: readonly PendingReport[]): void {
  try {
    storage.setItem(PENDING_STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    console.warn('could not persist pending reports', error);
  }
}

/** Stored entries, with malformed and expired ones dropped. */
export function readPending(storage: StorageLike, now: Date): PendingReport[] {
  let raw: string | null;
  try {
    raw = storage.getItem(PENDING_STORAGE_KEY);
  } catch (error) {
    console.warn('could not read pending reports', error);
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

  return parsed
    .map(parseEntry)
    .filter((entry): entry is PendingReport => entry !== null && isFresh(entry, now));
}

/** Store one more entry, replacing any earlier entry with the same id. */
export function addPending(
  storage: StorageLike,
  entry: PendingReport,
  now: Date,
): PendingReport[] {
  const kept = readPending(storage, now).filter((existing) => existing.id !== entry.id);
  const next = [...kept, entry];
  write(storage, next);
  return next;
}

/**
 * Drop entries the snapshot now carries.
 *
 * Only call this with the ids of a snapshot that actually loaded: pruning
 * against an empty set after a failed fetch would clear every pending point.
 */
export function prunePending(
  storage: StorageLike,
  snapshotIds: ReadonlySet<string>,
  now: Date,
): PendingReport[] {
  const current = readPending(storage, now);
  const next = current.filter((entry) => !snapshotIds.has(entry.id));
  if (next.length !== current.length) {
    write(storage, next);
  }
  return next;
}

/** Render a pending entry through the same shape the map draws snapshots in. */
export function toReportRecord(entry: PendingReport): ReportRecord {
  return {
    id: entry.id,
    lat: entry.lat,
    lng: entry.lng,
    species: entry.species,
    causes: entry.causes as CauseCode[],
    dispositions: entry.dispositions as DispositionCode[],
    evidence: entry.evidence as EvidenceCode | null,
    source: USER_REPORT_SOURCE_CODE,
    note: entry.note,
    link: entry.link,
    observedAt: entry.observedAt,
    protectedTreeId: entry.protectedTreeId,
    inventoryTreeId: entry.inventoryTreeId,
    createdAt: entry.submittedAt,
    pending: true,
  };
}
