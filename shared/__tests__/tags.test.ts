import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LINK_DOMAINS } from '../domains.ts';
import { SNAPSHOT_COLUMNS, SNAPSHOT_SCHEMA } from '../snapshot.ts';
import {
  DEFAULT_EVIDENCE_CODE,
  USER_REPORT_SOURCE_CODE,
  causes,
  dispositions,
  evidence,
  sources,
  tags,
} from '../tags.ts';

function readGenerated(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../generated/${name}`, import.meta.url), 'utf8'));
}

function expectUniqueCodesAndSlugs(entries: readonly { code: number; slug: string }[]): void {
  const codes = entries.map((entry) => entry.code);
  const slugs = entries.map((entry) => entry.slug);
  expect(new Set(codes).size).toBe(codes.length);
  expect(new Set(slugs).size).toBe(slugs.length);
  for (const code of codes) {
    expect(Number.isInteger(code)).toBe(true);
    expect(code).toBeGreaterThan(0);
  }
}

describe('shared/tags', () => {
  it('has unique codes and slugs in every dimension', () => {
    for (const entries of Object.values(tags)) {
      expectUniqueCodesAndSlugs(entries);
    }
  });

  it('assigns code 1 to brown root rot', () => {
    expect(causes.find((cause) => cause.code === 1)?.slug).toBe('brown-root-rot');
  });

  it('defaults evidence to sighting-only and source to user-report', () => {
    expect(evidence.find((entry) => entry.code === DEFAULT_EVIDENCE_CODE)?.slug).toBe('sighting-only');
    expect(sources.find((entry) => entry.code === USER_REPORT_SOURCE_CODE)?.slug).toBe('user-report');
  });

  it('lists seven dispositions in spec order', () => {
    expect(dispositions.map((entry) => entry.slug)).toEqual([
      'pruned-only',
      'trunk-only',
      'roots-only',
      'removed-with-roots',
      'transplanted',
      'pit-filled-concrete',
      'retained-in-place',
    ]);
  });
});

describe('shared/generated', () => {
  it('tags.json matches tags.ts', () => {
    expect(readGenerated('tags.json')).toEqual({
      causes,
      dispositions,
      evidence,
      sources,
      defaults: { evidence: DEFAULT_EVIDENCE_CODE, source: USER_REPORT_SOURCE_CODE },
    });
  });

  it('domains.json matches domains.ts', () => {
    expect(readGenerated('domains.json')).toEqual({ domains: LINK_DOMAINS });
  });

  it('snapshot.json matches snapshot.ts', () => {
    expect(readGenerated('snapshot.json')).toEqual({
      schema: SNAPSHOT_SCHEMA,
      columns: SNAPSHOT_COLUMNS,
    });
  });
});
