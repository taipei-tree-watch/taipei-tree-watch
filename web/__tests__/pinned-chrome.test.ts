import { describe, expect, it } from 'vitest';

import { chromeTransform } from '../src/ui/pinned-chrome.ts';

describe('chromeTransform', () => {
  it('leaves an unzoomed viewport alone', () => {
    expect(chromeTransform({ offsetLeft: 0, offsetTop: 0, scale: 1 })).toBe('');
  });

  it('follows the viewport down when a zoomed page is panned', () => {
    const transform = chromeTransform({ offsetLeft: 0, offsetTop: 83, scale: 1.15 });
    expect(transform).toContain('translate(0px, 83px)');
  });

  it('follows the viewport sideways as well', () => {
    const transform = chromeTransform({ offsetLeft: 24, offsetTop: 0, scale: 2 });
    expect(transform).toContain('translate(24px, 0px)');
  });

  it('cancels the zoom so the bar keeps its size on the glass', () => {
    expect(chromeTransform({ offsetLeft: 0, offsetTop: 0, scale: 2 })).toContain('scale(0.5)');
  });

  it('acts on zoom even when the page has not been panned', () => {
    expect(chromeTransform({ offsetLeft: 0, offsetTop: 0, scale: 1.15 })).not.toBe('');
  });

  it('ignores a scale a browser could not mean', () => {
    expect(chromeTransform({ offsetLeft: 0, offsetTop: 10, scale: 0 })).toBe('');
    expect(chromeTransform({ offsetLeft: 0, offsetTop: 10, scale: Number.NaN })).toBe('');
  });
});
