import { describe, expect, it } from 'vitest';

import { REPORT_BBOX } from '../src/config.ts';
import type { ProtectedTree } from '../src/data/trees.ts';
import { bboxCentre } from '../src/report/coordinates.ts';
import { lookupPlace, parseLookupQuery } from '../src/report/lookup.ts';

const CENTRE = bboxCentre(REPORT_BBOX);

const TREE: ProtectedTree = {
  id: '1',
  species: 'Banyan',
  lat: 25.0448,
  lng: 121.532,
  dbhM: 1.08,
  address: null,
  manager: null,
  siteType: null,
  district: null,
};

const findTree = (id: string): ProtectedTree | undefined => (id === TREE.id ? TREE : undefined);
const DEPS = { bbox: REPORT_BBOX, findTree, treesLoaded: true };

describe('parseLookupQuery', () => {
  it('returns null for blank input', () => {
    expect(parseLookupQuery('   ', CENTRE)).toBeNull();
  });

  it('reads a pasted position', () => {
    expect(parseLookupQuery('25.020775, 121.544781', CENTRE)).toEqual({
      kind: 'point',
      lat: 25.020775,
      lng: 121.544781,
    });
  });

  it('reads digits as a protected tree number', () => {
    expect(parseLookupQuery(' 1234 ', CENTRE)).toEqual({ kind: 'tree', id: '1234' });
    expect(parseLookupQuery('#0012', CENTRE)).toEqual({ kind: 'tree', id: '12' });
    expect(parseLookupQuery('０', CENTRE)).toEqual({ kind: 'tree', id: '0' });
    expect(parseLookupQuery('＃１２３', CENTRE)).toEqual({ kind: 'tree', id: '123' });
  });

  it('reports anything else as unrecognised', () => {
    for (const text of [
      'BT0614021096',
      '八德路一段55號',
      'https://maps.app.goo.gl/AbCdEf123',
      'https://www.google.com/maps/@25.03,121.55,17z',
    ]) {
      expect(parseLookupQuery(text, CENTRE)).toEqual({ kind: 'unrecognised' });
    }
  });
});

describe('lookupPlace', () => {
  it('accepts a pasted position inside the range only', () => {
    expect(lookupPlace({ kind: 'point', lat: 25.02, lng: 121.54 }, DEPS)).toEqual({
      kind: 'point',
      lat: 25.02,
      lng: 121.54,
    });
    expect(lookupPlace({ kind: 'point', lat: 22.6, lng: 120.3 }, DEPS)).toEqual({
      kind: 'pointOutside',
    });
  });

  it('finds a protected tree by number', () => {
    expect(lookupPlace({ kind: 'tree', id: '1' }, DEPS)).toEqual({ kind: 'tree', tree: TREE });
  });

  it('distinguishes a missing tree from a layer that has not loaded', () => {
    expect(lookupPlace({ kind: 'tree', id: '9' }, DEPS)).toEqual({ kind: 'treeMissing', id: '9' });
    expect(lookupPlace({ kind: 'tree', id: '1' }, { ...DEPS, treesLoaded: false })).toEqual({
      kind: 'treesUnavailable',
    });
  });

  it('passes an unrecognised query through', () => {
    expect(lookupPlace({ kind: 'unrecognised' }, DEPS)).toEqual({ kind: 'unrecognised' });
  });
});
