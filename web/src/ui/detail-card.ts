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
import type { PermalinkTarget } from '../permalink.ts';
import type { ShareOutcome } from '../share.ts';
import { reportRows } from './report-rows.ts';
import { Link, MapPin, Pencil, setIconLabel, setIconOnly, X } from '../icons.ts';
import strings from '../ui-strings.json';

/** How long the copied confirmation stays on the card. */
export const SHARE_FEEDBACK_MS = 4000;

export interface DetailCardOptions {
  /** The address to share for the card that is open. */
  readonly permalinkUrl: (target: PermalinkTarget) => string;
  readonly share: (url: string, title: string) => Promise<ShareOutcome>;
  /**
   * The card that is now open, or null when it closed. The page turns this
   * into the address bar, so every way of opening a card updates the URL.
   */
  readonly onTargetChange: (target: PermalinkTarget | null) => void;
  /** True when this browser holds the report's edit link. */
  readonly canEdit: (id: string) => boolean;
  readonly onEdit: (id: string) => void;
  /** Start a report about the protected tree whose card is open. */
  readonly onReportTree: (tree: ProtectedTree) => void;
  readonly feedbackMs?: number;
}

export interface DetailCard {
  showReport(report: ReportRecord): void;
  showTree(tree: ProtectedTree): void;
  hide(): void;
  /**
   * Share or copy the open card's permalink. The share button calls this; a
   * test can call it directly and await the outcome.
   */
  shareCurrent(): Promise<void>;
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

/**
 * Heads a report only this browser holds so far. The map marks it too, but
 * the card is where the reporter reads, and where they would share a link
 * that nobody else can open yet.
 */
function pendingNotice(): HTMLParagraphElement {
  const notice = document.createElement('p');
  notice.className = 'card-notice card-pending';
  notice.textContent = strings.card.pending;
  return notice;
}

export function createDetailCard(element: HTMLElement, options: DetailCardOptions): DetailCard {
  const header = document.createElement('div');
  header.className = 'card-header';

  const title = document.createElement('h2');
  header.append(title);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'panel-close';
  setIconOnly(close, X, strings.card.close);
  header.append(close);

  const body = document.createElement('div');
  body.className = 'card-body';

  // The share row sits below the body so a long card scrolls its rows without
  // pushing the button off a phone screen.
  const share = document.createElement('div');
  share.className = 'card-share';

  const shareButton = document.createElement('button');
  shareButton.type = 'button';
  shareButton.className = 'form-secondary';
  setIconLabel(shareButton, Link, strings.card.copyLink);

  const feedback = document.createElement('p');
  feedback.className = 'card-share-feedback';
  feedback.hidden = true;

  // Shown only when neither the share sheet nor the clipboard worked, so the
  // reader still has the address in front of them to copy by hand.
  const manualUrl = document.createElement('p');
  manualUrl.className = 'card-share-url';
  manualUrl.hidden = true;

  // Only for a report whose edit link this browser holds. The card is what
  // a reporter taps on the map, so the way back into the form starts here.
  const editButton = document.createElement('button');
  editButton.type = 'button';
  editButton.className = 'form-secondary';
  setIconLabel(editButton, Pencil, strings.card.edit);
  editButton.hidden = true;

  // Only a protected tree card offers this: a report is already a report.
  const reportTreeButton = document.createElement('button');
  reportTreeButton.type = 'button';
  reportTreeButton.className = 'form-submit';
  setIconLabel(reportTreeButton, MapPin, strings.card.reportTree);
  reportTreeButton.hidden = true;

  share.append(reportTreeButton, shareButton, editButton, feedback, manualUrl);

  element.replaceChildren(header, body, share);

  let target: PermalinkTarget | null = null;
  let openTree: ProtectedTree | null = null;
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

  const clearFeedback = (): void => {
    if (feedbackTimer !== null) {
      clearTimeout(feedbackTimer);
      feedbackTimer = null;
    }
    feedback.hidden = true;
    feedback.textContent = '';
    manualUrl.hidden = true;
    manualUrl.textContent = '';
  };

  const hide = (): void => {
    element.hidden = true;
    clearFeedback();
    if (target !== null) {
      target = null;
      options.onTargetChange(null);
    }
  };

  close.addEventListener('click', hide);

  const shareCurrent = async (): Promise<void> => {
    if (target === null) {
      return;
    }
    const url = options.permalinkUrl(target);
    clearFeedback();
    const outcome = await options.share(url, strings.app.title);
    if (outcome === 'copied') {
      feedback.hidden = false;
      feedback.textContent = strings.card.copied;
      feedbackTimer = setTimeout(clearFeedback, options.feedbackMs ?? SHARE_FEEDBACK_MS);
      return;
    }
    if (outcome === 'manual') {
      feedback.hidden = false;
      feedback.textContent = strings.card.copyManual;
      manualUrl.hidden = false;
      manualUrl.textContent = url;
    }
  };

  shareButton.addEventListener('click', () => {
    void shareCurrent();
  });

  editButton.addEventListener('click', () => {
    if (target?.kind === 'report') {
      options.onEdit(target.id);
    }
  });

  reportTreeButton.addEventListener('click', () => {
    if (openTree !== null) {
      options.onReportTree(openTree);
    }
  });

  const render = (
    heading: string,
    next: PermalinkTarget,
    parts: readonly (Node | null)[],
  ): void => {
    title.textContent = heading;
    body.replaceChildren(...parts.filter((part): part is Node => part !== null));
    clearFeedback();
    target = next;
    editButton.hidden = !(next.kind === 'report' && options.canEdit(next.id));
    element.hidden = false;
    element.scrollTop = 0;
    options.onTargetChange(next);
  };

  return {
    showReport(report) {
      openTree = null;
      reportTreeButton.hidden = true;
      render(strings.card.reportTitle, { kind: 'report', id: report.id }, [
        report.pending === true ? pendingNotice() : null,
        ...reportRows(report),
      ]);
    },
    showTree(tree) {
      openTree = tree;
      reportTreeButton.hidden = false;
      render(strings.card.treeTitle, { kind: 'tree', id: tree.id }, [
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
    hide,
    shareCurrent,
  };
}
