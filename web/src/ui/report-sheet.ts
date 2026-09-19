/**
 * Shell for the report bottom sheet.
 *
 * The crosshair picker and the form itself are the next work item. This module
 * exists so that work only has to fill `contentElement`: the button, the sheet
 * container, the open and close behaviour and the layout are already here, and
 * the map controller exposes getCenter, getZoom and onMove for the picker.
 */
import strings from '../ui-strings.json';

export interface ReportSheet {
  /** Container the report form is mounted into. */
  readonly contentElement: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
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

  const placeholder = document.createElement('p');
  placeholder.className = 'sheet-placeholder';
  placeholder.textContent = strings.sheet.placeholder;
  content.append(placeholder);

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
    onOpenChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
