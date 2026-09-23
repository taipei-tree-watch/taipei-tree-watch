import { describe, expect, it, vi } from 'vitest';

import type { StorageLike } from '../src/report/pending.ts';
import { GUIDE_STORAGE_KEY, readGuideOpen, writeGuideOpen } from '../src/report/guide.ts';

function fakeStorage(initial: ReadonlyMap<string, string> = new Map()): StorageLike {
  const values = new Map(initial);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

/** A private window, where both accesses throw rather than return null. */
function refusingStorage(): StorageLike {
  return {
    getItem: () => {
      throw new Error('site data is blocked');
    },
    setItem: () => {
      throw new Error('site data is blocked');
    },
  };
}

describe('readGuideOpen', () => {
  it('is null when nothing is stored', () => {
    expect(readGuideOpen(fakeStorage())).toBeNull();
  });

  it('reads back what was written', () => {
    const storage = fakeStorage();
    writeGuideOpen(storage, false);
    expect(readGuideOpen(storage)).toBe(false);
    writeGuideOpen(storage, true);
    expect(readGuideOpen(storage)).toBe(true);
  });

  it('treats an unknown value as no choice', () => {
    expect(readGuideOpen(fakeStorage(new Map([[GUIDE_STORAGE_KEY, 'yes']])))).toBeNull();
  });

  it('is null when storage refuses', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(readGuideOpen(refusingStorage())).toBeNull();
  });
});

describe('writeGuideOpen', () => {
  it('drops the write when storage refuses', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => {
      writeGuideOpen(refusingStorage(), true);
    }).not.toThrow();
  });
});
