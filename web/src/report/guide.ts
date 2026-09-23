/**
 * Whether the aiming instructions in the report sheet are unfolded, as last
 * chosen on this browser.
 *
 * Someone who has folded the instructions away wants the map space back on
 * the next report too, and someone who opened them wants them again. Nothing
 * stored means no choice has been made yet, and the caller falls back to its
 * screen size default.
 *
 * Storage is best effort, the same as the safety acknowledgement: a refusal
 * reads as no choice made and a failed write is dropped.
 */
import type { StorageLike } from './pending.ts';

export const GUIDE_STORAGE_KEY = 'ttw:picker-guide-open';

const OPEN_VALUE = '1';
const CLOSED_VALUE = '0';

export function readGuideOpen(storage: StorageLike): boolean | null {
  try {
    const value = storage.getItem(GUIDE_STORAGE_KEY);
    if (value === OPEN_VALUE) {
      return true;
    }
    if (value === CLOSED_VALUE) {
      return false;
    }
    return null;
  } catch (error) {
    console.warn('could not read the instructions state', error);
    return null;
  }
}

export function writeGuideOpen(storage: StorageLike, open: boolean): void {
  try {
    storage.setItem(GUIDE_STORAGE_KEY, open ? OPEN_VALUE : CLOSED_VALUE);
  } catch (error) {
    console.warn('could not persist the instructions state', error);
  }
}
