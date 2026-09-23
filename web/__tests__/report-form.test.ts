/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest';

import type { ReportFormOptions } from '../src/ui/report-form.ts';
import { createReportForm } from '../src/ui/report-form.ts';
import strings from '../src/ui-strings.json';

function options(overrides: Partial<ReportFormOptions> = {}): ReportFormOptions {
  const values = new Map<string, string>();
  return {
    getView: () => ({ lat: 25.04, lng: 121.54, zoom: 12 }),
    bbox: { minLng: 121.43, minLat: 24.94, maxLng: 121.68, maxLat: 25.24 },
    locate: () => Promise.resolve(),
    onPendingReport: vi.fn(),
    onModeChange: vi.fn(),
    onDismiss: vi.fn(),
    fetchImpl: vi.fn(),
    now: () => new Date('2026-09-01T00:00:00Z'),
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
    onEditLink: vi.fn(),
    onEditLinkGone: vi.fn(),
    onEditingChange: vi.fn(),
    editLinkUrl: () => 'https://example.test/?edit=x',
    share: () => Promise.resolve('copied'),
    confirm: () => true,
    ...overrides,
  };
}

function guide(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('.form-picker-guide');
  if (element === null) {
    throw new Error('aiming guide is missing');
  }
  return element;
}

describe('aiming guide', () => {
  it('is unfolded by default', () => {
    const container = document.createElement('div');
    const form = createReportForm(container, options());

    expect(guide(container).hidden).toBe(false);
    expect(form.guideToggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('starts folded when asked and nothing is remembered', () => {
    const container = document.createElement('div');
    const form = createReportForm(container, options({ guideOpen: false }));

    expect(guide(container).hidden).toBe(true);
    expect(form.guideToggle.getAttribute('aria-expanded')).toBe('false');
    expect(form.guideToggle.textContent).toBe(strings.form.guideToggle);
  });

  it('holds the instructions and the zoom level', () => {
    const container = document.createElement('div');
    const form = createReportForm(container, options({ guideOpen: false }));
    form.setActive(true);

    const text = guide(container).textContent ?? '';
    expect(text).toContain(strings.form.positionHint);
    expect(text).toContain('12.0');
  });

  it('remembers the last choice over the screen size default', () => {
    const shared = options({ guideOpen: false });
    const first = createReportForm(document.createElement('div'), shared);
    (first.guideToggle as HTMLButtonElement).click();

    const container = document.createElement('div');
    const second = createReportForm(container, shared);
    expect(guide(container).hidden).toBe(false);

    (second.guideToggle as HTMLButtonElement).click();
    const third = document.createElement('div');
    createReportForm(third, { ...shared, guideOpen: true });
    expect(guide(third).hidden).toBe(true);
  });
});
