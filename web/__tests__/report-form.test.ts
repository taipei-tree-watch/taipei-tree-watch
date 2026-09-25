/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest';

import { LINK_DOMAINS } from '../../shared/domains.ts';
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
    moveTo: vi.fn(),
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

    const hint = container.querySelector<HTMLElement>('.form-nearby-hint');
    expect(hint?.hidden).toBe(false);
    expect(hint?.textContent).toContain('768');
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

describe('nearby while aiming', () => {
  const TREE = {
    id: '2190',
    species: 'banyan',
    lat: 25.04,
    lng: 121.54,
    dbhM: null,
    address: null,
    manager: null,
    siteType: null,
    district: null,
  };

  function boxes(container: HTMLElement): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>('.form-nearby')];
  }

  it('names a nearby tree in one line and keeps the box shut', () => {
    const container = document.createElement('div');
    const form = createReportForm(
      container,
      options({ getView: () => ({ lat: 25.04, lng: 121.54, zoom: 19 }) }),
    );
    form.setTrees([TREE]);
    form.setActive(true);

    const hint = container.querySelector<HTMLElement>('.form-nearby-hint');
    expect(hint?.hidden).toBe(false);
    expect(hint?.textContent).toContain('#2190');
    expect(boxes(container).every((box) => box.hidden)).toBe(true);
  });

  it('opens the box and drops the line once the fields open', () => {
    const container = document.createElement('div');
    const form = createReportForm(
      container,
      options({ getView: () => ({ lat: 25.04, lng: 121.54, zoom: 19 }) }),
    );
    form.setTrees([TREE]);
    form.setActive(true);
    button(container, strings.form.toForm).click();

    expect(container.querySelector<HTMLElement>('.form-nearby-hint')?.hidden).toBe(true);
    expect(boxes(container).some((box) => !box.hidden)).toBe(true);
    expect(button(container, strings.form.nearbyConfirm).hidden).toBe(false);
  });

  it('says nothing when nothing is near', () => {
    const container = document.createElement('div');
    createReportForm(container, options()).setActive(true);

    expect(container.querySelector<HTMLElement>('.form-nearby-hint')?.hidden).toBe(true);
  });
});

describe('link domains info', () => {
  it('opens a popover listing every accepted domain', () => {
    const container = document.createElement('div');
    createReportForm(container, options());

    const button = container.querySelector<HTMLButtonElement>('.form-info');
    const popover = container.querySelector<HTMLElement>('#form-link-domains');
    expect(button?.getAttribute('aria-label')).toBe(strings.form.linkDomainsInfo);
    expect(button?.type).toBe('button');
    expect(button?.popoverTargetElement).toBe(popover);
    const listed = [...(popover?.querySelectorAll('li') ?? [])].map((item) => item.textContent);
    expect(listed).toEqual([...LINK_DOMAINS]);
  });
});

describe('character counters', () => {
  it('ends the species and note hints with a live count', () => {
    const container = document.createElement('div');
    createReportForm(container, options());

    const species = container.querySelector<HTMLInputElement>('input[type=text]');
    const note = container.querySelector<HTMLTextAreaElement>('textarea');
    if (species === null || note === null) {
      throw new Error('species or note field is missing');
    }
    species.value = '榕樹';
    species.dispatchEvent(new Event('input'));
    note.value = '公告';
    note.dispatchEvent(new Event('input'));

    const hints = [...container.querySelectorAll('.form-hint')].map((hint) => hint.textContent);
    expect(hints).toContain(`${strings.form.speciesHint} (2 ／ 50 字)`);
    expect(hints).toContain(`${strings.form.noteHint} (2 ／ 300 字)`);
  });
});

describe('reason block', () => {
  function causeGroup(container: HTMLElement): HTMLElement {
    const group = container.querySelector('input[name=report-cause]')?.closest('fieldset');
    if (group === null || group === undefined) {
      throw new Error('reason block is missing');
    }
    return group;
  }

  function pickEvidence(container: HTMLElement, code: number): void {
    const input = container.querySelector<HTMLInputElement>(
      `input[name=report-evidence][value="${code}"]`,
    );
    if (input === null) {
      throw new Error(`evidence ${code} is missing`);
    }
    input.checked = true;
    input.dispatchEvent(new Event('change'));
  }

  it('is hidden whole for a sighting with no notice', () => {
    const container = document.createElement('div');
    createReportForm(container, options());

    pickEvidence(container, 6);

    expect(causeGroup(container).hidden).toBe(true);
  });

  it('is shown for a high risk tag', () => {
    const container = document.createElement('div');
    createReportForm(container, options());

    pickEvidence(container, 5);

    expect(causeGroup(container).hidden).toBe(false);
  });
});

