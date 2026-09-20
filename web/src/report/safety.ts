/**
 * Whether the safety notice at the top of the report form has been
 * acknowledged on this browser.
 *
 * The notice is the first thing a reporter sees and it stays useful for as
 * long as it is unread; once someone has read it, repeating it on every
 * report pushes the fields off the screen. The acknowledgement is per
 * browser, so it is held in localStorage next to the pending reports.
 *
 * Storage is best effort: a private window can refuse both reads and writes.
 * A refusal degrades to showing the notice, which is the safe direction.
 */
import type { StorageLike } from './pending.ts';

export const SAFETY_STORAGE_KEY = 'ttw:safety-dismissed';

/** The only value ever written; any other stored value is treated as unset. */
const DISMISSED_VALUE = '1';

export function isSafetyDismissed(storage: StorageLike): boolean {
  try {
    return storage.getItem(SAFETY_STORAGE_KEY) === DISMISSED_VALUE;
  } catch (error) {
    console.warn('could not read the safety acknowledgement', error);
    return false;
  }
}

export function dismissSafety(storage: StorageLike): void {
  try {
    storage.setItem(SAFETY_STORAGE_KEY, DISMISSED_VALUE);
  } catch (error) {
    console.warn('could not persist the safety acknowledgement', error);
  }
}
