/**
 * The cron path: rebuild the snapshot from D1 and publish it to KV.
 *
 * Failures propagate to the runtime, which records them in Workers Logs; the
 * previous `snapshot:latest` stays served until a later run succeeds.
 */
import type { Env } from '../index.ts';
import { buildSnapshot } from './build.ts';
import { storeSnapshot } from './store.ts';

export async function runSnapshotCron(env: Env, generatedAt: Date): Promise<void> {
  const startedAt = performance.now();
  const snapshot = await buildSnapshot(env.DB, generatedAt);
  const builtAt = performance.now();
  const stored = await storeSnapshot(env.SNAPSHOTS, snapshot);
  const finishedAt = performance.now();

  // The runtime advances its clock only across I/O, so these are wall-clock
  // segments that include the D1 and KV round trips, not CPU time. CPU time per
  // invocation is in Workers Logs.
  console.log(
    `snapshot: key=${stored.historyKey} rows=${snapshot.rows.length} chars=${stored.chars} deleted=${stored.deletedKeys.length} build_ms=${(builtAt - startedAt).toFixed(1)} store_ms=${(finishedAt - builtAt).toFixed(1)}`,
  );
}
