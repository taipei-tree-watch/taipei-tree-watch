/**
 * Fetch the published snapshot and revisions file and keep a copy of each
 * under data/snapshots/ and data/revisions/.
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

const SITE = 'https://taipei-tree-watch.taipeitreewatch.workers.dev';
const SNAPSHOT_URL = `${SITE}/api/snapshot`;
const REVISIONS_URL = `${SITE}/api/revisions`;

/**
 * Both documents are served with max-age=300, and a request-side no-cache header
 * does not reach past Cloudflare's edge cache. A unique query string does, so
 * a backup taken right after a cron run records that run rather than the copy
 * the edge still holds.
 */
function cacheBustedUrl(url: string, now: Date): string {
  return `${url}?cb=${String(now.getTime())}`;
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

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
    throw new Error('response is not a snapshot or revisions document');
  }
}

interface Target {
  readonly url: string;
  readonly dir: string;
}

/**
 * The revisions file carries the corrections the snapshot has applied. It is
 * kept beside the snapshot so a copy of either can be traced back to the other.
 */
const TARGETS: readonly Target[] = [
  { url: SNAPSHOT_URL, dir: join(repoRoot, 'data', 'snapshots') },
  { url: REVISIONS_URL, dir: join(repoRoot, 'data', 'revisions') },
];

const startedAt = new Date();
for (const target of TARGETS) {
  const response = await fetch(cacheBustedUrl(target.url, startedAt));
  if (!response.ok) {
    throw new Error(`${target.url} answered ${String(response.status)}`);
  }

  const body = await response.text();
  const snapshot: unknown = JSON.parse(body);
  assertSnapshot(snapshot);

  // Reformat rather than echoing the response: one row per line keeps a git diff
  // down to the rows that actually changed.
  const rowLines = snapshot.rows.map((row) => `    ${JSON.stringify(row)}`).join(',\n');
  const document = [
    '{',
    `  "schema": ${JSON.stringify(snapshot.schema)},`,
    `  "generated_at": ${JSON.stringify(snapshot.generated_at)},`,
    `  "columns": ${JSON.stringify(snapshot.columns)},`,
    ...(rowLines === '' ? ['  "rows": []'] : ['  "rows": [', rowLines, '  ]']),
    '}',
    '',
  ].join('\n');

  mkdirSync(target.dir, { recursive: true });
  for (const name of ['latest.json', `${taipeiDate(startedAt)}.json`]) {
    const path = join(target.dir, name);
    writeFileSync(path, document);
    console.log(`wrote ${relative(repoRoot, path)}`);
  }
  console.log(`generated_at=${snapshot.generated_at} rows=${String(snapshot.rows.length)}`);
}
