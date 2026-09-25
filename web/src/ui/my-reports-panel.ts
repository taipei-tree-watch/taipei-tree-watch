/**
 * "My reports": the edit links this browser holds, opened from the top bar.
 *
 * The panel only lists and hands out; what a link does is decided by the
 * page. Its chip is hidden while the list is empty, so a visitor who never
 * reported sees no trace of the feature.
 */
import { formatTemplate } from '../format.ts';
import type { StoredEditLink } from '../report/edit-links.ts';
import type { ShareOutcome } from '../share.ts';
import { setIconOnly, X } from '../icons.ts';
import strings from '../ui-strings.json';

/** How long a copied confirmation stays beside an entry. */
export const MINE_FEEDBACK_MS = 4000;

export interface MyReportsPanelOptions {
  readonly onShow: (link: StoredEditLink) => void;
  readonly onEdit: (link: StoredEditLink) => void;
  readonly editLinkUrl: (link: StoredEditLink) => string;
  readonly share: (url: string, title: string) => Promise<ShareOutcome>;
  readonly feedbackMs?: number;
}

export interface MyReportsPanel {
  setLinks(links: readonly StoredEditLink[]): void;
  setOpen(open: boolean): void;
  isOpen(): boolean;
  onOpenChange(listener: (open: boolean) => void): () => void;
}

/** The local calendar date of an ISO timestamp, as the list shows it. */
function savedDate(savedAt: string): string {
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) {
    return savedAt;
  }
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function createMyReportsPanel(
  element: HTMLElement,
  options: MyReportsPanelOptions,
): MyReportsPanel {
  const header = document.createElement('div');
  header.className = 'panel-header';

  const title = document.createElement('h2');
  title.textContent = strings.mine.title;
  header.append(title);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'panel-close';
  setIconOnly(close, X, strings.mine.close);
  header.append(close);

  const body = document.createElement('div');
  body.className = 'panel-body';

  const intro = document.createElement('p');
  intro.className = 'form-hint';
  intro.textContent = strings.mine.intro;

  const list = document.createElement('ul');
  list.className = 'mine-list';

  const empty = document.createElement('p');
  empty.className = 'form-hint';
  empty.textContent = strings.mine.empty;

  body.append(intro, list, empty);
  element.replaceChildren(header, body);

  const listeners = new Set<(open: boolean) => void>();
  const setOpen = (open: boolean): void => {
    element.hidden = !open;
    for (const listener of listeners) {
      listener(open);
    }
  };
  close.addEventListener('click', () => {
    setOpen(false);
  });

  function button(label: string, onClick: () => void): HTMLButtonElement {
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'form-secondary';
    control.textContent = label;
    control.addEventListener('click', onClick);
    return control;
  }

  function item(link: StoredEditLink): HTMLLIElement {
    const entry = document.createElement('li');
    entry.className = 'mine-item';
    entry.dataset.id = link.id;

    const name = document.createElement('p');
    name.className = 'mine-name';
    name.textContent = link.species ?? strings.mine.unknownSpecies;

    const meta = document.createElement('p');
    meta.className = 'form-hint';
    meta.textContent = formatTemplate(strings.mine.savedAt, { date: savedDate(link.savedAt) });

    const feedback = document.createElement('p');
    feedback.className = 'card-share-feedback';
    feedback.hidden = true;
    const manual = document.createElement('p');
    manual.className = 'card-share-url';
    manual.hidden = true;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const clear = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      feedback.hidden = true;
      manual.hidden = true;
      manual.textContent = '';
    };

    const actions = document.createElement('div');
    actions.className = 'form-picker-actions';
    actions.append(
      button(strings.mine.show, () => {
        options.onShow(link);
      }),
      button(strings.mine.edit, () => {
        options.onEdit(link);
      }),
      button(strings.mine.copy, () => {
        const url = options.editLinkUrl(link);
        clear();
        void options.share(url, strings.app.title).then((outcome) => {
          if (outcome === 'copied') {
            feedback.hidden = false;
            feedback.textContent = strings.mine.copied;
            timer = setTimeout(clear, options.feedbackMs ?? MINE_FEEDBACK_MS);
          } else if (outcome === 'manual') {
            feedback.hidden = false;
            feedback.textContent = strings.mine.copyManual;
            manual.hidden = false;
            manual.textContent = url;
          }
        });
      }),
    );

    entry.append(name, meta, actions, feedback, manual);
    return entry;
  }

  return {
    setLinks(links) {
      list.replaceChildren(...links.map(item));
      empty.hidden = links.length > 0;
    },
    setOpen,
    isOpen() {
      return !element.hidden;
    },
    onOpenChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
