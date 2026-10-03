/**
 * A short confirmation that floats over the map and fades on its own.
 *
 * One toast element serves the whole page, so a confirmation shows the same
 * way whichever panel the copy came from. A new message replaces the one on
 * screen and restarts its timer.
 */

/** How long a toast stays on screen. */
export const TOAST_MS = 2500;

export interface Toast {
  show(message: string): void;
}

export function createToast(element: HTMLElement, durationMs: number = TOAST_MS): Toast {
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');
  element.hidden = true;

  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    show(message) {
      if (timer !== null) {
        clearTimeout(timer);
      }
      element.textContent = message;
      element.hidden = false;
      timer = setTimeout(() => {
        timer = null;
        element.hidden = true;
        element.textContent = '';
      }, durationMs);
    },
  };
}
