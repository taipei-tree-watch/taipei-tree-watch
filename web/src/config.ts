/**
 * Frontend copies of values the Worker owns.
 *
 * The Worker's BBOX var is the only enforcement point; this copy exists so the
 * picker can disable the submit button before a request is made. Keep the two
 * in step: a mismatch shows up as a rejected report, never as an accepted one.
 */
import type { Bbox } from '../../shared/validation.ts';
import { parseBbox } from '../../shared/validation.ts';

/** Same string as the BBOX var in wrangler.toml. */
export const BBOX_STRING = '121.43,24.94,121.68,25.24';

function required(value: Bbox | null): Bbox {
  if (value === null) {
    throw new Error(`invalid BBOX_STRING: ${BBOX_STRING}`);
  }
  return value;
}

export const REPORT_BBOX: Bbox = required(parseBbox(BBOX_STRING));
