import { describe, expect, it } from 'vitest';

import { REPORT_BBOX } from '../src/config.ts';
import type { Coordinates } from '../src/report/coordinates.ts';
import { bboxCentre, parseCoordinates } from '../src/report/coordinates.ts';

const CENTRE = bboxCentre(REPORT_BBOX);

/** Metres between two points, flat earth, good enough at city scale. */
function metres(a: Coordinates, b: Coordinates): number {
  const dLat = (a.lat - b.lat) * 111_320;
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

function pointOf(text: string): Coordinates {
  const parsed = parseCoordinates(text, CENTRE);
  if (parsed === null) {
    throw new Error(`not a point: ${text}`);
  }
  return parsed;
}

describe('parseCoordinates, as copied from Google Maps', () => {
  it('reads decimal degrees', () => {
    expect(pointOf('25.020775, 121.544781')).toEqual({ lat: 25.020775, lng: 121.544781 });
  });

  it('reads decimal degrees in parentheses', () => {
    expect(pointOf('(25.0282291, 121.5457989)')).toEqual({ lat: 25.0282291, lng: 121.5457989 });
  });

  it('reads degrees, minutes and seconds', () => {
    const found = pointOf('25°01\'14.4"N 121°32\'39.6"E');
    expect(found.lat).toBeCloseTo(25.020667, 6);
    expect(found.lng).toBeCloseTo(121.544333, 6);
  });

  it('reads a short Plus Code followed by its locality', () => {
    // 2GCV+7P8, then a village and a district name.
    const found = pointOf('2GCV+7P8 學府里 臺北市大安區');
    const dms = pointOf('25°01\'14.4"N 121°32\'39.6"E');
    expect(metres(found, dms)).toBeLessThan(3);
  });

  it('reads the same place from its full Plus Code', () => {
    expect(metres(pointOf('7QQ32GCV+7P8'), pointOf('2gcv+7p8'))).toBeLessThan(0.01);
  });



  it('accepts a longitude-first pair', () => {
    expect(pointOf('121.544781, 25.020775')).toEqual({ lat: 25.020775, lng: 121.544781 });
  });


  it('leaves other text alone', () => {
    for (const text of ['', '1234', 'BT0614021096', '八德路一段55號', '1+1', 'https://maps.app.goo.gl/AbCdEf123', 'https://www.google.com/maps/@25.03,121.55,17z']) {
      expect(parseCoordinates(text, CENTRE)).toBeNull();
    }
  });

  it('rejects values that are not degrees', () => {
    expect(parseCoordinates('95.1, 200.2', CENTRE)).toBeNull();
    expect(parseCoordinates('ZZZZ+ZZ', CENTRE)).toBeNull();
  });
});
