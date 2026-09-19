/**
 * Emit an SQL file of fake but valid reports, for measuring how long the
 * snapshot cron takes on a full-size table.
 *
 * The generator is seeded, so the same arguments always produce the same file.
 * Values satisfy the server-side rules: coordinates inside BBOX rounded to five
 * decimals, tag codes from shared/tags.ts, no causes when the evidence code
 * states none, link hostnames from the whitelist.
 *
 * Usage:
 *   tsx scripts/seed-reports.ts [outputPath] [count]
 *   wrangler d1 execute taipei-tree-watch --local --file <outputPath>
 */
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LINK_DOMAINS } from '../shared/domains.ts';
import { EVIDENCE_CODES_WITHOUT_CAUSES, causes, dispositions, evidence } from '../shared/tags.ts';

const outputPath = process.argv[2] ?? join(tmpdir(), 'seed-reports.sql');
const count = Number(process.argv[3] ?? 10_000);
const rowsPerStatement = 100;

/** BBOX from wrangler.toml: minLng, minLat, maxLng, maxLat. */
const BBOX = { minLng: 121.3, minLat: 24.85, maxLng: 121.75, maxLat: 25.35 };

const SPECIES = [
  'Ficus microcarpa',
  'Cinnamomum camphora',
  'Koelreuteria henryi',
  'Delonix regia',
  'Bischofia javanica',
  null,
];

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Deterministic PRNG, so a rerun produces byte-identical SQL. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20260918);

function pick<T>(values: readonly T[], fallback: T): T {
  return values[Math.floor(random() * values.length)] ?? fallback;
}

function base32(value: number, length: number): string {
  let out = '';
  let rest = value;
  for (let i = 0; i < length; i += 1) {
    out = `${CROCKFORD[rest % 32] ?? '0'}${out}`;
    rest = Math.floor(rest / 32);
  }
  return out;
}

/** ULID shape: 10 characters of timestamp followed by 16 of randomness. */
function ulid(timestampMs: number): string {
  let randomness = '';
  for (let i = 0; i < 16; i += 1) {
    randomness += CROCKFORD[Math.floor(random() * 32)] ?? '0';
  }
  return `${base32(timestampMs, 10)}${randomness}`;
}

function coordinate(min: number, max: number): number {
  return Math.round((min + random() * (max - min)) * 100_000) / 100_000;
}

function isoDate(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

function quote(value: string | null): string {
  return value === null ? 'NULL' : `'${value.replaceAll("'", "''")}'`;
}

function buildValues(index: number, status: number): string {
  const createdAtMs = Date.UTC(2026, 0, 1) + index * 60_000;
  const evidenceCode = pick(evidence, evidence[0]).code;
  const withoutCauses = (EVIDENCE_CODES_WITHOUT_CAUSES as readonly number[]).includes(evidenceCode);
  const causeCodes = withoutCauses ? [] : [pick(causes, causes[0]).code];
  const dispositionCodes = [pick(dispositions, dispositions[0]).code];
  const domain = pick(LINK_DOMAINS, LINK_DOMAINS[0]);
  const link = random() < 0.5 ? `https://www.${domain}/post/${index}` : null;
  const note = random() < 0.7 ? `Seeded report ${index} for the snapshot CPU measurement.` : null;

  return [
    quote(ulid(createdAtMs)),
    coordinate(BBOX.minLat, BBOX.maxLat).toFixed(5),
    coordinate(BBOX.minLng, BBOX.maxLng).toFixed(5),
    quote(pick(SPECIES, null)),
    quote(JSON.stringify(causeCodes)),
    quote(JSON.stringify(dispositionCodes)),
    String(evidenceCode),
    '1',
    quote(note),
    quote(link),
    quote(isoDate(createdAtMs)),
    random() < 0.2 ? quote(String(1000 + (index % 2500))) : 'NULL',
    'NULL',
    String(status),
    quote(new Date(createdAtMs).toISOString()),
  ].join(', ');
}

const columns =
  'id, lat, lng, species, causes, dispositions, evidence, source, note, link, observed_at, protected_tree_id, inventory_tree_id, status, created_at';

// `count` is the size of the snapshot; the hidden rows sit on top of it so the
// query has rows to skip without shrinking the result.
const hiddenCount = Math.ceil(count / 20);
const total = count + hiddenCount;

const statements: string[] = ['DELETE FROM reports;'];
for (let start = 0; start < total; start += rowsPerStatement) {
  const values: string[] = [];
  for (let index = start; index < Math.min(start + rowsPerStatement, total); index += 1) {
    values.push(`(${buildValues(index, index < count ? 0 : 1)})`);
  }
  statements.push(`INSERT INTO reports (${columns}) VALUES\n${values.join(',\n')};`);
}

writeFileSync(outputPath, `${statements.join('\n')}\n`);
console.log(`wrote ${count} visible and ${hiddenCount} hidden reports to ${outputPath}`);
