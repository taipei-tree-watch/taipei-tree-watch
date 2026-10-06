/**
 * The card shown when a report or a protected tree is clicked.
 *
 * Wording follows the spec: the cause line quotes what the notice recorded
 * rather than asserting a diagnosis, and it is left out entirely when the
 * reporter had no document to go on. External links are rendered as their
 * hostname only, with nofollow so link spam has nothing to gain.
 *
 * A user report's card also offers what to do about it: report a change as a
 * follow-up, correct what it says, or leave it. It shows how often it was
 * corrected, loading the list of corrections only when asked, and links the
 * other reports of the same tree.
 */
import { taipeiDate } from '../../../shared/validation.ts';
import type { RevisionEntry, RevisionsLoader } from '../data/revisions.ts';
import type { ReportRecord } from '../data/snapshot.ts';
import type { ProtectedTree } from '../data/trees.ts';
import { formatTemplate, linkHostname } from '../format.ts';
import type { PermalinkTarget } from '../permalink.ts';
import type { CopyOutcome } from '../copy-link.ts';
import { describeRevision } from '../report/correction.ts';
import { reportRows } from './report-rows.ts';
import {
  CirclePlus,
  Ellipsis,
  Equal,
  FilePen,
  Link,
  List,
  MapPin,
  Pencil,
  setIconLabel,
  setIconOnly,
  X,
} from '../icons.ts';
import strings from '../ui-strings.json';

export interface DetailCardOptions {
  /** The address to copy for the card that is open. */
  readonly permalinkUrl: (target: PermalinkTarget) => string;
  readonly copy: (url: string) => Promise<CopyOutcome>;
  /** Confirms a copy in the page-wide toast. */
  readonly notify: (message: string) => void;
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
  /** Other reports of the same tree, oldest first. */
  readonly sameTreeReports: (report: ReportRecord) => readonly ReportRecord[];
  readonly loadRevisions: RevisionsLoader;
  /** The tree has changed since this report: file a follow-up. */
  readonly onFollowUp: (report: ReportRecord) => void;
  /** This report says something wrong: correct it. */
  readonly onCorrect: (report: ReportRecord) => void;
  /** Open another report's card, as its permalink would. */
  readonly onShowReport: (report: ReportRecord) => void;
}

export interface DetailCard {
  showReport(report: ReportRecord): void;
  showTree(tree: ProtectedTree): void;
  hide(): void;
  /**
   * Copy the open card's permalink. The copy button calls this; a test can
   * call it directly and await the outcome.
   */
  copyCurrent(): Promise<void>;
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

/** Follow-ups and corrections concern reports held on the server by users. */
function acceptsFollowUps(report: ReportRecord): boolean {
  return report.pending !== true && (report.source === null || report.source === 1);
}

function dateOf(iso: string | null | undefined): string | null {
  if (iso === null || iso === undefined) {
    return null;
  }
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : taipeiDate(new Date(time));
}

function revisionItem(entry: RevisionEntry): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'card-revision';

  const date = dateOf(entry.createdAt);
  if (date !== null) {
    const heading = document.createElement('p');
    heading.className = 'card-revision-date';
    heading.textContent = date;
    item.append(heading);
  }
  for (const line of describeRevision(entry.changes, entry.previous)) {
    const row = document.createElement('p');
    row.className = 'card-revision-change';
    const label = document.createElement('span');
    label.className = 'card-label';
    label.textContent = line.label;
    row.append(
      label,
      document.createTextNode(formatTemplate(strings.revisions.arrow, { from: line.from, to: line.to })),
    );
    item.append(row);
  }
  const reason = document.createElement('p');
  reason.className = 'card-revision-reason';
  reason.textContent = formatTemplate(strings.revisions.reason, { reason: entry.reason });
  item.append(reason);

  const hostname = entry.link === null ? null : linkHostname(entry.link);
  if (entry.link !== null && hostname !== null) {
    const line = document.createElement('p');
    line.className = 'card-revision-reason';
    const anchor = document.createElement('a');
    anchor.href = entry.link;
    anchor.textContent = hostname;
    anchor.rel = 'nofollow noopener';
    anchor.target = '_blank';
    line.append(strings.revisions.link, anchor);
    item.append(line);
  }
  return item;
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

  // Shown only when the clipboard refused, so the reader still has the
  // address in front of them to copy by hand.
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

  // What to do about a user report: the same three choices the report sheet
  // offers when its crosshair finds this report nearby.
  const aboutButton = document.createElement('button');
  aboutButton.type = 'button';
  aboutButton.className = 'form-secondary';
  setIconLabel(aboutButton, Ellipsis, strings.card.about);
  aboutButton.setAttribute('aria-expanded', 'false');
  aboutButton.hidden = true;

