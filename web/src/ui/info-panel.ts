/**
 * The explanatory panel opened from the top bar.
 *
 * Sections come from web/src/content, which holds the safety notice, the
 * "no notice is required" explanation, the project description, the brown
 * root rot primer, the disclaimer and the attribution. The safety section
 * stays expanded, as it does everywhere else on the page.
 */
import { sections } from '../content/index.ts';
import { attributionYear } from '../data/trees.ts';
import { setIconOnly, X } from '../icons.ts';
import strings from '../ui-strings.json';

/** Marks the protected tree attribution year inside the attribution fragment. */
const YEAR_SLOT = '.js-protected-trees-year';

export interface InfoPanel {
  setOpen(open: boolean): void;
  isOpen(): boolean;
  /** Fires whoever opened or closed it, including its own close button. */
  onOpenChange(listener: (open: boolean) => void): () => void;
  /** Fill the open data attribution year from the dataset's own fetch date. */
  setProtectedTreesFetchedAt(fetchedAt: string | null): void;
}

export function createInfoPanel(element: HTMLElement): InfoPanel {
  const header = document.createElement('div');
  header.className = 'panel-header';

  const title = document.createElement('h2');
  title.textContent = strings.info.title;
  header.append(title);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'panel-close';
  setIconOnly(close, X, strings.info.close);
  header.append(close);

  const body = document.createElement('div');
  body.className = 'panel-body';

  // The fragments are build time constants from web/src/content, never user
  // input, so assigning them with innerHTML is safe.
  body.append(
    ...sections.map((section) => {
      const details = document.createElement('details');
      details.id = `info-${section.id}`;
      details.open = section.open;

      const summary = document.createElement('summary');
      summary.textContent = section.title;
      details.append(summary);

      const content = document.createElement('div');
      content.className = 'section-body';
      content.innerHTML = section.html;
      details.append(content);

      return details;
    }),
  );

  element.replaceChildren(header, body);
  const listeners = new Set<(open: boolean) => void>();
  const setOpen = (open: boolean): void => {
    element.hidden = !open;
    for (const listener of listeners) {
      listener(open);
    }
  };

  // The panel's own close button goes through the same path as the top bar
  // toggle, so the toggle cannot be left looking pressed over a shut panel.
  close.addEventListener('click', () => {
    setOpen(false);
  });

  return {
    setOpen(open) {
      setOpen(open);
    },
    onOpenChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isOpen() {
      return !element.hidden;
    },
    setProtectedTreesFetchedAt(fetchedAt) {
      const year = attributionYear(fetchedAt);
      if (year === null) {
        return;
      }
      for (const slot of body.querySelectorAll(YEAR_SLOT)) {
        slot.textContent = year;
      }
    },
  };
}
