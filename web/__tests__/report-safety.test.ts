import { describe, expect, it, vi } from 'vitest';

import type { StorageLike } from '../src/report/pending.ts';
import {
  SAFETY_STORAGE_KEY,
  dismissSafety,
  isSafetyDismissed,
} from '../src/report/safety.ts';

interface FakeStorage extends StorageLike {
  entries(): ReadonlyMap<string, string>;
}

function fakeStorage(initial: ReadonlyMap<string, string> = new Map()): FakeStorage {
  const values = new Map(initial);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    entries: () => values,
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

describe('isSafetyDismissed', () => {
  it('is false when nothing is stored', () => {
    expect(isSafetyDismissed(fakeStorage())).toBe(false);
  });

  it('is true after the notice has been acknowledged', () => {
    const storage = fakeStorage();
    dismissSafety(storage);
    expect(isSafetyDismissed(storage)).toBe(true);
  });

  it('is false for a value this module never writes', () => {
    expect(isSafetyDismissed(fakeStorage(new Map([[SAFETY_STORAGE_KEY, 'no']])))).toBe(false);
  });

  it('keeps showing the notice when reading throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(isSafetyDismissed(refusingStorage())).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('dismissSafety', () => {
  it('writes under the shared key prefix', () => {
    const storage = fakeStorage();
    dismissSafety(storage);
    expect(SAFETY_STORAGE_KEY.startsWith('ttw:')).toBe(true);
    expect(storage.entries().get(SAFETY_STORAGE_KEY)).toBe('1');
  });

  it('does not throw when writing is refused', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => dismissSafety(refusingStorage())).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
