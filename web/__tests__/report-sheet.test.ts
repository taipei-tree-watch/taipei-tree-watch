/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import { createReportSheet } from '../src/ui/report-sheet.ts';

/** happy-dom does no layout, so the widths the sheet measures are set by hand. */
function setWidths(element: HTMLElement, scrollWidth: number, clientWidth: number): void {
  Object.defineProperty(element, 'scrollWidth', { configurable: true, get: () => scrollWidth });
  Object.defineProperty(element, 'clientWidth', { configurable: true, get: () => clientWidth });
}

describe('report sheet header', () => {
  it('drops the chip icons only while the chips do not fit beside the title', () => {
    const element = document.createElement('section');
    const sheet = createReportSheet(element);
    const header = element.querySelector<HTMLElement>('.panel-header');
    if (header === null) {
      throw new Error('expected a header');
    }

    setWidths(sheet.headerSlot, 237, 215);
    sheet.setEditing(false);
    expect(header.classList.contains('panel-header-compact')).toBe(true);

    setWidths(sheet.headerSlot, 180, 215);
    sheet.setEditing(false);
    expect(header.classList.contains('panel-header-compact')).toBe(false);
  });
});
