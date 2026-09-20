import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  WRANGLER_CONFIG_PATH,
  parseWranglerVars,
  readWranglerVar,
  requireWranglerVar,
} from '../wrangler-vars.ts';

const SAMPLE = `name = "taipei-tree-watch"

[[kv_namespaces]]
binding = "SNAPSHOTS"
id = "abc"

[vars]
# A comment line.
TURNSTILE_SITE_KEY = "0x1234"
TURNSTILE_HOSTNAME = ""
BBOX = "121.30,24.85,121.75,25.35"  # trailing comment

[observability]
enabled = true
`;

describe('parseWranglerVars', () => {
  it('returns only the entries under [vars]', () => {
    expect(parseWranglerVars(SAMPLE)).toEqual({
      TURNSTILE_SITE_KEY: '0x1234',
      TURNSTILE_HOSTNAME: '',
      BBOX: '121.30,24.85,121.75,25.35',
    });
  });

  it('ignores keys with the same name in other tables', () => {
    expect(parseWranglerVars(SAMPLE).binding).toBeUndefined();
    expect(parseWranglerVars(SAMPLE).id).toBeUndefined();
  });

  it('ignores non-string entries', () => {
    expect(parseWranglerVars('[vars]\nENABLED = true\n')).toEqual({});
  });
});

describe('requireWranglerVar', () => {
  it('returns the value', () => {
    expect(requireWranglerVar(SAMPLE, 'TURNSTILE_SITE_KEY')).toBe('0x1234');
  });

  it('returns an empty value rather than treating it as missing', () => {
    expect(requireWranglerVar(SAMPLE, 'TURNSTILE_HOSTNAME')).toBe('');
  });

  it('throws when the entry is missing', () => {
    expect(() => requireWranglerVar(SAMPLE, 'NOPE')).toThrow('NOPE');
  });
});

describe('readWranglerVar', () => {
  it('reads the real wrangler.toml', () => {
    const toml = readFileSync(WRANGLER_CONFIG_PATH, 'utf8');
    expect(readWranglerVar('TURNSTILE_SITE_KEY')).toBe(
      requireWranglerVar(toml, 'TURNSTILE_SITE_KEY'),
    );
    expect(readWranglerVar('TURNSTILE_SITE_KEY')).not.toBe('');
  });

  it('keeps the frontend BBOX copy in step with the Worker var', async () => {
    const { BBOX_STRING } = await import('../../web/src/config.ts');
    expect(readWranglerVar('BBOX')).toBe(BBOX_STRING);
  });
});
