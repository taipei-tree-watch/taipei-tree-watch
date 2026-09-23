/**
 * Give every visible user report that has no edit link one, and hand the
 * links to whoever runs this.
 *
 * Tokens are never stored in D1, so a link that is lost cannot be read back;
 * this only ever issues new ones, for rows whose `edit_token_hash` is NULL.
 * The links are written to the output file before D1 is touched, so a failed
 * UPDATE leaves unused links behind rather than working links nobody has.
 *
 * The output file holds working credentials. Keep it out of git (the default
 * directory, workdocs/, is ignored) and delete it once the links are saved.
 *
 * Usage:
 *   tsx scripts/issue-edit-links.ts --local  [--base-url http://localhost:8787/] [--out dir]
 *   tsx scripts/issue-edit-links.ts --remote [--base-url <site>] [--out dir]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ReportWithoutLink } from './edit-links.ts';
import { SELECT_REPORTS_WITHOUT_LINK, importSnippet, issueLinks, updateSql } from './edit-links.ts';

const DATABASE = 'taipei-tree-watch';
const SITE_URL = 'https://taipei-tree-watch.taipeitreewatch.workers.dev/';
const LOCAL_URL = 'http://localhost:8787/';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function wrangler(target: string, args: readonly string[]): string {
  return execFileSync('npx', ['wrangler', 'd1', 'execute', DATABASE, target, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

function selectRows(target: string): ReportWithoutLink[] {
  const output = wrangler(target, ['--json', '--command', SELECT_REPORTS_WITHOUT_LINK]);
  const parsed = JSON.parse(output) as { results?: ReportWithoutLink[] }[];
  return parsed.flatMap((entry) => entry.results ?? []);
}

function main(): void {
  const remote = process.argv.includes('--remote');
  const local = process.argv.includes('--local');
  if (remote === local) {
    throw new Error('pass exactly one of --local or --remote');
  }
  const target = remote ? '--remote' : '--local';
  const baseUrl = option('--base-url') ?? (remote ? SITE_URL : LOCAL_URL);
  const outDir = option('--out') ?? join(repoRoot, 'workdocs');

  const rows = selectRows(target);
  if (rows.length === 0) {
    console.log('every visible user report already has an edit link');
    return;
  }

  const now = new Date();
  const links = issueLinks(rows, baseUrl);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `edit-links_${remote ? 'remote' : 'local'}_${stamp}.md`);
  writeFileSync(
    outFile,
    [
      `# Edit links issued ${now.toISOString()} (${target})`,
      '',
      'Working credentials: anyone holding one can edit or withdraw that report.',
      'Delete this file once the links are saved.',
      '',
      ...links.map((link) => `- ${link.id} ${link.species ?? '-'}: ${link.url}`),
      '',
      '## Save them in a browser',
      '',
      `Open ${baseUrl} , then paste this into the developer console:`,
      '',
      '```js',
      importSnippet(links, now.toISOString()),
      '```',
      '',
    ].join('\n'),
  );
  console.log(`wrote ${String(links.length)} links to ${relative(process.cwd(), outFile)}`);

  const sqlDir = mkdtempSync(join(tmpdir(), 'ttw-edit-links-'));
  const sqlFile = join(sqlDir, 'issue.sql');
  try {
    writeFileSync(sqlFile, `${updateSql(links)}\n`);
    wrangler(target, ['--file', sqlFile, '--yes']);
  } finally {
    rmSync(sqlDir, { recursive: true, force: true });
  }
  console.log(`stored ${String(links.length)} token hashes in ${DATABASE} (${target})`);
}

main();
