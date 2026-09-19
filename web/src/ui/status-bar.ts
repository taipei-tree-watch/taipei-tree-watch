/**
 * The bar that reports loading progress and load failures.
 *
 * A failed fetch must never leave a blank page, so the bar stays on screen
 * with a retry button while the map keeps whatever data did arrive.
 */
import strings from '../ui-strings.json';

export interface StatusBar {
  showLoading(): void;
  showError(message: string, onRetry: () => void): void;
  hide(): void;
}

export function createStatusBar(element: HTMLElement): StatusBar {
  const text = document.createElement('span');
  text.className = 'status-bar-text';

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'status-bar-retry';
  retry.textContent = strings.status.retry;

  element.replaceChildren(text, retry);

  let handler: (() => void) | null = null;
  retry.addEventListener('click', () => {
    handler?.();
  });

  return {
    showLoading() {
      element.hidden = false;
      element.dataset.tone = 'info';
      text.textContent = strings.status.loading;
      retry.hidden = true;
      handler = null;
    },
    showError(message, onRetry) {
      element.hidden = false;
      element.dataset.tone = 'error';
      text.textContent = message;
      retry.hidden = false;
      handler = onRetry;
    },
    hide() {
      element.hidden = true;
      handler = null;
    },
  };
}
