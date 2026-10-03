/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createToast } from '../src/ui/toast.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('toast', () => {
  it('starts hidden and announces politely', () => {
    const element = document.createElement('div');
    createToast(element, 1000);
    expect(element.hidden).toBe(true);
    expect(element.getAttribute('role')).toBe('status');
    expect(element.getAttribute('aria-live')).toBe('polite');
  });

  it('shows a message and takes it down after the duration', () => {
    const element = document.createElement('div');
    const toast = createToast(element, 1000);

    toast.show('copied');
    expect(element.hidden).toBe(false);
    expect(element.textContent).toBe('copied');

    vi.advanceTimersByTime(1000);
    expect(element.hidden).toBe(true);
    expect(element.textContent).toBe('');
  });

  it('restarts the timer when a new message arrives', () => {
    const element = document.createElement('div');
    const toast = createToast(element, 1000);

    toast.show('first');
    vi.advanceTimersByTime(800);
    toast.show('second');
    vi.advanceTimersByTime(800);
    expect(element.hidden).toBe(false);
    expect(element.textContent).toBe('second');

    vi.advanceTimersByTime(200);
    expect(element.hidden).toBe(true);
  });
});
