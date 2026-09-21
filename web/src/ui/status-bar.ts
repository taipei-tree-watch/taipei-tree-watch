/**
 * The bar that reports loading progress, load failures and short notices.
 *
 * A failed fetch must never leave a blank page, so the bar stays on screen
 * with a retry button while the map keeps whatever data did arrive. A notice
 * is the same bar with a dismiss button instead: it says something the reader
 * should know without taking the map away from them.
 */
import strings from '../ui-strings.json';

export interface StatusBar {
  showLoading(): void;
  showError(message: string, onRetry: () => void): void;
  /** A non-blocking message the reader closes when they have read it. */
  showNotice(message: string): void;
  hide(): void;
}

export function createStatusBar(element: HTMLElement): StatusBar {
  const text = document.createElement('span');
  text.className = 'status-bar-text';

  const action = document.createElement('button');
  action.type = 'button';
  action.className = 'status-bar-retry';
  action.textContent = strings.status.retry;

  element.replaceChildren(text, action);

  let handler: (() => void) | null = null;
  action.addEventListener('click', () => {
    handler?.();
  });

  return {
    showLoading() {
      element.hidden = false;
      element.dataset.tone = 'info';
      text.textContent = strings.status.loading;
      action.hidden = true;
      handler = null;
    },
    showError(message, onRetry) {
      element.hidden = false;
      element.dataset.tone = 'error';
      text.textContent = message;
      action.hidden = false;
      action.textContent = strings.status.retry;
      handler = onRetry;
    },
    showNotice(message) {
      element.hidden = false;
      element.dataset.tone = 'notice';
      text.textContent = message;
      action.hidden = false;
      action.textContent = strings.status.dismiss;
      handler = () => {
        element.hidden = true;
        handler = null;
      };
    },
    hide() {
      element.hidden = true;
      handler = null;
    },
  };
}
