/**
 * Emit the shared TypeScript definitions as JSON under shared/generated/ so the
 * Python pipelines can read the same tag codes, domain whitelist and snapshot
 * layout without a TypeScript toolchain.
 *
 * Output is deterministic (same input, same bytes) and committed to git.
 * Run with: npm run build:shared
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LINK_DOMAINS } from '../shared/domains.ts';
import { SNAPSHOT_COLUMNS, SNAPSHOT_SCHEMA } from '../shared/snapshot.ts';
import { DEFAULT_EVIDENCE_CODE, USER_REPORT_SOURCE_CODE, tags } from '../shared/tags.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'shared', 'generated');

const outputs: Record<string, unknown> = {
  'tags.json': {
    ...tags,
    defaults: {
      evidence: DEFAULT_EVIDENCE_CODE,
      source: USER_REPORT_SOURCE_CODE,
    },
  },
  'domains.json': { domains: LINK_DOMAINS },
  'snapshot.json': { schema: SNAPSHOT_SCHEMA, columns: SNAPSHOT_COLUMNS },
};

mkdirSync(outDir, { recursive: true });
for (const [name, value] of Object.entries(outputs)) {
  const path = join(outDir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  console.log(`wrote ${relative(repoRoot, path)}`);
}
