/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import { Funnel, setIconLabel, setIconOnly, X } from '../src/icons.ts';
import { createFilterPanel } from '../src/ui/filter-panel.ts';
import { createInfoPanel } from '../src/ui/info-panel.ts';
import { createMyReportsPanel } from '../src/ui/my-reports-panel.ts';
import { createReportSheet } from '../src/ui/report-sheet.ts';
import strings from '../src/ui-strings.json';

function iconOf(button: Element): SVGElement {
  const svg = button.querySelector('svg');
  if (svg === null) {
    throw new Error('expected an icon');
  }
  return svg;
}

describe('setIconLabel', () => {
  it('puts a decorative icon before the visible label', () => {
    const button = document.createElement('button');
    setIconLabel(button, Funnel, strings.topbar.filters);

    const svg = iconOf(button);
    expect(button.firstElementChild).toBe(svg);
    expect(svg.getAttribute('class')).toBe('icon');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(button.textContent).toBe(strings.topbar.filters);
    expect(button.hasAttribute('aria-label')).toBe(false);
  });

  it('swaps the label without doubling the icon', () => {
    const button = document.createElement('button');
    setIconLabel(button, Funnel, strings.map.locate);
    setIconLabel(button, Funnel, strings.map.locating);

    expect(button.querySelectorAll('svg')).toHaveLength(1);
    expect(button.textContent).toBe(strings.map.locating);
  });

  it('leaves the button alone when nothing changed', () => {
    const button = document.createElement('button');
    setIconLabel(button, Funnel, strings.topbar.filters);
    const svg = iconOf(button);
    setIconLabel(button, Funnel, strings.topbar.filters);

    expect(iconOf(button)).toBe(svg);
  });
});

describe('setIconOnly', () => {
  it('names the button through aria-label and title, with no visible text', () => {
    const button = document.createElement('button');
    setIconOnly(button, X, strings.card.close);

    expect(iconOf(button).getAttribute('aria-hidden')).toBe('true');
    expect(button.textContent).toBe('');
    expect(button.getAttribute('aria-label')).toBe(strings.card.close);
    expect(button.title).toBe(strings.card.close);
  });
});

describe('panel close buttons', () => {
  const panels: readonly (readonly [string, (element: HTMLElement) => void, string])[] = [
    ['filters', (element) => createFilterPanel(element, () => undefined), strings.filters.close],
    ['information', (element) => createInfoPanel(element), strings.info.close],
    [
      'my reports',
      (element) =>
        createMyReportsPanel(element, {
          onShow: () => undefined,
          onEdit: () => undefined,
          editLinkUrl: () => '',
          share: () => Promise.resolve('shared'),
        }),
      strings.mine.close,
    ],
    ['report sheet', (element) => createReportSheet(element), strings.sheet.close],
  ];

  it.each(panels)('shows only an icon on the %s panel, named from ui-strings', (_, create, label) => {
    const element = document.createElement('aside');
    create(element);

    const close = element.querySelector<HTMLButtonElement>('.panel-close');
    expect(close).not.toBeNull();
    if (close === null) {
      return;
    }
    expect(iconOf(close).getAttribute('aria-hidden')).toBe('true');
    expect(close.textContent).toBe('');
    expect(close.getAttribute('aria-label')).toBe(label);
  });
});

describe('my reports list buttons', () => {
  it('puts an icon before each action label', () => {
    const element = document.createElement('aside');
    const panel = createMyReportsPanel(element, {
      onShow: () => undefined,
      onEdit: () => undefined,
      editLinkUrl: () => '',
      share: () => Promise.resolve('shared'),
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

    const actions = [...element.querySelectorAll('.mine-item button')];
    expect(actions.map((action) => action.textContent)).toEqual([
      strings.mine.show,
      strings.mine.edit,
      strings.mine.copy,
    ]);
    for (const action of actions) {
      expect(iconOf(action).getAttribute('aria-hidden')).toBe('true');
    }
  });
});
