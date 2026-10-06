/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest';

import type { ReportFormOptions } from '../src/ui/report-form.ts';
import { createReportForm } from '../src/ui/report-form.ts';
import strings from '../src/ui-strings.json';

// A widget that is already solved, so the fields can be sent.
vi.mock('../src/turnstile.ts', () => ({
  renderTurnstile: () => Promise.resolve({ getToken: () => 'solved', reset: () => undefined }),
}));

function options(overrides: Partial<ReportFormOptions> = {}): ReportFormOptions {
  const values = new Map<string, string>();
  return {
    getView: () => ({ lat: 25.04, lng: 121.54, zoom: 19 }),
    bbox: { minLng: 121.43, minLat: 24.94, maxLng: 121.68, maxLat: 25.24 },
    onPendingReport: vi.fn(),
    onModeChange: vi.fn(),
    onDismiss: vi.fn(),
    fetchImpl: vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ id: '01JBZ8QF7KJ9M3N4P5R6S7T8V9', edit_token: 'token' }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ),
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
    onCorrectingChange: vi.fn(),
    loadRevisions: () => Promise.resolve(new Map()),
    flyTo: vi.fn(),
    editLinkUrl: () => 'https://example.test/?edit=x',
    reportUrl: (id) => `https://example.test/?report=${id}`,
    copy: () => Promise.resolve('copied'),
    notify: vi.fn(),
    confirm: () => true,
    ...overrides,
  };
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (element) => element.textContent === label,
  );
  if (found === undefined) {
    throw new Error(`button ${label} is missing`);
  }
  return found;
}

function successPanel(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>('.form-success');
  if (element === null) {
    throw new Error('success panel is missing');
  }
  return element;
}

/** Let the widget promise and the submit request settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function submitNewReport(container: HTMLElement): Promise<void> {
  button(container, strings.form.toForm).click();
  await settle();
  container.querySelector('form.form-fields')?.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
}

describe('after a report is sent', () => {
  it('starts the next report on empty fields when the sheet is opened again', async () => {
    const container = document.createElement('div');
    const onModeChange = vi.fn();
    const form = createReportForm(container, options({ onModeChange }));
    form.setActive(true);

    await submitNewReport(container);
    expect(successPanel(container).hidden).toBe(false);

    form.setActive(false);
    form.startCreate();
    form.setActive(true);

    expect(successPanel(container).hidden).toBe(true);
    expect(onModeChange).toHaveBeenLastCalledWith('picking');
    expect(button(container, strings.form.toForm).hidden).toBe(false);
  });

  it('keeps a draft still being filled in', async () => {
    const container = document.createElement('div');
    const form = createReportForm(container, options());
    form.setActive(true);
    button(container, strings.form.toForm).click();
    await settle();

    const species = container.querySelector<HTMLInputElement>('.form-fields input[type="text"]');
    expect(species).not.toBeNull();
    if (species === null) {
      return;
    }
    species.value = 'Ficus';
    species.dispatchEvent(new Event('input'));

    form.setActive(false);
    form.startCreate();
    form.setActive(true);

    expect(species.value).toBe('Ficus');
  });
});

describe('copying the edit link', () => {
  it('copies straight to the clipboard and confirms in the toast', async () => {
    const container = document.createElement('div');
    const copy = vi.fn(() => Promise.resolve('copied' as const));
    const notify = vi.fn();
    const form = createReportForm(container, options({ copy, notify }));
    form.setActive(true);

    await submitNewReport(container);
    button(container, strings.form.editLinkCopy).click();
    await settle();

    expect(copy).toHaveBeenCalledWith('https://example.test/?edit=x');
    expect(notify).toHaveBeenCalledWith(strings.form.editLinkCopied);
  });

  it('shows the edit link to copy by hand when the clipboard refused', async () => {
    const container = document.createElement('div');
    const notify = vi.fn();
    const form = createReportForm(
      container,
      options({ copy: () => Promise.resolve('manual'), notify }),
    );
    form.setActive(true);

    await submitNewReport(container);
    button(container, strings.form.editLinkCopy).click();
    await settle();

    expect(notify).not.toHaveBeenCalled();
    const manual = container.querySelector<HTMLElement>('.form-edit-link .card-share-url');
    expect(manual?.hidden).toBe(false);
    expect(manual?.textContent).toBe('https://example.test/?edit=x');
  });
});

describe('copying the share link', () => {
  function shareRow(container: HTMLElement): HTMLElement | null {
    return container.querySelector<HTMLElement>('.form-share-link');
  }

  it('copies the public permalink of the report just sent', async () => {
    const container = document.createElement('div');
    const copy = vi.fn(() => Promise.resolve('copied' as const));
    const notify = vi.fn();
    const form = createReportForm(container, options({ copy, notify }));
    form.setActive(true);

    await submitNewReport(container);
    button(container, strings.form.shareLinkCopy).click();
    await settle();

    expect(copy).toHaveBeenCalledWith('https://example.test/?report=01JBZ8QF7KJ9M3N4P5R6S7T8V9');
    expect(notify).toHaveBeenCalledWith(strings.form.shareLinkCopied);
  });

  it('hides the share link once the panel gives way to a new report', async () => {
    const container = document.createElement('div');
    const form = createReportForm(container, options());
    form.setActive(true);

    await submitNewReport(container);
    expect(shareRow(container)?.hidden).toBe(false);

    button(container, strings.form.successAgain).click();
    expect(shareRow(container)?.hidden).toBe(true);
  });
});
