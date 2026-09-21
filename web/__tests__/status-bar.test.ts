/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import { createStatusBar } from '../src/ui/status-bar.ts';
import strings from '../src/ui-strings.json';

function harness() {
  const element = document.createElement('div');
  element.hidden = true;
  document.body.replaceChildren(element);
  const bar = createStatusBar(element);
  return {
    bar,
    element,
    text: element.querySelector('.status-bar-text') as HTMLElement,
    action: element.querySelector('.status-bar-retry') as HTMLButtonElement,
  };
}

describe('status bar notices', () => {
  it('shows a permalink that found nothing without blocking the map', () => {
    const { bar, element, text, action } = harness();
    bar.showNotice(strings.status.reportMissing);

    expect(element.hidden).toBe(false);
    expect(element.dataset.tone).toBe('notice');
    expect(text.textContent).toBe(strings.status.reportMissing);
    expect(action.textContent).toBe(strings.status.dismiss);
  });

  it('goes away when the reader dismisses it', () => {
    const { bar, element, action } = harness();
    bar.showNotice(strings.status.treeMissing);
    action.click();
    expect(element.hidden).toBe(true);
  });

  it('still offers a retry on a load failure', () => {
    const { bar, element, action } = harness();
    let retried = 0;
    bar.showError(strings.status.snapshotFailed, () => {
      retried += 1;
    });

    expect(element.dataset.tone).toBe('error');
    expect(action.textContent).toBe(strings.status.retry);
    action.click();
    expect(retried).toBe(1);
  });

  it('drops the dismiss handler when the bar is reused for loading', () => {
    const { bar, element, action } = harness();
    bar.showNotice(strings.status.reportMissing);
    bar.showLoading();
    expect(action.hidden).toBe(true);
    expect(element.dataset.tone).toBe('info');
  });
});
