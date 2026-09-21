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

export function reportRows(report: ReportRecord): HTMLElement[] {
  const summary = reportSummary(report);
  const parts: HTMLElement[] = [];

  if (summary.notice !== null) {
    const sentence = document.createElement('p');
    sentence.className = 'card-notice';
    sentence.textContent = summary.notice;
    parts.push(sentence);
  }

  for (const entry of summary.rows) {
    parts.push(row(entry.label, entry.value));
  }

  if (summary.link !== null) {
    // The hostname stands in for the address, and nofollow leaves link spam
    // nothing to gain. A new tab keeps the map where the reporter left it.
    const anchor = document.createElement('a');
    anchor.href = summary.link.href;
    anchor.textContent = summary.link.hostname;
    anchor.rel = 'nofollow noopener';
    anchor.target = '_blank';
    parts.push(row(strings.card.link, anchor));
  }

  return parts;
}
