/**
 * Static explanatory copy. Every fragment lives in its own .html file so that
 * this module stays ASCII: the section heading is the fragment's own leading
 * <h2>, never a string literal here.
 */

import aboutHtml from './about.html?raw';
import attributionHtml from './attribution.html?raw';
import brownRootRotHtml from './brown-root-rot.html?raw';
import disclaimerHtml from './disclaimer.html?raw';
import noNoticeHtml from './no-notice.html?raw';
import safetyHtml from './safety.html?raw';

export { aboutHtml, attributionHtml, brownRootRotHtml, disclaimerHtml, noNoticeHtml, safetyHtml };

export interface ContentSection {
  /** Stable slug used for the DOM id and for deep links. */
  id: string;
  /** Plain text of the fragment's leading <h2>, used as the disclosure label. */
  title: string;
  /** The fragment with its leading <h2> removed, so the label is not repeated. */
  html: string;
  /** Rendered expanded by default. */
  open: boolean;
}

const LEADING_HEADING = /^\s*<h2\b[^>]*>([\s\S]*?)<\/h2>/;

function toSection(id: string, fragment: string, open = false): ContentSection {
  const heading = LEADING_HEADING.exec(fragment);
  const title = heading?.[1];
  if (heading === null || title === undefined) {
    throw new Error(`content fragment "${id}" must start with an <h2> heading`);
  }
  return {
    id,
    title: title.replace(/<[^>]*>/g, '').trim(),
    html: fragment.slice(heading[0].length).trim(),
    open,
  };
}

/**
 * Display order. Safety comes first and starts expanded; the "no notice is
 * required" explanation follows it because SPEC section 8 asks for it to be
 * prominent rather than buried in the disclaimer.
 */
export const sections: readonly ContentSection[] = [
  toSection('safety', safetyHtml, true),
  toSection('no-notice', noNoticeHtml),
  toSection('about', aboutHtml),
  toSection('brown-root-rot', brownRootRotHtml),
  toSection('disclaimer', disclaimerHtml),
  toSection('attribution', attributionHtml),
];

/** Raw fragments keyed by section id, in the same order as `sections`. */
export const fragments: Readonly<Record<string, string>> = {
  safety: safetyHtml,
  'no-notice': noNoticeHtml,
  about: aboutHtml,
  'brown-root-rot': brownRootRotHtml,
  disclaimer: disclaimerHtml,
  attribution: attributionHtml,
};
