import { describe, expect, it } from 'vitest';

import { causes } from '../../shared/tags.ts';
import {
  ALL_CAUSE_CODES,
  BUCKET_COLORS,
  bucketForCause,
  bucketForCauses,
  colorForCauses,
} from '../src/map/colors.ts';

describe('cause colours', () => {
  it('assigns a bucket to every cause code in the shared tag table', () => {
    const unmapped = ALL_CAUSE_CODES.filter((code) => bucketForCause(code) === null);

    expect(unmapped).toEqual([]);
    expect(ALL_CAUSE_CODES).toEqual(causes.map((cause) => cause.code));
  });

  it('gives every bucket a distinct colour', () => {
    const values = Object.values(BUCKET_COLORS);

    expect(new Set(values).size).toBe(values.length);
  });

  it('splits construction causes from the tree condition causes', () => {
    expect(bucketForCause(1)).toBe('brown-root-rot');
    expect(bucketForCause(9)).toBe('other-disease');
    expect(bucketForCause(20)).toBe('construction');
    expect(bucketForCause(24)).toBe('construction');
  });

  it('lets brown root rot win over any other cause on the same report', () => {
    expect(bucketForCauses([21, 1])).toBe('brown-root-rot');
    expect(bucketForCauses([1])).toBe('brown-root-rot');
    expect(colorForCauses([3, 1, 20])).toBe(BUCKET_COLORS['brown-root-rot']);
  });

  it('ranks other disease above construction', () => {
    expect(bucketForCauses([20, 3])).toBe('other-disease');
  });

  it('uses the neutral colour for a report with no or unknown causes', () => {
    expect(bucketForCauses([])).toBe('none');
    expect(bucketForCauses([9999])).toBe('none');
    expect(colorForCauses([])).toBe(BUCKET_COLORS.none);
  });
});
