import { describe, expect, it, vi } from 'vitest';

import type { SchemeMediaQuery } from '../src/theme.ts';
import { schemeFromMatches, watchColorScheme, watchDeviceColorScheme } from '../src/theme.ts';

/** Stand in for MediaQueryList: the test decides when the preference flips. */
function fakeQuery(matches: boolean): SchemeMediaQuery & {
  emit(next: boolean): void;
  listenerCount(): number;
} {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  let current = matches;

  return {
    get matches() {
      return current;
    },
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
    emit(next: boolean) {
      current = next;
      for (const listener of [...listeners]) {
        listener({ matches: next });
      }
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

describe('colour scheme watcher', () => {
  it('reads the scheme from the query, treating no preference as light', () => {
    expect(schemeFromMatches(true)).toBe('dark');
    expect(schemeFromMatches(false)).toBe('light');
    expect(watchColorScheme(fakeQuery(true)).current()).toBe('dark');
    expect(watchColorScheme(fakeQuery(false)).current()).toBe('light');
  });

  it('tells subscribers when the preference flips, and updates current first', () => {
    const query = fakeQuery(false);
    const watcher = watchColorScheme(query);
    const seen: string[] = [];
    watcher.subscribe((scheme) => {
      seen.push(`${scheme}:${watcher.current()}`);
    });

    query.emit(true);
    query.emit(false);

    expect(seen).toEqual(['dark:dark', 'light:light']);
  });

  it('stays quiet when an event repeats the scheme already in force', () => {
    const query = fakeQuery(false);
    const watcher = watchColorScheme(query);
    const listener = vi.fn();
    watcher.subscribe(listener);

    query.emit(false);
    query.emit(true);
    query.emit(true);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('dark');
  });

  it('drops an unsubscribed listener and detaches from the query on stop', () => {
    const query = fakeQuery(false);
    const watcher = watchColorScheme(query);
    const listener = vi.fn();
    const unsubscribe = watcher.subscribe(listener);

    unsubscribe();
    query.emit(true);
    expect(listener).not.toHaveBeenCalled();

    expect(query.listenerCount()).toBe(1);
    watcher.stop();
    expect(query.listenerCount()).toBe(0);
  });

  it('falls back to light where matchMedia is unavailable', () => {
    const watcher = watchDeviceColorScheme(undefined);
    const listener = vi.fn();
    watcher.subscribe(listener);
    watcher.stop();

    expect(watcher.current()).toBe('light');
    expect(listener).not.toHaveBeenCalled();
  });

  it('asks the device for the dark query it is given', () => {
    const query = fakeQuery(true);
    const matchMedia = vi.fn(() => query);

    const watcher = watchDeviceColorScheme({ matchMedia });

    expect(matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');
    expect(watcher.current()).toBe('dark');
  });
});
