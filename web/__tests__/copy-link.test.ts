import { beforeEach, describe, expect, it, vi } from 'vitest';

import { browserWriteText, copyLink } from '../src/copy-link.ts';

const URL_TO_COPY = 'https://example.test/?tree=768';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('copyLink', () => {
  it('writes the address to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(copyLink(URL_TO_COPY, writeText)).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith(URL_TO_COPY);
  });

  it('asks for a manual copy when the clipboard refuses', async () => {
    await expect(
      copyLink(URL_TO_COPY, vi.fn().mockRejectedValue(new Error('denied'))),
    ).resolves.toBe('manual');
  });

  it('asks for a manual copy when the browser has no clipboard', async () => {
    await expect(copyLink(URL_TO_COPY, undefined)).resolves.toBe('manual');
  });
});

describe('browserWriteText', () => {
  it('picks up the clipboard and ignores a share sheet', () => {
    const share = vi.fn();
    const navigatorLike = {
      share,
      clipboard: { writeText: () => Promise.resolve() },
    } as unknown as Navigator;

    expect(typeof browserWriteText(navigatorLike)).toBe('function');
    expect(share).not.toHaveBeenCalled();
  });

  it('is absent when the browser has no clipboard', () => {
    expect(browserWriteText({} as unknown as Navigator)).toBeUndefined();
  });
});