describe('lookup box', () => {
  function box(container: HTMLElement): HTMLElement {
    const element = container.querySelector<HTMLElement>('.form-lookup');
    if (element === null) {
      throw new Error('lookup box missing');
    }
    return element;
  }

  it('starts folded and unfolds from its header chip', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const form = createReportForm(container, options());
    form.setActive(true);

    expect(box(container).hidden).toBe(true);
    expect(form.lookupToggle.getAttribute('aria-expanded')).toBe('false');
    expect(form.lookupToggle.textContent).toBe(strings.form.lookupToggle);

    (form.lookupToggle as HTMLButtonElement).click();
    expect(box(container).hidden).toBe(false);
    expect(form.lookupToggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.id).toBe('report-lookup');

    (form.lookupToggle as HTMLButtonElement).click();
    expect(box(container).hidden).toBe(true);
    container.remove();
  });

  it('folds again whenever the sheet reopens', () => {
    const container = document.createElement('div');
    const form = createReportForm(container, options());
    form.setActive(true);
    (form.lookupToggle as HTMLButtonElement).click();

    form.setActive(false);
    form.setActive(true);

    expect(box(container).hidden).toBe(true);
  });

  it('is put away while the point is locked for the fields', () => {
    const container = document.createElement('div');
    const form = createReportForm(
      container,
      options({ getView: () => ({ lat: 25.04, lng: 121.54, zoom: 19 }) }),
    );
    form.setActive(true);
    (form.lookupToggle as HTMLButtonElement).click();

    button(container, strings.form.toForm).click();
    expect(form.lookupToggle.hidden).toBe(true);
    expect(box(container).hidden).toBe(true);

    button(container, strings.form.toPicking).click();
    expect(form.lookupToggle.hidden).toBe(false);
    expect(box(container).hidden).toBe(true);
  });

  function lookup(container: HTMLElement, text: string): string {
    const input = container.querySelector<HTMLInputElement>('#report-lookup');
    const form = container.querySelector<HTMLFormElement>('.form-lookup');
    if (input === null || form === null) {
      throw new Error('lookup box missing');
    }
    input.value = text;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    return container.querySelector('.form-lookup [role=status]')?.textContent ?? '';
  }

  it('flies to a pasted Plus Code', () => {
    const container = document.createElement('div');
    const moveTo = vi.fn();
    createReportForm(container, options({ moveTo }));

    const message = lookup(container, '2GCV+7P8 \u5B78\u5E9C\u91CC');

    expect(message).toBe(strings.form.lookupPoint);
    expect(moveTo).toHaveBeenCalledTimes(1);
    const [point, zoom] = moveTo.mock.calls[0] as [{ lat: number; lng: number }, number];
    expect(point.lat).toBeCloseTo(25.02066, 4);
    expect(point.lng).toBeCloseTo(121.54433, 4);
    expect(zoom).toBe(18);
  });

  it('flies to a protected tree once the layer is set', () => {
    const container = document.createElement('div');
    const moveTo = vi.fn();
    const form = createReportForm(container, options({ moveTo }));

    expect(lookup(container, '7')).toBe(strings.form.lookupTreesUnavailable);
    form.setTrees([
      {
        id: '7',
        species: null,
        lat: 25.03,
        lng: 121.52,
        dbhM: null,
        address: null,
        manager: null,
        siteType: null,
        district: null,
      },
    ]);
    lookup(container, '#7');

    expect(moveTo).toHaveBeenCalledWith(expect.objectContaining({ lat: 25.03, lng: 121.52 }), 18);
  });

  it('explains what it accepts and leaves the map alone otherwise', () => {
    const container = document.createElement('div');
    const moveTo = vi.fn();
    createReportForm(container, options({ moveTo }));

    expect(lookup(container, 'https://maps.app.goo.gl/x')).toBe(strings.form.lookupUnrecognised);
    expect(lookup(container, '22.6273, 120.3014')).toBe(strings.form.lookupPointOutside);
    expect(moveTo).not.toHaveBeenCalled();
  });
});
