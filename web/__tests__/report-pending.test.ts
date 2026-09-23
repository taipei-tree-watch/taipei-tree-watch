import { describe, expect, it } from 'vitest';

import { USER_REPORT_SOURCE_CODE } from '../../shared/tags.ts';
import type { PendingReport, SnapshotState, StorageLike } from '../src/report/pending.ts';
import {
  PENDING_MAX_AGE_MS,
  PENDING_STORAGE_KEY,
  addPending,
  prunePending,
  readPending,
  toReportRecord,
} from '../src/report/pending.ts';

const NOW = new Date('2026-09-19T08:00:00.000Z');

interface FakeStorage extends StorageLike {
  raw(): string | null;
}

function fakeStorage(initial: string | null = null): FakeStorage {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    raw: () => value,
  };
}

function entry(overrides: Partial<PendingReport> = {}): PendingReport {
  return {
    id: '01JABCDEFGHJKMNPQRSTVWXYZ0',
    lat: 25.033,
    lng: 121.5654,
    species: null,
    causes: [],
    dispositions: [4],
    evidence: 6,
    note: null,
    link: null,
    observedAt: null,
    protectedTreeId: null,
    inventoryTreeId: null,
    submittedAt: NOW.toISOString(),
    updatedAt: null,
    withdrawn: false,
    ...overrides,
  };
}

function snapshot(ids: string[], generatedAt: string | null = null): SnapshotState {
  return { ids: new Set(ids), generatedAt };
}

describe('readPending', () => {
  it('is empty when nothing is stored', () => {
    expect(readPending(fakeStorage(), NOW)).toEqual([]);
  });

  it('is empty when the stored value is not JSON', () => {
    expect(readPending(fakeStorage('not json'), NOW)).toEqual([]);
  });

  it('is empty when the stored value is not an array', () => {
    expect(readPending(fakeStorage('{"id":"x"}'), NOW)).toEqual([]);
  });

  it('is empty when reading the store throws', () => {
    const throwing: StorageLike = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    expect(readPending(throwing, NOW)).toEqual([]);
  });

  it('drops entries missing an id or a coordinate', () => {
    const stored = JSON.stringify([
      { lat: 25, lng: 121, submittedAt: NOW.toISOString() },
      { id: 'a', lng: 121, submittedAt: NOW.toISOString() },
      entry({ id: 'keep' }),
    ]);
    expect(readPending(fakeStorage(stored), NOW).map((item) => item.id)).toEqual(['keep']);
  });

  it('drops entries older than the maximum age', () => {
    const old = new Date(NOW.getTime() - PENDING_MAX_AGE_MS - 1).toISOString();
    const stored = JSON.stringify([entry({ id: 'old', submittedAt: old }), entry({ id: 'new' })]);
    expect(readPending(fakeStorage(stored), NOW).map((item) => item.id)).toEqual(['new']);
  });

  it('keeps an entry that is just inside the maximum age', () => {
    const recent = new Date(NOW.getTime() - PENDING_MAX_AGE_MS + 1_000).toISOString();
    const stored = JSON.stringify([entry({ id: 'recent', submittedAt: recent })]);
    expect(readPending(fakeStorage(stored), NOW).map((item) => item.id)).toEqual(['recent']);
  });
});

describe('addPending', () => {
  it('stores a submitted report under the agreed key', () => {
    const storage = fakeStorage();
    const stored = addPending(storage, entry({ id: 'one' }), NOW);
    expect(stored.map((item) => item.id)).toEqual(['one']);
    expect(readPending(storage, NOW).map((item) => item.id)).toEqual(['one']);
  });

  it('writes to ttw:pending-reports', () => {
    const storage = fakeStorage();
    let seenKey = '';
    addPending(
      {
        getItem: storage.getItem,
        setItem: (key, value) => {
          seenKey = key;
          storage.setItem(key, value);
        },
      },
      entry(),
      NOW,
    );
    expect(seenKey).toBe(PENDING_STORAGE_KEY);
  });

  it('appends without losing what was already there', () => {
    const storage = fakeStorage();
    addPending(storage, entry({ id: 'one' }), NOW);
    const stored = addPending(storage, entry({ id: 'two' }), NOW);
    expect(stored.map((item) => item.id)).toEqual(['one', 'two']);
  });

  it('replaces an entry with the same id rather than duplicating it', () => {
    const storage = fakeStorage();
    addPending(storage, entry({ id: 'one', species: null }), NOW);
    const stored = addPending(storage, entry({ id: 'one', species: 'Ficus' }), NOW);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.species).toBe('Ficus');
  });

  it('does not throw when the store refuses to write', () => {
    const readOnly: StorageLike = {
      getItem: () => null,
      setItem() {
        throw new Error('quota');
      },
    };
    expect(() => addPending(readOnly, entry(), NOW)).not.toThrow();
  });
});

