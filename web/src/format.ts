/**
 * Presentation helpers shared by the card and the filter panel.
 *
 * Tag codes are turned into labels here so no module has to carry Chinese
 * text of its own, and external links are reduced to their hostname before
 * they reach the DOM.
 */
import type { Tag } from '../../shared/tags.ts';

/**
 * Hostname of an external link, for display in place of the full URL.
 *
 * Showing only the domain is a spam countermeasure: a full URL can be dressed
 * up to look like a different site. Returns null when the value is not a
 * usable http(s) URL, and the caller then renders nothing.
 */
export function linkHostname(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  return hostname.length === 0 ? null : hostname;
}

export function labelForCode(dimension: readonly Tag[], code: number | null): string | null {
  if (code === null) {
    return null;
  }
  return dimension.find((tag) => tag.code === code)?.label ?? null;
}

export function labelsForCodes(dimension: readonly Tag[], codes: readonly number[]): string[] {
  return codes
    .map((code) => labelForCode(dimension, code))
    .filter((label): label is string => label !== null);
}

/** Substitute {name} placeholders in a UI string. */
export function formatTemplate(
  template: string,
  values: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}
