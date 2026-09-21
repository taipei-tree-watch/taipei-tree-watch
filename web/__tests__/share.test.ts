import { beforeEach, describe, expect, it, vi } from 'vitest';

import { browserShareCapabilities, sharePermalink } from '../src/share.ts';

const URL_TO_SHARE = 'https://example.test/?tree=768';
const TITLE = 'Taipei Tree Watch';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('sharePermalink', () => {
  it('opens the share sheet when the browser has one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(sharePermalink(URL_TO_SHARE, TITLE, { share, writeText })).resolves.toBe(
      'shared',
    );
    expect(share).toHaveBeenCalledWith({ title: TITLE, url: URL_TO_SHARE });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('says nothing more when the reader closes the share sheet', async () => {
    const abort = new Error('cancelled');
    abort.name = 'AbortError';
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(
      sharePermalink(URL_TO_SHARE, TITLE, { share: vi.fn().mockRejectedValue(abort), writeText }),
    ).resolves.toBe('dismissed');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard when the share sheet fails', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(
      sharePermalink(URL_TO_SHARE, TITLE, {
        share: vi.fn().mockRejectedValue(new Error('no transport')),
        writeText,
      }),
    ).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith(URL_TO_SHARE);
  });

  it('copies when there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);

    await expect(sharePermalink(URL_TO_SHARE, TITLE, { writeText })).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith(URL_TO_SHARE);
  });

  it('asks for a manual copy when the clipboard refuses', async () => {
    await expect(
      sharePermalink(URL_TO_SHARE, TITLE, {
        writeText: vi.fn().mockRejectedValue(new Error('denied')),
      }),
    ).resolves.toBe('manual');
  });

  it('asks for a manual copy when the browser offers neither', async () => {
    await expect(sharePermalink(URL_TO_SHARE, TITLE, {})).resolves.toBe('manual');
  });
});

describe('browserShareCapabilities', () => {
  it('picks up both when the browser has both', () => {
    const navigatorLike = {
      share: () => Promise.resolve(),
      clipboard: { writeText: () => Promise.resolve() },
    } as unknown as Navigator;

    const capabilities = browserShareCapabilities(navigatorLike);
    expect(typeof capabilities.share).toBe('function');
    expect(typeof capabilities.writeText).toBe('function');
  });

  it('leaves out what the browser does not have', () => {
    const capabilities = browserShareCapabilities({} as unknown as Navigator);
    expect(capabilities.share).toBeUndefined();
    expect(capabilities.writeText).toBeUndefined();
  });
});
