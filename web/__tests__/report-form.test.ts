/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest';

import type { ReportFormOptions } from '../src/ui/report-form.ts';
import { createReportForm } from '../src/ui/report-form.ts';
import strings from '../src/ui-strings.json';

// The fields load the Turnstile widget; a widget that never settles keeps the
// real script out of the test document.
vi.mock('../src/turnstile.ts', () => ({
  renderTurnstile: () => new Promise(() => undefined),
}));

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

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (element) => element.textContent === label,
  );
  if (found === undefined) {
    throw new Error(`no button labelled ${label}`);
  }
  return found;
}

function coords(container: HTMLElement): string {
  return container.querySelector('.form-coords')?.textContent ?? '';
}

describe('locked point', () => {
  it('will not start the fields from a view that cannot be submitted', () => {
    const container = document.createElement('div');
    const form = createReportForm(container, options());
    form.setActive(true);

    expect(button(container, strings.form.toForm).disabled).toBe(true);
  });

  it('keeps the point taken when the fields opened until aiming resumes', () => {
    let view = { lat: 25.04, lng: 121.54, zoom: 19 };
    const container = document.createElement('div');
    const onModeChange = vi.fn();
    const form = createReportForm(container, options({ getView: () => view, onModeChange }));
    form.setActive(true);

    const toggle = button(container, strings.form.toForm);
    expect(toggle.disabled).toBe(false);
    toggle.click();
    expect(onModeChange).toHaveBeenLastCalledWith('form');
    const locked = coords(container);

    view = { lat: 25.05, lng: 121.55, zoom: 19 };
    form.update();
    expect(coords(container)).toBe(locked);

    button(container, strings.form.toPicking).click();
    expect(onModeChange).toHaveBeenLastCalledWith('picking');
    expect(coords(container)).toContain('25.05000');
  });
});

describe('linkTree', () => {
  it('links the tree and borrows its species when none is typed', () => {
    const container = document.createElement('div');
    const form = createReportForm(container, options());
    form.setActive(true);
    form.linkTree({
      id: '768',
      species: 'banyan',
      lat: 25.04,
      lng: 121.54,
      dbhM: null,
      address: null,
      manager: null,
      siteType: null,
      district: null,
    });

    const text = container.querySelector('.form-nearby')?.textContent ?? '';
    expect(text).toContain('768');
    const species = [...container.querySelectorAll<HTMLInputElement>('input[type="text"]')].map(
      (input) => input.value,
    );
    expect(species).toContain('banyan');
  });
});

describe('gate line', () => {
  function gate(container: HTMLElement): HTMLElement {
    return container.querySelector('.form-gate') as HTMLElement;
  }

  it('explains a view that cannot be used', () => {
    const container = document.createElement('div');
    createReportForm(container, options()).setActive(true);

    expect(gate(container).hidden).toBe(false);
    expect(gate(container).textContent).toBe(strings.form.blockedZoom);
  });

  it('stays out of the way when the point is usable', () => {
    const container = document.createElement('div');
    const form = createReportForm(
      container,
      options({ getView: () => ({ lat: 25.04, lng: 121.54, zoom: 19 }) }),
    );
    form.setActive(true);

    expect(gate(container).hidden).toBe(true);
  });
});

describe('editing an existing report', () => {
  it('locks on the stored point even while the map is still elsewhere', () => {
    const container = document.createElement('div');
    const form = createReportForm(
      container,
      options({ getView: () => ({ lat: 25.1, lng: 121.6, zoom: 12 }) }),
    );
    form.setActive(true);
    form.startEdit(
      { id: '01JBZ8QF7KJ9M3N4P5R6S7T8V9', token: 'token' },
      {
        id: '01JBZ8QF7KJ9M3N4P5R6S7T8V9',
        lat: 25.0232,
        lng: 121.5056,
        species: null,
        causes: [],
        dispositions: [],
        evidence: 1,
        note: null,
        link: null,
        observed_at: null,
        protected_tree_id: null,
        inventory_tree_id: null,
      },
    );
    form.update();

    expect(coords(container)).toContain('25.02320');
    expect(coords(container)).toContain('121.50560');
    expect(container.querySelector<HTMLElement>('.form-gate')?.hidden).toBe(true);
  });
});
