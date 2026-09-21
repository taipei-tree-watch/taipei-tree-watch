import { describe, expect, it } from 'vitest';

import { causes } from '../../shared/tags.ts';
import {
  ALL_CAUSE_CODES,
  MAP_PALETTES,
  bucketColorVar,
  bucketForCause,
  bucketForCauses,
  colorForCauses,
  paletteFor,
} from '../src/map/colors.ts';

describe('cause colours', () => {
  it('assigns a bucket to every cause code in the shared tag table', () => {
    const unmapped = ALL_CAUSE_CODES.filter((code) => bucketForCause(code) === null);

    expect(unmapped).toEqual([]);
    expect(ALL_CAUSE_CODES).toEqual(causes.map((cause) => cause.code));
  });

  it.each(['light', 'dark'] as const)('gives every bucket a distinct colour in %s', (scheme) => {
    const values = Object.values(paletteFor(scheme).buckets);

    expect(new Set(values).size).toBe(values.length);
  });

  it('paints the two schemes from different colours throughout', () => {
    const shared = Object.entries(MAP_PALETTES.light.buckets).filter(
      ([bucket, color]) => MAP_PALETTES.dark.buckets[bucket as never] === color,
    );

    expect(shared).toEqual([]);
    expect(MAP_PALETTES.dark.halo).not.toBe(MAP_PALETTES.light.halo);
    expect(MAP_PALETTES.dark.pendingStroke).not.toBe(MAP_PALETTES.light.pendingStroke);
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
    expect(colorForCauses([3, 1, 20], 'light')).toBe(MAP_PALETTES.light.buckets['brown-root-rot']);
    expect(colorForCauses([3, 1, 20], 'dark')).toBe(MAP_PALETTES.dark.buckets['brown-root-rot']);
  });

  it('ranks other disease above construction', () => {
    expect(bucketForCauses([20, 3])).toBe('other-disease');
  });

  it('uses the neutral colour for a report with no or unknown causes', () => {
    expect(bucketForCauses([])).toBe('none');
    expect(bucketForCauses([9999])).toBe('none');
    expect(colorForCauses([], 'light')).toBe(MAP_PALETTES.light.buckets.none);
  });

  it('names a custom property for each bucket, which the swatches use', () => {
    expect(bucketColorVar('brown-root-rot')).toBe('var(--bucket-brown-root-rot)');
    expect(bucketColorVar('none')).toBe('var(--bucket-none)');
  });
});
