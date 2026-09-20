/**
 * Read `[vars]` entries out of wrangler.toml.
 *
 * wrangler.toml is the single source for values that both the Worker and the
 * static frontend need. The Worker gets them as bindings; the frontend has no
 * access to bindings, so the Vite build reads them from here and bakes them in.
 *
 * The parser covers the subset wrangler.toml actually uses: top-level tables
 * and `key = "value"` string entries with optional comments. Anything richer
 * (arrays, inline tables, multi-line strings) is ignored rather than guessed at.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VARS_TABLE = 'vars';

const TABLE_HEADER = /^\[([^[\]]+)\]$/;
const STRING_ENTRY = /^([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/;

/** Every string entry under `[vars]`, keyed by name. */
export function parseWranglerVars(toml: string): Record<string, string> {
  const vars: Record<string, string> = {};
  let table = '';

  for (const rawLine of toml.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }

    const header = TABLE_HEADER.exec(line);
    if (header?.[1] !== undefined) {
      table = header[1].trim();
      continue;
    }

    if (table !== VARS_TABLE) {
      continue;
    }

    const entry = STRING_ENTRY.exec(line);
    const [, key, value] = entry ?? [];
    if (key !== undefined && value !== undefined) {
      vars[key] = value;
    }
  }

  return vars;
}

/**
 * Value of one `[vars]` entry. Throws when it is missing, because a frontend
 * build that silently ships a default would be wrong in a way nobody notices.
 */
export function requireWranglerVar(toml: string, name: string): string {
  const value = parseWranglerVars(toml)[name];
  if (value === undefined) {
    throw new Error(`wrangler.toml has no [vars] entry named ${name}`);
  }
  return value;
}

export const WRANGLER_CONFIG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'wrangler.toml',
);

export function readWranglerVar(name: string): string {
  return requireWranglerVar(readFileSync(WRANGLER_CONFIG_PATH, 'utf8'), name);
}
