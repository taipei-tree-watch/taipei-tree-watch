/**
 * Which colour scheme the page is painted in.
 *
 * The scheme is the device's own preference and nothing else: there is no
 * in-page toggle and no stored override, so `prefers-color-scheme` is the
 * single source of truth. CSS follows it through a media query; this module
 * exists for the parts that CSS cannot reach, which is the MapLibre style,
 * whose paint properties are set from JavaScript.
 *
 * The watcher is written against the small slice of MediaQueryList it needs,
 * so it can be driven by a fake in tests and by the real matchMedia in the
 * browser.
 */

export type ColorScheme = 'light' | 'dark';

/** The query the whole page agrees on; CSS uses the same one. */
export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

/** Minimal shape of a MediaQueryList: what the watcher reads and listens to. */
export interface SchemeMediaQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void;
  removeEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void;
}

export interface SchemeMediaSource {
  matchMedia(query: string): SchemeMediaQuery;
}

/** A device that reports no preference is treated as light. */
export function schemeFromMatches(matchesDark: boolean): ColorScheme {
  return matchesDark ? 'dark' : 'light';
}

export interface SchemeWatcher {
  /** Scheme at this moment; updated before listeners are called. */
  current(): ColorScheme;
  /** Subscribe to changes. Returns an unsubscribe function. */
  subscribe(listener: (scheme: ColorScheme) => void): () => void;
  /** Detach from the media query; later changes are ignored. */
  stop(): void;
}

/**
 * Watch a media query for scheme changes. Listeners only hear about a change
 * when the scheme actually flips, so a redundant media event cannot make the
 * map rewrite its paint properties.
 */
export function watchColorScheme(query: SchemeMediaQuery): SchemeWatcher {
  let scheme = schemeFromMatches(query.matches);
  const listeners = new Set<(scheme: ColorScheme) => void>();

  const onChange = (event: { matches: boolean }): void => {
    const next = schemeFromMatches(event.matches);
    if (next === scheme) {
      return;
    }
    scheme = next;
    for (const listener of listeners) {
      listener(next);
    }
  };

  query.addEventListener('change', onChange);

  return {
    current() {
      return scheme;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      query.removeEventListener('change', onChange);
      listeners.clear();
    },
  };
}

/**
 * Watcher over the real device preference. A browser without matchMedia, and
 * the jsdom-free unit test environment, get a watcher stuck on light rather
 * than a thrown error.
 */
export function watchDeviceColorScheme(source: SchemeMediaSource | undefined): SchemeWatcher {
  if (source === undefined || typeof source.matchMedia !== 'function') {
    return {
      current: () => 'light',
      subscribe: () => () => true,
      stop: () => undefined,
    };
  }
  return watchColorScheme(source.matchMedia(DARK_SCHEME_QUERY));
}
