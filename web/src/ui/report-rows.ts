/**
 * One report rendered as elements, from the rows summary.ts decided on.
 *
 * Both places that show a whole report use this: the card opened from the
 * map, and the sheet after a submission. They share the markup as well as
 * the wording, so a reporter sees their own report in the form they will
 * find it in later.
 */
import type { ReportRecord } from '../data/snapshot.ts';
import { reportSummary } from '../report/summary.ts';
import strings from '../ui-strings.json';

function row(label: string, value: Node | string): HTMLDivElement {
  const line = document.createElement('div');
  line.className = 'card-row';

  const caption = document.createElement('span');
  caption.className = 'card-label';
  caption.textContent = label;

  const content = document.createElement('span');
  content.className = 'card-value';
  content.append(value);

  line.append(caption, content);
  return line;
}

/** A new tab keeps the map where the reader left it. */
function anchor(href: string, text: string): HTMLAnchorElement {
  const element = document.createElement('a');
  element.href = href;
  element.textContent = text;
  element.rel = 'nofollow noopener';
  element.target = '_blank';
  return element;
}

export function reportRows(report: ReportRecord): HTMLElement[] {
  const summary = reportSummary(report);
  const parts: HTMLElement[] = [];

  if (summary.caveat !== null) {
    const caveat = document.createElement('p');
    caveat.className = 'card-notice card-planned';
    caveat.textContent = summary.caveat;
    parts.push(caveat);
  }

  if (summary.notice !== null) {
    const sentence = document.createElement('p');
    sentence.className = 'card-notice';
    sentence.textContent = summary.notice;
    parts.push(sentence);
  }

  for (const entry of summary.rows) {
    parts.push(row(entry.label, entry.href === undefined ? entry.value : anchor(entry.href, entry.value)));
  }

  if (summary.link !== null) {
    // The hostname stands in for the address, and nofollow leaves link spam
    // nothing to gain.
    parts.push(row(strings.card.link, anchor(summary.link.href, summary.link.hostname)));
  }

  return parts;
}
