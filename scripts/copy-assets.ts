/**
 * Copy pipeline output into web/public/ so Vite ships it as a static asset.
 *
 * The files under data/ are produced by the Python pipelines and committed to
 * the repo; web/public/trees.json is a build product and is gitignored.
 * Run with: npm run build:assets
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const assets: Array<[string, string]> = [
  [join('data', 'protected-trees', 'trees.json'), join('web', 'public', 'trees.json')],
];

for (const [from, to] of assets) {
  const target = join(repoRoot, to);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(repoRoot, from), target);
  console.log(`copied ${from} -> ${relative(repoRoot, target)}`);
}