  const aboutBox = document.createElement('div');
  aboutBox.className = 'form-nearby card-about';
  aboutBox.id = 'card-about';
  aboutBox.hidden = true;
  aboutButton.setAttribute('aria-controls', aboutBox.id);
  const aboutHint = document.createElement('p');
  aboutHint.className = 'form-nearby-question';
  aboutHint.textContent = strings.card.aboutHint;
  const aboutActions = document.createElement('div');
  aboutActions.className = 'form-picker-actions';
  const choice = (icon: Parameters<typeof setIconLabel>[1], label: string): HTMLButtonElement => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'form-secondary';
    setIconLabel(element, icon, label);
    aboutActions.append(element);
    return element;
  };
  const followUpButton = choice(CirclePlus, strings.card.followUp);
  const correctButton = choice(FilePen, strings.card.correct);
  const unchangedButton = choice(Equal, strings.card.unchanged);
  aboutBox.append(aboutHint, aboutActions);

  share.append(
    reportTreeButton,
    shareButton,
    editButton,
    aboutButton,
    aboutBox,
    feedback,
    manualUrl,
  );

  element.replaceChildren(header, body, share);

  let target: PermalinkTarget | null = null;
  let openTree: ProtectedTree | null = null;
  let openReport: ReportRecord | null = null;

  const setAboutOpen = (open: boolean): void => {
    aboutBox.hidden = !open;
    aboutButton.setAttribute('aria-expanded', String(open));
  };

  aboutButton.addEventListener('click', () => {
    setAboutOpen(aboutButton.getAttribute('aria-expanded') !== 'true');
  });
  followUpButton.addEventListener('click', () => {
    if (openReport !== null) {
      options.onFollowUp(openReport);
    }
  });
  correctButton.addEventListener('click', () => {
    if (openReport !== null) {
      options.onCorrect(openReport);
    }
  });
  unchangedButton.addEventListener('click', () => {
    setAboutOpen(false);
  });

  /** "Corrected N times", with the list of corrections behind a button. */
  const revisionsSection = (report: ReportRecord): HTMLElement | null => {
    const count = report.revisionCount ?? 0;
    if (count === 0) {
      return null;
    }
    const section = document.createElement('section');
    section.className = 'card-revisions';
    const summary = document.createElement('p');
    summary.className = 'form-hint';
    summary.textContent = formatTemplate(strings.card.revised, {
      count,
      date: dateOf(report.revisedAt) ?? '',
    });
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'form-secondary';
    setIconLabel(toggle, List, strings.card.showRevisions);
    toggle.setAttribute('aria-expanded', 'false');
    const list = document.createElement('ol');
    list.className = 'card-revision-list';
    list.hidden = true;
    const status = document.createElement('p');
    status.className = 'form-hint';
    status.hidden = true;

    let loaded = false;
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      setIconLabel(toggle, List, open ? strings.card.hideRevisions : strings.card.showRevisions);
      if (!open) {
        list.hidden = true;
        status.hidden = true;
        return;
      }
      if (loaded) {
        list.hidden = false;
        return;
      }
      status.hidden = false;
      status.textContent = strings.card.revisionsLoading;
      options
        .loadRevisions()
        .then((revisions) => {
          const entries = revisions.get(report.id) ?? [];
          if (entries.length === 0) {
            status.textContent = strings.card.revisionsStale;
            return;
          }
          loaded = true;
          list.replaceChildren(...[...entries].reverse().map(revisionItem));
          status.hidden = true;
          list.hidden = toggle.getAttribute('aria-expanded') !== 'true';
        })
        .catch((error: unknown) => {
          console.error('revisions failed to load', error);
          status.textContent = strings.card.revisionsFailed;
        });
    });

    section.append(summary, toggle, status, list);
    return section;
  };

  /** Other reports of the same tree, each opening its own card. */
  const sameTreeSection = (report: ReportRecord): HTMLElement | null => {
    const others = options.sameTreeReports(report);
    if (others.length === 0) {
      return null;
    }
    const section = document.createElement('section');
    section.className = 'card-same-tree';
    const heading = document.createElement('p');
    heading.className = 'form-hint';
    heading.textContent = formatTemplate(strings.card.sameTree, { count: others.length });
    const list = document.createElement('ul');
    list.className = 'card-same-tree-list';
    for (const other of others) {
      const item = document.createElement('li');
      const anchor = document.createElement('a');
      anchor.href = options.permalinkUrl({ kind: 'report', id: other.id });
      const date = other.observedAt ?? dateOf(other.createdAt);
      anchor.textContent =
        date === null ? strings.card.sameTreeUndated : formatTemplate(strings.card.sameTreeItem, { date });
      anchor.addEventListener('click', (event) => {
        event.preventDefault();
        options.onShowReport(other);
      });
      item.append(anchor);
      list.append(item);
    }
    section.append(heading, list);
    return section;
  };

  const clearFeedback = (): void => {
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

  const copyCurrent = async (): Promise<void> => {
    if (target === null) {
      return;
    }
    const url = options.permalinkUrl(target);
    clearFeedback();
    const outcome = await options.copy(url);
    if (outcome === 'copied') {
      options.notify(strings.card.copied);
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
    void copyCurrent();
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
      openReport = report;
      reportTreeButton.hidden = true;
      aboutButton.hidden = !acceptsFollowUps(report);
      setAboutOpen(false);
      render(strings.card.reportTitle, { kind: 'report', id: report.id }, [
        report.pending === true ? pendingNotice() : null,
        ...reportRows(report),
        revisionsSection(report),
        sameTreeSection(report),
      ]);
    },
    showTree(tree) {
      openTree = tree;
      openReport = null;
      aboutButton.hidden = true;
      setAboutOpen(false);
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
    copyCurrent,
  };
}
