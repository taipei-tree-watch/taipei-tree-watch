/**
 * Read a position out of text copied from a map application.
 *
 * Everything here is parsed locally: nothing is sent anywhere. Accepted
 * forms, as Google Maps hands them out:
 *
 * - decimal degrees, `25.020775, 121.544781`, optionally in parentheses
 * - degrees, minutes and seconds, `25°01'14.4"N 121°32'39.6"E`
 * - a Plus Code, full (`7QQ32GCV+7P8`) or short with a locality after it
 *   (`2GCV+7P8 <village> <district>`)
 */
import type { Bbox } from '../../../shared/validation.ts';

export interface Coordinates {
  readonly lat: number;
  readonly lng: number;
}


const DECIMAL =
  /^\(?\s*([-+]?[0-9]{1,3}(?:\.[0-9]+)?)\s*[,，\s]\s*([-+]?[0-9]{1,3}(?:\.[0-9]+)?)\s*\)?$/;

const DMS_PART = String.raw`([0-9]{1,3})\s*°\s*([0-9]{1,2})\s*['′]\s*([0-9]{1,2}(?:\.[0-9]+)?)\s*["″]\s*`;
const DMS = new RegExp(`^${DMS_PART}([NS])[\\s,]*${DMS_PART}([EW])$`, 'i');

const PLUS_ALPHABET = '23456789CFGHJMPQRVWX';
const PLUS_CHAR = `[${PLUS_ALPHABET}]`;
/** A full code has eight digits before the separator, a short one four. */
const PLUS_CODE = new RegExp(
  `(?:^|\\s)((?:${PLUS_CHAR}{4}){1,2})\\+(${PLUS_CHAR}{2,3})(?=\\s|$)`,
  'i',
);


function point(lat: number, lng: number): Coordinates | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  return { lat, lng };
}

function parseDecimal(text: string): Coordinates | null {
  const match = DECIMAL.exec(text);
  if (match === null) {
    return null;
  }
  const first = Number(match[1]);
  const second = Number(match[2]);
  // Map applications give latitude first; a pair only valid the other way
  // round was written longitude first.
  if (Math.abs(first) > 90 && Math.abs(second) <= 90) {
    return point(second, first);
  }
  return point(first, second);
}

function parseDms(text: string): Coordinates | null {
  const match = DMS.exec(text);
  if (match === null) {
    return null;
  }
  const degrees = (d: string | undefined, m: string | undefined, s: string | undefined): number =>
    Number(d) + Number(m) / 60 + Number(s) / 3600;
  const lat = degrees(match[1], match[2], match[3]) * (match[4]?.toUpperCase() === 'S' ? -1 : 1);
  const lng = degrees(match[5], match[6], match[7]) * (match[8]?.toUpperCase() === 'W' ? -1 : 1);
  return point(lat, lng);
}


/* Plus Codes (Open Location Code) -------------------------------------- */

/** Degrees covered by each digit pair of a code. */
const PAIR_RESOLUTIONS = [20, 1, 0.05, 0.0025, 0.000125] as const;
const GRID_ROWS = 5;
const GRID_COLUMNS = 4;

function digitValue(char: string): number {
  return PLUS_ALPHABET.indexOf(char);
}

/** Centre of the area a full code names. */
function decodeFull(code: string): Coordinates | null {
  const digits = code.replace('+', '');
  if (digits.length < 10 || digits.length > 11) {
    return null;
  }
  if (digitValue(digits[0] ?? '') > 8 || digitValue(digits[1] ?? '') > 17) {
    return null;
  }

  let lat = 0;
  let lng = 0;
  PAIR_RESOLUTIONS.forEach((resolution, index) => {
    lat += digitValue(digits[index * 2] ?? '') * resolution;
    lng += digitValue(digits[index * 2 + 1] ?? '') * resolution;
  });

  let latSize: number = PAIR_RESOLUTIONS[4];
  let lngSize = latSize;
  const grid = digits[10];
  if (grid !== undefined) {
    latSize /= GRID_ROWS;
    lngSize /= GRID_COLUMNS;
    const value = digitValue(grid);
    lat += Math.floor(value / GRID_COLUMNS) * latSize;
    lng += (value % GRID_COLUMNS) * lngSize;
  }

  return { lat: lat - 90 + latSize / 2, lng: lng - 180 + lngSize / 2 };
}

/** The first two digit pairs of the code for a reference point. */
function prefixFor(reference: Coordinates): string {
  let lat = reference.lat + 90;
  let lng = reference.lng + 180;
  let prefix = '';
  for (const resolution of PAIR_RESOLUTIONS.slice(0, 2)) {
    const latDigit = Math.floor(lat / resolution);
    const lngDigit = Math.floor(lng / resolution);
    prefix += `${PLUS_ALPHABET[latDigit] ?? ''}${PLUS_ALPHABET[lngDigit] ?? ''}`;
    lat -= latDigit * resolution;
    lng -= lngDigit * resolution;
  }
  return prefix;
}

/**
 * A short code drops its first four digits, which name a one degree square,
 * and is resolved against a nearby reference. The accepted range is far
 * smaller than a degree, so its centre is a safe reference.
 */
function recoverShort(short: string, reference: Coordinates): Coordinates | null {
  const decoded = decodeFull(`${prefixFor(reference)}${short}`);
  if (decoded === null) {
    return null;
  }
  const resolution = PAIR_RESOLUTIONS[1];
  const shift = (value: number, centre: number): number => {
    if (value - centre > resolution / 2) {
      return value - resolution;
    }
    if (centre - value > resolution / 2) {
      return value + resolution;
    }
    return value;
  };
  return { lat: shift(decoded.lat, reference.lat), lng: shift(decoded.lng, reference.lng) };
}

function parsePlusCode(text: string, reference: Coordinates): Coordinates | null {
  const match = PLUS_CODE.exec(text);
  if (match === null) {
    return null;
  }
  const head = (match[1] ?? '').toUpperCase();
  const tail = (match[2] ?? '').toUpperCase();
  const code = `${head}+${tail}`;
  const decoded = head.length === 8 ? decodeFull(code) : recoverShort(code, reference);
  return decoded === null ? null : point(decoded.lat, decoded.lng);
}

/* Entry point ----------------------------------------------------------- */

export function bboxCentre(bbox: Bbox): Coordinates {
  return { lat: (bbox.minLat + bbox.maxLat) / 2, lng: (bbox.minLng + bbox.maxLng) / 2 };
}

/** Null when the text is not any of the accepted position forms. */
export function parseCoordinates(raw: string, reference: Coordinates): Coordinates | null {
  const text = raw.trim();
  if (text === '') {
    return null;
  }
  return parseDms(text) ?? parseDecimal(text) ?? parsePlusCode(text, reference);
}
