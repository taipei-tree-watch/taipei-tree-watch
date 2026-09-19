import { describe, expect, it } from 'vitest';

import { attributionHtml, fragments, sections } from '../src/content/index.ts';

/**
 * Terms that RESEARCH.md section 6.7 could not trace to any authoritative
 * source, and that section 8.7 therefore keeps out of the explanatory copy:
 * calcium cyanamide, solar soil disinfestation and diniconazole.
 */
const BANNED_TERMS = [
  '\u6C30\u6C2E\u5316\u9223',
  '\u592A\u967D\u80FD\u6D88\u6BD2',
  '\u5F85\u514B\u5229',
] as const;

/** The four part map attribution fixed by TECH-SPEC.md section 7. */
const MAP_ATTRIBUTION =
  '\u5E95\u5716 \u00A9 \u5167\u653F\u90E8\u570B\u571F\u6E2C\u7E6A\u4E2D\u5FC3' +
  '\uFF5C\u822A\u7167 \u00A9 \u81FA\u5317\u5E02\u653F\u5E9C\u90FD\u5E02\u767C\u5C55\u5C40' +
  '\uFF5C\u53D7\u4FDD\u8B77\u6A39\u6728 \u00A9 \u81FA\u5317\u5E02\u653F\u5E9C\u6587\u5316\u5C40\uFF08\u653F\u5E9C\u8CC7\u6599\u958B\u653E\u6388\u6B0A\u689D\u6B3E\uFF0D\u7B2C1\u7248\uFF09' +
  '\uFF5C\u56DE\u5831\u8CC7\u6599 CC BY 4.0';

const SECTION_IDS = [
  'safety',
  'no-notice',
  'about',
  'brown-root-rot',
  'disclaimer',
  'attribution',
] as const;

describe('web/src/content fragments', () => {
  it('exposes every section once, safety first and expanded', () => {
    expect(sections.map((section) => section.id)).toEqual([...SECTION_IDS]);
    expect(Object.keys(fragments)).toEqual([...SECTION_IDS]);
    expect(sections[0]?.open).toBe(true);
    expect(sections.slice(1).some((section) => section.open)).toBe(false);
  });

  it.each(SECTION_IDS)('%s is non-empty and starts with an h2 heading', (id) => {
    const fragment = fragments[id];
    expect(fragment).toBeDefined();
    expect(fragment?.trim().length ?? 0).toBeGreaterThan(0);
    expect(fragment?.trimStart().startsWith('<h2')).toBe(true);
  });

  it.each(SECTION_IDS)('%s yields a title and a body without the heading', (id) => {
    const section = sections.find((candidate) => candidate.id === id);
    expect(section?.title.length ?? 0).toBeGreaterThan(0);
    expect(section?.title).not.toContain('<');
    expect(section?.html.startsWith('<h2')).toBe(false);
    expect(section?.html.length ?? 0).toBeGreaterThan(0);
  });

  it.each(BANNED_TERMS)('is absent from every fragment: %s', (term) => {
    const offenders = Object.entries(fragments)
      .filter(([, fragment]) => fragment.includes(term))
      .map(([id]) => id);
    expect(offenders).toEqual([]);
  });

  it('carries the map attribution verbatim', () => {
    expect(attributionHtml).toContain(MAP_ATTRIBUTION);
  });
});
