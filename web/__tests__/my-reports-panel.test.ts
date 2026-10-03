/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest';

import type { CopyOutcome } from '../src/copy-link.ts';
import { createMyReportsPanel } from '../src/ui/my-reports-panel.ts';
import strings from '../src/ui-strings.json';

const EDIT_URL = 'https://example.test/?edit=x';

function harness(outcome: CopyOutcome) {
  const element = document.createElement('aside');
  const copy = vi.fn(() => Promise.resolve(outcome));
  const notify = vi.fn();
  const panel = createMyReportsPanel(element, {
    onShow: () => undefined,
    onEdit: () => undefined,
    editLinkUrl: () => EDIT_URL,
    copy,
    notify,
  });
  panel.setLinks([
    {
      id: '01JBZ8QF7KJ9M3N4P5R6S7T8V9',
      token: 'token',
      savedAt: '2026-09-25T08:00:00.000Z',
      lat: 25.04,
      lng: 121.54,
      species: null,
    },
  ]);
  const copyButton = [...element.querySelectorAll<HTMLButtonElement>('.mine-item button')].find(
    (button) => button.textContent === strings.mine.copy,
  );
  if (copyButton === undefined) {
    throw new Error('copy button is missing');
  }
  return { element, copy, notify, copyButton };
}

describe('my reports copy button', () => {
  it('copies the edit link and confirms in the toast', async () => {
    const { element, copy, notify, copyButton } = harness('copied');
    copyButton.click();
    await Promise.resolve();

    expect(copy).toHaveBeenCalledWith(EDIT_URL);
    expect(notify).toHaveBeenCalledWith(strings.mine.copied);
    expect(element.querySelector<HTMLElement>('.card-share-url')?.hidden).toBe(true);
  });

  it('shows the edit link to copy by hand when the clipboard refused', async () => {
    const { element, notify, copyButton } = harness('manual');
    copyButton.click();
    await Promise.resolve();

    expect(notify).not.toHaveBeenCalled();
    const manual = element.querySelector<HTMLElement>('.card-share-url');
    expect(manual?.hidden).toBe(false);
    expect(manual?.textContent).toBe(EDIT_URL);
  });
});
