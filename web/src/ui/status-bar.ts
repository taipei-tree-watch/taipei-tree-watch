/**
 * The bar that reports loading progress, load failures and short notices.
 *
 * A failed fetch must never leave a blank page, so the bar stays on screen
 * with a retry button while the map keeps whatever data did arrive; a dismiss
 * button beside it lets the reader clear the bar and carry on without the
 * retry. A notice is the same bar with only the dismiss button: it says
 * something the reader should know without taking the map away from them.
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

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'status-bar-retry status-bar-dismiss';
  dismiss.textContent = strings.status.dismiss;
  dismiss.hidden = true;

  element.replaceChildren(text, action, dismiss);

  let handler: (() => void) | null = null;
  action.addEventListener('click', () => {
    handler?.();
  });

  const hide = (): void => {
    element.hidden = true;
    handler = null;
  };
  dismiss.addEventListener('click', hide);

  return {
    showLoading() {
      element.hidden = false;
      element.dataset.tone = 'info';
      text.textContent = strings.status.loading;
      action.hidden = true;
      dismiss.hidden = true;
      handler = null;
    },
    showError(message, onRetry) {
      element.hidden = false;
      element.dataset.tone = 'error';
      text.textContent = message;
      action.hidden = false;
      action.textContent = strings.status.retry;
      dismiss.hidden = false;
      handler = onRetry;
    },
    showNotice(message) {
      element.hidden = false;
      element.dataset.tone = 'notice';
      text.textContent = message;
      action.hidden = false;
      action.textContent = strings.status.dismiss;
      dismiss.hidden = true;
      handler = hide;
    },
    hide,
  };
}
