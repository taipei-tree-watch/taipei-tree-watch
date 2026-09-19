/**
 * The card shown when a report or a protected tree is clicked.
 *
 * Wording follows the spec: the cause line quotes what the notice recorded
 * rather than asserting a diagnosis, and it is left out entirely when the
 * reporter had no document to go on. External links are rendered as their
 * hostname only, with nofollow so link spam has nothing to gain.
 */
import { EVIDENCE_CODES_WITHOUT_CAUSES, causes, dispositions, evidence, sources } from '../../../shared/tags.ts';
import type { ReportRecord } from '../data/snapshot.ts';
import type { ProtectedTree } from '../data/trees.ts';
import { formatTemplate, labelForCode, labelsForCodes, linkHostname } from '../format.ts';
import strings from '../ui-strings.json';

export interface DetailCard {
  showReport(report: ReportRecord): void;
  showTree(tree: ProtectedTree): void;
  hide(): void;
}

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

function textRow(label: string, value: string | null): HTMLDivElement | null {
  return value === null ? null : row(label, value);
}

/**
 * The link element: hostname as the visible text, nofollow and noopener on the
 * relationship, and a new tab so the map is not lost.
 */
function linkRow(value: string | null): HTMLDivElement | null {
  if (value === null) {
    return null;
  }
  const hostname = linkHostname(value);
  if (hostname === null) {
    return null;
  }
  const anchor = document.createElement('a');
  anchor.href = value;
  anchor.textContent = hostname;
  anchor.rel = 'nofollow noopener';
  anchor.target = '_blank';
  return row(strings.card.link, anchor);
}

/**
 * The cause sentence. It appears only when a cause was actually recorded and
 * the evidence is something written down: a sighting with no notice carries no
 * recorded cause, so the sentence would be claiming more than the data says.
 */
function causeSentence(report: ReportRecord): HTMLParagraphElement | null {
  if (report.causes.length === 0) {
    return null;
  }
  if (
    report.evidence !== null &&
    (EVIDENCE_CODES_WITHOUT_CAUSES as readonly number[]).includes(report.evidence)
  ) {
    return null;
  }
  const labels = labelsForCodes(causes, report.causes);
  if (labels.length === 0) {
    return null;
  }
  const sentence = document.createElement('p');
  sentence.className = 'card-notice';
  sentence.textContent = formatTemplate(strings.card.noticeReason, {
    causes: labels.join(strings.card.listSeparator),
  });
  return sentence;
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
      render(strings.card.reportTitle, [
        causeSentence(report),
        textRow(strings.card.species, report.species),
        textRow(
          strings.card.causes,
          report.causes.length === 0
            ? null
            : labelsForCodes(causes, report.causes).join(strings.card.listSeparator),
        ),
        textRow(
          strings.card.dispositions,
          report.dispositions.length === 0
            ? null
            : labelsForCodes(dispositions, report.dispositions).join(strings.card.listSeparator),
        ),
        textRow(strings.card.evidence, labelForCode(evidence, report.evidence)),
        textRow(strings.card.source, labelForCode(sources, report.source)),
        textRow(strings.card.observedAt, report.observedAt),
        textRow(strings.card.note, report.note),
        textRow(
          strings.card.protectedTree,
          report.protectedTreeId === null
            ? null
            : formatTemplate(strings.card.protectedTreeValue, { id: report.protectedTreeId }),
        ),
        linkRow(report.link),
      ]);
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
