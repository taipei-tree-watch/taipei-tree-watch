/**
 * Handing a permalink to the reader.
 *
 * A phone has a share sheet, which is the thing people expect and which can
 * reach a messaging app the clipboard cannot. A desktop browser usually has
 * only a clipboard. Both can refuse, and a refusal must still leave the reader
 * with the address, so the outcome is reported back and the card shows the URL
 * when nothing automatic worked.
 *
 * The browser capabilities arrive as arguments rather than being read from
 * `navigator` here, so every branch is reachable in a test.
 */

export type ShareOutcome =
  /** The share sheet took it. */
  | 'shared'
  /** The share sheet opened and the reader closed it; nothing more to say. */
  | 'dismissed'
  /** Written to the clipboard. */
  | 'copied'
  /** Neither worked: the caller must show the URL for manual copying. */
  | 'manual';

export interface ShareCapabilities {
  /** `navigator.share`, when the browser has one. */
  readonly share?: ((data: { title: string; url: string }) => Promise<void>) | undefined;
  /** `navigator.clipboard.writeText`, when the browser has one. */
  readonly writeText?: ((text: string) => Promise<void>) | undefined;
}

/** A share sheet the reader closed rejects with this name, per the Web Share API. */
function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export async function sharePermalink(
  url: string,
  title: string,
  capabilities: ShareCapabilities,
): Promise<ShareOutcome> {
  const { share, writeText } = capabilities;

  if (share !== undefined) {
    try {
      await share({ title, url });
      return 'shared';
    } catch (error) {
      if (isAbort(error)) {
        return 'dismissed';
      }
      console.warn('share sheet failed', error);
    }
  }

  if (writeText !== undefined) {
    try {
      await writeText(url);
      return 'copied';
    } catch (error) {
      console.warn('clipboard write failed', error);
    }
  }

  return 'manual';
}

/** The capabilities of a real browser, guarded because either may be absent. */
export function browserShareCapabilities(target: Navigator): ShareCapabilities {
  const share =
    typeof target.share === 'function' ? target.share.bind(target) : undefined;
  const clipboard: Clipboard | undefined = target.clipboard;
  const writeText =
    clipboard !== undefined && typeof clipboard.writeText === 'function'
      ? clipboard.writeText.bind(clipboard)
      : undefined;
  return { share, writeText };
}
