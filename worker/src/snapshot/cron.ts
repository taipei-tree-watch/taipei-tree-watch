/**
 * The cron path: rebuild the snapshot and the revisions file from D1 and
 * publish both to KV.
 *
 * Failures propagate to the runtime, which records them in Workers Logs; the
 * previous `snapshot:latest` stays served until a later run succeeds. The
 * snapshot is stored first, so a failure writing the revisions file leaves
 * the map current and only the revision list a run behind.
 */
import type { Env } from '../index.ts';
import { buildPublication } from './build.ts';
import { storeRevisions, storeSnapshot } from './store.ts';

export async function runSnapshotCron(env: Env, generatedAt: Date): Promise<void> {
  const startedAt = performance.now();
  const { snapshot, revisions } = await buildPublication(env.DB, generatedAt);
  const builtAt = performance.now();
  const stored = await storeSnapshot(env.SNAPSHOTS, snapshot);
  const revisionChars = await storeRevisions(env.SNAPSHOTS, revisions);
  const finishedAt = performance.now();

  // The runtime advances its clock only across I/O, so these are wall-clock
  // segments that include the D1 and KV round trips, not CPU time. CPU time per
  // invocation is in Workers Logs.
  console.log(
    `snapshot: key=${stored.historyKey} rows=${snapshot.rows.length} chars=${stored.chars} revisions=${revisions.rows.length} revision_chars=${revisionChars} deleted=${stored.deletedKeys.length} build_ms=${(builtAt - startedAt).toFixed(1)} store_ms=${(finishedAt - builtAt).toFixed(1)}`,
  );
}
