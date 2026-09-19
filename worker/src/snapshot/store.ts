/**
 * Writes a snapshot to KV and keeps the history bounded.
 *
 * `snapshot:index` is the only record of which history keys exist: KV `list()`
 * is never called, because the free plan allows 1,000 list operations a day and
 * the index costs nothing extra to maintain.
 *
 * Trimming deletes the evicted keys before rewriting the index. A crash between
 * the two leaves the index naming keys that are already gone, which the next run
 * trims again; the reverse order would leak keys that nothing points at any more.
 */
import type { Snapshot } from '../../../shared/snapshot.ts';

export const SNAPSHOT_LATEST_KEY = 'snapshot:latest';
export const SNAPSHOT_INDEX_KEY = 'snapshot:index';

/** History versions to keep: 48 quarter-hourly snapshots, i.e. 12 hours. */
export const SNAPSHOT_HISTORY_LIMIT = 48;

/** KV metadata on both snapshot keys, so the read path can build an ETag without parsing the body. */
export interface SnapshotMetadata {
  readonly generated_at: string;
}

export interface StoreSnapshotResult {
  readonly historyKey: string;
  /** Length of the serialized snapshot in UTF-16 code units. */
  readonly chars: number;
  readonly deletedKeys: readonly string[];
}

export function snapshotHistoryKey(generatedAt: string): string {
  return `snapshot:${generatedAt}`;
}

async function readIndex(kv: KVNamespace): Promise<string[]> {
  const index = await kv.get<string[]>(SNAPSHOT_INDEX_KEY, 'json');
  return index ?? [];
}

export async function storeSnapshot(
  kv: KVNamespace,
  snapshot: Snapshot,
): Promise<StoreSnapshotResult> {
  const body = JSON.stringify(snapshot);
  const historyKey = snapshotHistoryKey(snapshot.generated_at);
  const metadata: SnapshotMetadata = { generated_at: snapshot.generated_at };

  await kv.put(SNAPSHOT_LATEST_KEY, body, { metadata });
  await kv.put(historyKey, body, { metadata });

  const previous = await readIndex(kv);
  const index = [...previous.filter((key) => key !== historyKey), historyKey];
  const deletedKeys = index.splice(0, Math.max(0, index.length - SNAPSHOT_HISTORY_LIMIT));

  for (const key of deletedKeys) {
    await kv.delete(key);
  }
  await kv.put(SNAPSHOT_INDEX_KEY, JSON.stringify(index));

  return { historyKey, chars: body.length, deletedKeys };
}
