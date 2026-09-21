/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderTurnstile } from '../src/turnstile.ts';

interface RenderCall {
  sitekey: string;
  theme?: string;
}

afterEach(() => {
  delete (window as { turnstile?: unknown }).turnstile;
});

describe('turnstile widget', () => {
  it('lets the widget follow the device colour scheme', async () => {
    const calls: RenderCall[] = [];
    (window as { turnstile?: unknown }).turnstile = {
      render(_container: HTMLElement, options: RenderCall) {
        calls.push(options);
        return 'widget-1';
      },
      reset: vi.fn(),
      getResponse: () => '',
    };

    await renderTurnstile(document.createElement('div'));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.theme).toBe('auto');
    expect(calls[0]?.sitekey).not.toBe('');
  });
});
