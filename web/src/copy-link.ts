/**
 * Copying a permalink to the clipboard.
 *
 * The copy button writes straight to the clipboard and never opens a share
 * sheet: one tap, then a toast, is all the reader has to deal with. The
 * clipboard can refuse, and a refusal must still leave the reader with the
 * address, so the outcome is reported back and the caller shows the URL when
 * the write failed.
 *
 * The clipboard arrives as an argument rather than being read from
 * `navigator` here, so every branch is reachable in a test.
 */

export type CopyOutcome =
  /** Written to the clipboard. */
  | 'copied'
  /** The write failed: the caller must show the URL for manual copying. */
  | 'manual';

/** `navigator.clipboard.writeText`, when the browser has one. */
export type WriteText = ((text: string) => Promise<void>) | undefined;

export async function copyLink(url: string, writeText: WriteText): Promise<CopyOutcome> {
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

/** The clipboard of a real browser, guarded because it may be absent. */
export function browserWriteText(target: Navigator): WriteText {
  const clipboard: Clipboard | undefined = target.clipboard;
  return clipboard !== undefined && typeof clipboard.writeText === 'function'
    ? clipboard.writeText.bind(clipboard)
    : undefined;
}
