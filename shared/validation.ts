/**
 * Pure validation helpers shared by the Worker and the browser form.
 *
 * Nothing here touches the Workers runtime, the DOM or any binding, so both
 * sides run the identical rules. The server is the only enforcement point;
 * the frontend calls the same functions purely for immediate feedback.
 */
import { LINK_DOMAINS } from './domains.ts';

/** Maximum length of the free-text species field, counted in code points. */
export const SPECIES_MAX_CHARS = 50;

/** Maximum length of the note field after URL stripping, counted in code points. */
export const NOTE_MAX_CHARS = 300;

/** Coordinates are stored at 5 decimals (about 1 metre). */
export const COORDINATE_DECIMALS = 5;

/** Nothing observed before this date is accepted. */
export const EARLIEST_OBSERVED_DATE = '2000-01-01';

/** Taiwan keeps a fixed UTC+8 offset with no daylight saving. */
const TAIPEI_UTC_OFFSET_MINUTES = 8 * 60;

/**
 * Anything that looks like a link: an explicit scheme, a protocol-relative
 * prefix, or a bare "www." host. Matching runs to the next whitespace so the
 * whole link, including its path and query, is removed.
 */
const URL_LIKE = /(?:[a-z][a-z0-9+.-]*:\/\/|\/\/|www\.)\S*/gi;

/** Digits only, as printed on the Department of Cultural Affairs tree plate. */
const PROTECTED_TREE_ID = /^[0-9]{1,10}$/;

/** Two letters plus ten digits, e.g. BT0614021096. */
const INVENTORY_TREE_ID = /^[A-Za-z]{2}[0-9]{10}$/;

/** YYYY-MM-DD, digits only; calendar validity is checked separately. */
const CALENDAR_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/** Length in code points, so a CJK character counts as one. */
export function countCharacters(value: string): number {
  return [...value].length;
}

/**
 * Remove every URL and "www." prefixed token from free text.
 *
 * Links belong in the `link` field, which is checked against the domain
 * whitelist; leaving them in the note would make that whitelist pointless.
 * Leftover whitespace is collapsed so the result reads naturally.
 */
export function stripUrls(value: string): string {
  return value.replace(URL_LIKE, ' ').replace(/[ \t]{2,}/g, ' ').trim();
}

/**
 * A link is accepted when it is an https URL whose hostname equals a
 * whitelisted domain or is a subdomain of one.
 */
export function isAllowedLink(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') {
    return false;
  }
  const hostname = url.hostname.toLowerCase();
  return LINK_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

export interface Bbox {
  readonly minLng: number;
  readonly minLat: number;
  readonly maxLng: number;
  readonly maxLat: number;
}

/**
 * Parse the "minLng,minLat,maxLng,maxLat" form used by the BBOX var.
 * Returns null when the string is malformed so the caller can fail loudly.
 */
export function parseBbox(value: string): Bbox | null {
  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];
  if (minLng >= maxLng || minLat >= maxLat) {
    return null;
  }
  return { minLng, minLat, maxLng, maxLat };
}

export function isInsideBbox(bbox: Bbox, lat: number, lng: number): boolean {
  return lat >= bbox.minLat && lat <= bbox.maxLat && lng >= bbox.minLng && lng <= bbox.maxLng;
}

/** Round a coordinate to the stored precision. */
export function roundCoordinate(value: number): number {
  const factor = 10 ** COORDINATE_DECIMALS;
  return Math.round(value * factor) / factor;
}

/** True when the string is a real YYYY-MM-DD calendar date. */
export function isCalendarDate(value: string): boolean {
  if (!CALENDAR_DATE.test(value)) {
    return false;
  }
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(timestamp)) {
    return false;
  }
  // Date.parse accepts overflowing days such as 2026-02-30 by rolling over.
  return new Date(timestamp).toISOString().slice(0, 10) === value;
}

/** Today's date in Asia/Taipei as YYYY-MM-DD. */
export function taipeiDate(now: Date): string {
  const shifted = new Date(now.getTime() + TAIPEI_UTC_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * An observation date must be a real date, no later than today in Asia/Taipei
 * and no earlier than EARLIEST_OBSERVED_DATE. Dates sort correctly as strings.
 */
export function isObservedDateInRange(value: string, today: string): boolean {
  if (!isCalendarDate(value)) {
    return false;
  }
  return value >= EARLIEST_OBSERVED_DATE && value <= today;
}

export function isProtectedTreeId(value: string): boolean {
  return PROTECTED_TREE_ID.test(value);
}

export function isInventoryTreeId(value: string): boolean {
  return INVENTORY_TREE_ID.test(value);
}

/** Inventory tag ids are canonically uppercase; accept either case, store one. */
export function normalizeInventoryTreeId(value: string): string {
  return value.toUpperCase();
}

/**
 * Report ids are ULIDs: 26 characters of Crockford base32, upper case, as the
 * Worker generates them.
 */
const REPORT_ID = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

export function isReportId(value: string): boolean {
  return REPORT_ID.test(value);
}

/** Random bytes behind an edit token; 256 bits leave nothing to guess. */
export const EDIT_TOKEN_BYTES = 32;

/** 32 bytes as unpadded base64url is exactly 43 characters. */
const EDIT_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Shape check for the secret half of an edit link. It says nothing about
 * whether the token opens any report; only the Worker can tell that.
 */
export function isEditToken(value: string): boolean {
  return EDIT_TOKEN.test(value);
}
