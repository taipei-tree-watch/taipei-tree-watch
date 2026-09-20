/**
 * Fetch the published snapshot and keep a copy under data/snapshots/.
 *
 * Two files are written: latest.json, which git diffs against the previous
 * run, and <date>.json, a dated copy that is never rewritten. Both are
 * committed, so the public snapshot has a permanent history independent of KV,
 * whose own history keeps only twelve hours.
 *
 * A run that would write an unchanged latest.json still writes the dated copy,
 * because "the snapshot did not move all day" is itself worth recording.
 *
 * Run with: npm run backup:snapshot
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SNAPSHOT_URL = 'https://taipei-tree-watch.taipeitreewatch.workers.dev/api/snapshot';

/**
 * The snapshot is served with max-age=300, and a request-side no-cache header
 * does not reach past Cloudflare's edge cache. A unique query string does, so
 * a backup taken right after a cron run records that run rather than the copy
 * the edge still holds.
 */
function snapshotUrl(now: Date): string {
  return `${SNAPSHOT_URL}?cb=${String(now.getTime())}`;
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'data', 'snapshots');

/** Date in Asia/Taipei, which is the timezone every date in this project uses. */
function taipeiDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

interface Snapshot {
  schema: number;
  generated_at: string;
  columns: string[];
  rows: unknown[];
}

function assertSnapshot(value: unknown): asserts value is Snapshot {
  const candidate = value as Partial<Snapshot> | null;
  if (
    candidate === null ||
    typeof candidate !== 'object' ||
    typeof candidate.generated_at !== 'string' ||
    !Array.isArray(candidate.rows)
  ) {
    throw new Error('response is not a snapshot document');
  }
}

const startedAt = new Date();
const response = await fetch(snapshotUrl(startedAt));
if (!response.ok) {
  throw new Error(`${SNAPSHOT_URL} answered ${String(response.status)}`);
}

const body = await response.text();
const snapshot: unknown = JSON.parse(body);
assertSnapshot(snapshot);

// Reformat rather than echoing the response: one row per line keeps a git diff
// down to the rows that actually changed.
const document = [
  '{',
  `  "schema": ${JSON.stringify(snapshot.schema)},`,
  `  "generated_at": ${JSON.stringify(snapshot.generated_at)},`,
  `  "columns": ${JSON.stringify(snapshot.columns)},`,
  '  "rows": [',
  snapshot.rows.map((row) => `    ${JSON.stringify(row)}`).join(',\n'),
  '  ]',
  '}',
  '',
].join('\n');

mkdirSync(outDir, { recursive: true });
for (const name of ['latest.json', `${taipeiDate(startedAt)}.json`]) {
  const path = join(outDir, name);
  writeFileSync(path, document);
  console.log(`wrote ${relative(repoRoot, path)}`);
}
console.log(`generated_at=${snapshot.generated_at} rows=${String(snapshot.rows.length)}`);
