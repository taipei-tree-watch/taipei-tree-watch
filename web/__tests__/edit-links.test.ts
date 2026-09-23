import { describe, expect, it } from 'vitest';

import {
  findEditLink,
  readEditLinks,
  removeEditLink,
  saveEditLink,
} from '../src/report/edit-links.ts';
import type { StorageLike } from '../src/report/pending.ts';

const ID = '01JBZ8QF7KJ9M3N4P5R6S7T8V9';
const OTHER = '01JBZ8QF7KJ9M3N4P5R6S7T8W0';
const TOKEN = 'a'.repeat(43);
const NEW_TOKEN = 'b'.repeat(43);

function fakeStorage(initial: string | null = null): StorageLike & { raw(): string | null } {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    raw: () => value,
  };
}

describe('readEditLinks', () => {
  it('is empty when nothing or garbage is stored', () => {
    expect(readEditLinks(fakeStorage())).toEqual([]);
    expect(readEditLinks(fakeStorage('not json'))).toEqual([]);
    expect(readEditLinks(fakeStorage('{}'))).toEqual([]);
  });

  it('drops entries without a well formed token', () => {
    const stored = JSON.stringify([
      { id: ID, token: 'short', savedAt: '2026-09-23T00:00:00.000Z' },
      { id: OTHER, token: TOKEN, savedAt: '2026-09-23T00:00:00.000Z' },
    ]);
    expect(readEditLinks(fakeStorage(stored)).map((entry) => entry.id)).toEqual([OTHER]);
  });

  it('survives a storage that throws', () => {
    const broken: StorageLike = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    expect(readEditLinks(broken)).toEqual([]);
    expect(() => saveEditLink(broken, { id: ID, token: TOKEN }, {}, new Date())).not.toThrow();
  });
});

describe('saveEditLink', () => {
  it('stores a link with its details, newest first', () => {
    const storage = fakeStorage();
    saveEditLink(storage, { id: ID, token: TOKEN }, { species: '榕' }, new Date('2026-09-22'));
    const links = saveEditLink(
      storage,
      { id: OTHER, token: TOKEN },
      { lat: 25, lng: 121 },
      new Date('2026-09-23'),
    );

    expect(links.map((entry) => entry.id)).toEqual([OTHER, ID]);
    expect(findEditLink(links, ID)).toMatchObject({ species: '榕', lat: null });
    expect(JSON.parse(storage.raw() ?? '[]')).toHaveLength(2);
  });

  it('refreshes an existing entry, keeping when it was first saved', () => {
    const storage = fakeStorage();
    saveEditLink(storage, { id: ID, token: TOKEN }, { species: '榕' }, new Date('2026-09-22'));
    const links = saveEditLink(
      storage,
      { id: ID, token: NEW_TOKEN },
      { lat: 25.1, lng: 121.5 },
      new Date('2026-09-23'),
    );

    expect(links).toEqual([
      {
        id: ID,
        token: NEW_TOKEN,
        savedAt: new Date('2026-09-22').toISOString(),
        lat: 25.1,
        lng: 121.5,
        species: '榕',
      },
    ]);
  });
});

describe('removeEditLink', () => {
  it('removes only the named report', () => {
    const storage = fakeStorage();
    saveEditLink(storage, { id: ID, token: TOKEN }, {}, new Date());
    saveEditLink(storage, { id: OTHER, token: TOKEN }, {}, new Date());

    expect(removeEditLink(storage, ID).map((entry) => entry.id)).toEqual([OTHER]);
    expect(readEditLinks(storage).map((entry) => entry.id)).toEqual([OTHER]);
  });
});
