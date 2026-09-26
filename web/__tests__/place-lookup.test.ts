/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest';

import type { ProtectedTree } from '../src/data/trees.ts';
import type { PlaceLookupOptions } from '../src/ui/place-lookup.ts';
import { createPlaceLookup } from '../src/ui/place-lookup.ts';
import strings from '../src/ui-strings.json';

const TREE: ProtectedTree = {
  id: '7',
  species: null,
  lat: 25.03,
  lng: 121.52,
  dbhM: null,
  address: null,
  manager: null,
  siteType: null,
  district: null,
};

function mount(overrides: Partial<PlaceLookupOptions> = {}) {
  const button = document.createElement('button');
  const panel = document.createElement('div');
  panel.id = 'place-lookup';
  document.body.append(button, panel);
  const moveTo = vi.fn();
  const lookup = createPlaceLookup(button, panel, {
    bbox: { minLng: 121.43, minLat: 24.94, maxLng: 121.68, maxLat: 25.24 },
    getTrees: () => [],
    moveTo,
    ...overrides,
  });
  const search = (text: string): string => {
    const input = panel.querySelector<HTMLInputElement>('input');
    const form = panel.querySelector<HTMLFormElement>('form');
    if (input === null || form === null) {
      throw new Error('lookup form missing');
    }
    input.value = text;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    return panel.querySelector('[role=status]')?.textContent ?? '';
  };
  return { button, panel, lookup, moveTo, search };
}

describe('place lookup', () => {
  it('starts folded and toggles from its map button', () => {
    const { button, panel, lookup } = mount();

    expect(panel.hidden).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.getAttribute('aria-controls')).toBe('place-lookup');

    button.click();
    expect(panel.hidden).toBe(false);
    expect(lookup.isOpen()).toBe(true);
    expect(document.activeElement).toBe(panel.querySelector('input'));

    button.click();
    expect(panel.hidden).toBe(true);
  });

  it('folds on Escape and hands focus back to the button', () => {
    const { button, panel } = mount();
    button.click();

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
  });

  it('flies to a pasted Plus Code', () => {
    const { moveTo, search } = mount();

    expect(search('2GCV+7P8 學府里')).toBe(strings.lookup.point);

    expect(moveTo).toHaveBeenCalledTimes(1);
    const [point, zoom] = moveTo.mock.calls[0] as [{ lat: number; lng: number }, number];
    expect(point.lat).toBeCloseTo(25.02066, 4);
    expect(point.lng).toBeCloseTo(121.54433, 4);
    expect(zoom).toBe(18);
  });

  it('flies to a protected tree once the layer has loaded', () => {
    let trees: readonly ProtectedTree[] = [];
    const { moveTo, search } = mount({ getTrees: () => trees });

    expect(search('7')).toBe(strings.lookup.treesUnavailable);
    trees = [TREE];
    search('#7');

    expect(moveTo).toHaveBeenCalledWith(expect.objectContaining({ lat: 25.03, lng: 121.52 }), 18);
  });

  it('explains what it accepts and leaves the map alone otherwise', () => {
    const { moveTo, search } = mount();

    expect(search('https://maps.app.goo.gl/x')).toBe(strings.lookup.unrecognised);
    expect(search('22.6273, 120.3014')).toBe(strings.lookup.pointOutside);
    expect(moveTo).not.toHaveBeenCalled();
  });

  it('hides the button and folds the panel while the map is locked', () => {
    const { button, panel, lookup } = mount();
    button.click();

    lookup.setAvailable(false);
    expect(button.hidden).toBe(true);
    expect(panel.hidden).toBe(true);

    lookup.setAvailable(true);
    expect(button.hidden).toBe(false);
    expect(panel.hidden).toBe(true);
  });
});
