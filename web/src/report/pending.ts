/**
 * Reports this browser has submitted, edited or withdrawn but has not yet
 * seen reflected in a snapshot.
 *
 * The snapshot is rebuilt on a cron, so a reporter would otherwise watch
 * their own point fail to appear, keep its old contents, or linger after a
 * withdrawal for a quarter of an hour. Entries are held in localStorage and
 * take the place of the snapshot's row with the same id: a new or edited
 * report is drawn with a pending style, a withdrawn one is not drawn at all.
 *
 * A new report is retired once a snapshot carries its id. An edit or a
 * withdrawal is retired once a snapshot was generated at or after the moment
 * the Worker stored it: the snapshot already holds the old row, so its id
 * alone proves nothing.
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
  /** When this browser sent the report or the change, as an ISO timestamp. */
  readonly submittedAt: string;
  /**
   * The Worker's `updated_at` for an edit or a withdrawal; null for a report
   * that was only created. Server time, so it compares with `generated_at`.
   */
  readonly updatedAt: string | null;
  /** The reporter withdrew it: hide the snapshot row until it drops out. */
  readonly withdrawn: boolean;
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
    updatedAt: textOrNull(value.updatedAt),
    withdrawn: value.withdrawn === true,
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

/** What a loaded snapshot says about the entries it may retire. */
export interface SnapshotState {
  readonly ids: ReadonlySet<string>;
  readonly generatedAt: string | null;
}

/** True when the snapshot already shows what the entry records. */
export function isReflected(entry: PendingReport, snapshot: SnapshotState): boolean {
  if (entry.updatedAt === null) {
    return snapshot.ids.has(entry.id);
  }
  // Both are ISO 8601 UTC strings from the Worker, so text order is time order.
  return snapshot.generatedAt !== null && snapshot.generatedAt >= entry.updatedAt;
}

/**
 * Drop entries the snapshot now reflects.
 *
 * Only call this with a snapshot that actually loaded: pruning against an
 * empty set after a failed fetch would clear every pending point.
 */
export function prunePending(
  storage: StorageLike,
  snapshot: SnapshotState,
  now: Date,
): PendingReport[] {
  const current = readPending(storage, now);
  const next = current.filter((entry) => !isReflected(entry, snapshot));
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