describe('prunePending', () => {
  it('removes entries the snapshot now carries', () => {
    const storage = fakeStorage();
    addPending(storage, entry({ id: 'synced' }), NOW);
    addPending(storage, entry({ id: 'waiting' }), NOW);

    const left = prunePending(storage, snapshot(['synced']), NOW);
    expect(left.map((item) => item.id)).toEqual(['waiting']);
    expect(readPending(storage, NOW).map((item) => item.id)).toEqual(['waiting']);
  });

  it('keeps everything when the snapshot carries none of them', () => {
    const storage = fakeStorage();
    addPending(storage, entry({ id: 'waiting' }), NOW);
    expect(prunePending(storage, snapshot(['other']), NOW).map((item) => item.id)).toEqual([
      'waiting',
    ]);
  });

  it('keeps an edit the snapshot predates even though it carries the id', () => {
    const storage = fakeStorage();
    addPending(storage, entry({ id: 'edited', updatedAt: '2026-09-23T10:05:00.000Z' }), NOW);

    const left = prunePending(storage, snapshot(['edited'], '2026-09-23T10:00:00.000Z'), NOW);

    expect(left.map((item) => item.id)).toEqual(['edited']);
  });

  it('retires an edit once a snapshot was generated at or after it', () => {
    const storage = fakeStorage();
    addPending(storage, entry({ id: 'edited', updatedAt: '2026-09-23T10:05:00.000Z' }), NOW);

    expect(prunePending(storage, snapshot(['edited'], '2026-09-23T10:15:00.000Z'), NOW)).toEqual(
      [],
    );
  });

  it('keeps a withdrawal until a later snapshot, then retires it', () => {
    const storage = fakeStorage();
    const withdrawal = entry({
      id: 'gone',
      updatedAt: '2026-09-23T10:05:00.000Z',
      withdrawn: true,
    });
    addPending(storage, withdrawal, NOW);

    expect(prunePending(storage, snapshot(['gone'], null), NOW)).toHaveLength(1);
    expect(prunePending(storage, snapshot([], '2026-09-23T10:15:00.000Z'), NOW)).toEqual([]);
  });

  it('reads back the edit fields it stored', () => {
    const storage = fakeStorage();
    addPending(storage, entry({ updatedAt: '2026-09-23T10:05:00.000Z', withdrawn: true }), NOW);

    expect(readPending(storage, NOW)[0]).toMatchObject({
      updatedAt: '2026-09-23T10:05:00.000Z',
      withdrawn: true,
    });
  });

  it('clears the store when every entry has arrived', () => {
    const storage = fakeStorage();
    addPending(storage, entry({ id: 'synced' }), NOW);
    expect(prunePending(storage, snapshot(['synced']), NOW)).toEqual([]);
    expect(storage.raw()).toBe('[]');
  });
});

describe('toReportRecord', () => {
  it('marks the record as pending and as a user report', () => {
    const record = toReportRecord(entry({ id: 'one' }));
    expect(record.pending).toBe(true);
    expect(record.source).toBe(USER_REPORT_SOURCE_CODE);
  });

  it('carries the point and the submission time through', () => {
    const record = toReportRecord(entry({ lat: 25.1, lng: 121.6 }));
    expect(record.lat).toBe(25.1);
    expect(record.lng).toBe(121.6);
    expect(record.createdAt).toBe(NOW.toISOString());
  });
});
