/**
 * Shell for the report bottom sheet.
 *
 * The shell owns the header, the open and close behaviour and the layout; the
 * crosshair picker and the form are mounted into `contentElement` by
 * ui/report-form.ts.
 */
import strings from '../ui-strings.json';

export interface ReportSheet {
  /** Container the report form is mounted into. */
  readonly contentElement: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Heading for a new report, or for editing an existing one. */
  setEditing(editing: boolean): void;
  onOpenChange(listener: (open: boolean) => void): () => void;
}

export function createReportSheet(element: HTMLElement): ReportSheet {
  const header = document.createElement('div');
  header.className = 'panel-header';

  const title = document.createElement('h2');
  title.textContent = strings.sheet.title;
  header.append(title);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'panel-close';
  close.setAttribute('aria-label', strings.sheet.close);
  close.textContent = 'x';
  header.append(close);

  const content = document.createElement('div');
  content.className = 'sheet-content';

  element.replaceChildren(header, content);

  const listeners = new Set<(open: boolean) => void>();
  const setOpen = (open: boolean): void => {
    element.hidden = !open;
    element.setAttribute('aria-hidden', open ? 'false' : 'true');
    for (const listener of listeners) {
      listener(open);
    }
  };

  close.addEventListener('click', () => {
    setOpen(false);
  });

  return {
    contentElement: content,
    open() {
      setOpen(true);
    },
    close() {
      setOpen(false);
    },
    isOpen() {
      return !element.hidden;
    },
    setEditing(editing) {
      title.textContent = editing ? strings.sheet.editTitle : strings.sheet.title;
    },
    onOpenChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
