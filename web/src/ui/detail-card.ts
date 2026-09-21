/**
 * The card shown when a report or a protected tree is clicked.
 *
 * Wording follows the spec: the cause line quotes what the notice recorded
 * rather than asserting a diagnosis, and it is left out entirely when the
 * reporter had no document to go on. External links are rendered as their
 * hostname only, with nofollow so link spam has nothing to gain.
 */
import type { ReportRecord } from '../data/snapshot.ts';
import type { ProtectedTree } from '../data/trees.ts';
import { formatTemplate } from '../format.ts';
import { reportRows } from './report-rows.ts';
import strings from '../ui-strings.json';

export interface DetailCard {
  showReport(report: ReportRecord): void;
  showTree(tree: ProtectedTree): void;
  hide(): void;
}

/** A row of the protected tree card; a report's rows come from report-rows. */
function textRow(label: string, value: string | null): HTMLDivElement | null {
  if (value === null) {
    return null;
  }
  const line = document.createElement('div');
  line.className = 'card-row';

  const caption = document.createElement('span');
  caption.className = 'card-label';
  caption.textContent = label;

  const content = document.createElement('span');
  content.className = 'card-value';
  content.textContent = value;

  line.append(caption, content);
  return line;
}

export function createDetailCard(element: HTMLElement): DetailCard {
  const header = document.createElement('div');
  header.className = 'card-header';

  const title = document.createElement('h2');
  header.append(title);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'panel-close';
  close.setAttribute('aria-label', strings.card.close);
  close.textContent = 'x';
  header.append(close);

  const body = document.createElement('div');
  body.className = 'card-body';

  element.replaceChildren(header, body);
  close.addEventListener('click', () => {
    element.hidden = true;
  });

  const render = (heading: string, parts: readonly (Node | null)[]): void => {
    title.textContent = heading;
    body.replaceChildren(...parts.filter((part): part is Node => part !== null));
    element.hidden = false;
    element.scrollTop = 0;
  };

  return {
    showReport(report) {
      render(strings.card.reportTitle, reportRows(report));
    },
    showTree(tree) {
      render(strings.card.treeTitle, [
        textRow(strings.card.treeId, tree.id),
        textRow(strings.card.species, tree.species),
        textRow(
          strings.card.dbh,
          tree.dbhM === null ? null : formatTemplate(strings.card.dbhValue, { value: tree.dbhM }),
        ),
        textRow(strings.card.address, tree.address),
        textRow(strings.card.manager, tree.manager),
      ]);
    },
    hide() {
      element.hidden = true;
    },
  };
}
