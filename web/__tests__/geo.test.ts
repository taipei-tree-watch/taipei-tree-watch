import { describe, expect, it } from 'vitest';

import { PROTECTED_TREE_RADIUS_M, haversineMeters, nearestWithin } from '../src/geo.ts';

/** One degree of latitude on the mean sphere the helper uses. */
const METRES_PER_DEGREE_LAT = 111_194.93;

const CENTER = { lat: 25.033, lng: 121.5654 };

function north(center: { lat: number; lng: number }, metres: number) {
  return { ...center, lat: center.lat + metres / METRES_PER_DEGREE_LAT };
}

describe('haversineMeters', () => {
  it('is zero for the same point', () => {
    expect(haversineMeters(CENTER, CENTER)).toBe(0);
  });

  it('measures a degree of latitude', () => {
    const away = { lat: CENTER.lat + 1, lng: CENTER.lng };
    expect(haversineMeters(CENTER, away)).toBeCloseTo(METRES_PER_DEGREE_LAT, 0);
  });

  it('measures a short north-south offset to the metre', () => {
    expect(haversineMeters(CENTER, north(CENTER, 20))).toBeCloseTo(20, 2);
  });

  it('is symmetric', () => {
    const away = north(CENTER, 37);
    expect(haversineMeters(CENTER, away)).toBeCloseTo(haversineMeters(away, CENTER), 9);
  });

  it('shrinks an east-west degree by the cosine of the latitude', () => {
    const east = { lat: CENTER.lat, lng: CENTER.lng + 1 };
    const expected = METRES_PER_DEGREE_LAT * Math.cos((CENTER.lat * Math.PI) / 180);
    expect(haversineMeters(CENTER, east)).toBeCloseTo(expected, 0);
  });
});

describe('nearestWithin', () => {
  const trees = [
    { id: 'far', lat: north(CENTER, 300).lat, lng: CENTER.lng },
    { id: 'edge', lat: north(CENTER, 19).lat, lng: CENTER.lng },
    { id: 'close', lat: north(CENTER, 5).lat, lng: CENTER.lng },
  ];

  it('returns null when nothing is in range', () => {
    expect(nearestWithin(trees, north(CENTER, 5_000), PROTECTED_TREE_RADIUS_M)).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(nearestWithin([], CENTER, PROTECTED_TREE_RADIUS_M)).toBeNull();
  });

  it('picks the closest item, not the first in range', () => {
    const found = nearestWithin(trees, CENTER, PROTECTED_TREE_RADIUS_M);
    expect(found?.item.id).toBe('close');
    expect(found?.distanceM).toBeCloseTo(5, 1);
  });

  it('excludes an item just outside the radius', () => {
    const justOutside = [{ id: 'out', lat: north(CENTER, 20.5).lat, lng: CENTER.lng }];
    expect(nearestWithin(justOutside, CENTER, PROTECTED_TREE_RADIUS_M)).toBeNull();
  });

  it('includes an item just inside the radius', () => {
    const justInside = [{ id: 'in', lat: north(CENTER, 19.5).lat, lng: CENTER.lng }];
    expect(nearestWithin(justInside, CENTER, PROTECTED_TREE_RADIUS_M)?.item.id).toBe('in');
  });

  it('keeps the earlier item when two are equidistant', () => {
    const pair = [
      { id: 'first', lat: north(CENTER, 10).lat, lng: CENTER.lng },
      { id: 'second', lat: north(CENTER, -10).lat, lng: CENTER.lng },
    ];
    expect(nearestWithin(pair, CENTER, PROTECTED_TREE_RADIUS_M)?.item.id).toBe('first');
  });

  it('does not let the latitude prefilter drop a nearby item to the east', () => {
    const east = [
      {
        id: 'east',
        lat: CENTER.lat,
        lng: CENTER.lng + 10 / (METRES_PER_DEGREE_LAT * Math.cos((CENTER.lat * Math.PI) / 180)),
      },
    ];
    expect(nearestWithin(east, CENTER, PROTECTED_TREE_RADIUS_M)?.item.id).toBe('east');
  });
});
