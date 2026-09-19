import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EVIDENCE_CODE,
  EVIDENCE_CODES_WITHOUT_CAUSES,
} from '../../shared/tags.ts';
import type { Bbox } from '../../shared/validation.ts';
import {
  MIN_SUBMIT_ZOOM,
  buildRequestBody,
  causesAllowed,
  draftIssues,
  emptyDraft,
  submitBlock,
  withEvidence,
} from '../src/report/draft.ts';

/** Same values as the Worker's BBOX var. */
const BBOX: Bbox = { minLng: 121.3, minLat: 24.85, maxLng: 121.75, maxLat: 25.35 };

const INSIDE = { lat: 25.033, lng: 121.5654, zoom: MIN_SUBMIT_ZOOM };
const TODAY = '2026-09-19';

/** The evidence codes the spec calls out: sighting only, and a high risk tag. */
const [HIGH_RISK_TAG, SIGHTING_ONLY] = EVIDENCE_CODES_WITHOUT_CAUSES;
/** An on-site notice, which is evidence a cause can be copied from. */
const SITE_NOTICE = 1;

describe('emptyDraft', () => {
  it('starts on the sighting-only evidence source', () => {
    expect(emptyDraft().evidence).toBe(DEFAULT_EVIDENCE_CODE);
  });

  it('starts with nothing else filled in', () => {
    const draft = emptyDraft();
    expect(draft.causes).toEqual([]);
    expect(draft.dispositions).toEqual([]);
    expect(draft.species).toBe('');
    expect(draft.observedAt).toBe('');
  });
});

describe('causesAllowed', () => {
  it('is false for every evidence source that states no cause', () => {
    for (const code of EVIDENCE_CODES_WITHOUT_CAUSES) {
      expect(causesAllowed(code)).toBe(false);
    }
  });

  it('is true for an on-site notice', () => {
    expect(causesAllowed(SITE_NOTICE)).toBe(true);
  });
});

describe('withEvidence', () => {
  it('clears causes when switching to a source that states none', () => {
    const picked = { ...emptyDraft(), evidence: SITE_NOTICE, causes: [1, 3] };
    expect(withEvidence(picked, SIGHTING_ONLY).causes).toEqual([]);
  });

  it('clears causes when switching to the high risk tag', () => {
    const picked = { ...emptyDraft(), evidence: SITE_NOTICE, causes: [1] };
    expect(withEvidence(picked, HIGH_RISK_TAG).causes).toEqual([]);
  });

  it('keeps causes when the new source can carry them', () => {
    const picked = { ...emptyDraft(), evidence: SITE_NOTICE, causes: [1, 3] };
    expect(withEvidence(picked, 2).causes).toEqual([1, 3]);
  });
});

describe('submitBlock', () => {
  it('passes a point inside the box at the threshold zoom', () => {
    expect(submitBlock(INSIDE, BBOX)).toBeNull();
  });

  it('blocks a zoom below the threshold', () => {
    expect(submitBlock({ ...INSIDE, zoom: MIN_SUBMIT_ZOOM - 0.1 }, BBOX)).toBe('zoom');
  });

  it('passes above the threshold', () => {
    expect(submitBlock({ ...INSIDE, zoom: 19.4 }, BBOX)).toBeNull();
  });

  it('passes a zoom that rounds to the threshold, as the map buttons produce', () => {
    expect(submitBlock({ ...INSIDE, zoom: MIN_SUBMIT_ZOOM - 0.00004 }, BBOX)).toBeNull();
  });

  it('blocks a zoom that still rounds below the threshold', () => {
    expect(submitBlock({ ...INSIDE, zoom: MIN_SUBMIT_ZOOM - 0.06 }, BBOX)).toBe('zoom');
  });

  it('blocks a point outside the box', () => {
    expect(submitBlock({ lat: 24.8, lng: 120.97, zoom: 19 }, BBOX)).toBe('bbox');
  });

  it('reports the box before the zoom when both fail', () => {
    expect(submitBlock({ lat: 24.8, lng: 120.97, zoom: 12 }, BBOX)).toBe('bbox');
  });
});

describe('draftIssues', () => {
  it('finds nothing in an untouched draft', () => {
    expect(draftIssues(emptyDraft(), TODAY)).toEqual([]);
  });

  it('flags a species over fifty characters', () => {
    const draft = { ...emptyDraft(), species: 'a'.repeat(51) };
    expect(draftIssues(draft, TODAY)).toEqual([{ field: 'species', code: 'speciesLength' }]);
  });

  // Escaped rather than literal: source files in this repo stay ASCII.
  it('counts a species in code points, so fifty CJK characters pass', () => {
    const draft = { ...emptyDraft(), species: '\u6a5f'.repeat(50) };
    expect(draftIssues(draft, TODAY)).toEqual([]);
  });

  it('measures the note after links are stripped', () => {
    const draft = { ...emptyDraft(), note: `${'a'.repeat(300)} https://example.com/${'b'.repeat(80)}` };
    expect(draftIssues(draft, TODAY)).toEqual([]);
  });

  it('flags a note that is too long on its own text', () => {
    const draft = { ...emptyDraft(), note: 'a'.repeat(301) };
    expect(draftIssues(draft, TODAY)).toEqual([{ field: 'note', code: 'noteLength' }]);
  });

  it('flags a link outside the whitelist', () => {
    const draft = { ...emptyDraft(), link: 'https://example.com/post/1' };
    expect(draftIssues(draft, TODAY)).toEqual([{ field: 'link', code: 'linkDomain' }]);
  });

  it('accepts a whitelisted link and its subdomains', () => {
    expect(draftIssues({ ...emptyDraft(), link: 'https://www.threads.net/x' }, TODAY)).toEqual([]);
  });

  it('flags an observation date after today in Taipei', () => {
    const draft = { ...emptyDraft(), observedAt: '2026-09-20' };
    expect(draftIssues(draft, TODAY)).toEqual([
      { field: 'observed_at', code: 'observedRange' },
    ]);
  });

  it('accepts today itself', () => {
    expect(draftIssues({ ...emptyDraft(), observedAt: TODAY }, TODAY)).toEqual([]);
  });

  it('flags identifier formats', () => {
    const draft = { ...emptyDraft(), protectedTreeId: '12a4', inventoryTreeId: 'BT061402' };
    expect(draftIssues(draft, TODAY)).toEqual([
      { field: 'protected_tree_id', code: 'protectedTreeId' },
      { field: 'inventory_tree_id', code: 'inventoryTreeId' },
    ]);
  });

  it('accepts a lowercase inventory id, which is normalised on send', () => {
    expect(draftIssues({ ...emptyDraft(), inventoryTreeId: 'bt0614021096' }, TODAY)).toEqual([]);
  });
});

describe('buildRequestBody', () => {
  const token = 'turnstile-token';

  it('leaves source out, because the server decides it', () => {
    const body = buildRequestBody(emptyDraft(), INSIDE, token);
    expect('source' in body).toBe(false);
  });

  it('sends only the fields the Worker schema accepts', () => {
    expect(Object.keys(buildRequestBody(emptyDraft(), INSIDE, token)).sort()).toEqual([
      'causes',
      'dispositions',
      'evidence',
      'inventory_tree_id',
      'lat',
      'link',
      'lng',
      'note',
      'observed_at',
      'protected_tree_id',
      'species',
      'turnstile_token',
    ]);
  });

  it('rounds coordinates to the stored precision', () => {
    const body = buildRequestBody(emptyDraft(), { lat: 25.0331234, lng: 121.5654987, zoom: 19 }, token);
    expect(body.lat).toBe(25.03312);
    expect(body.lng).toBe(121.5655);
  });

  it('turns blank and whitespace-only fields into null', () => {
    const draft = { ...emptyDraft(), species: '   ', note: '', link: '  ', observedAt: '' };
    const body = buildRequestBody(draft, INSIDE, token);
    expect(body.species).toBeNull();
    expect(body.note).toBeNull();
    expect(body.link).toBeNull();
    expect(body.observed_at).toBeNull();
    expect(body.protected_tree_id).toBeNull();
    expect(body.inventory_tree_id).toBeNull();
  });

  it('empties causes when the evidence source states none', () => {
    const draft = { ...emptyDraft(), evidence: SIGHTING_ONLY, causes: [1, 2] };
    expect(buildRequestBody(draft, INSIDE, token).causes).toEqual([]);
  });

  it('keeps causes when the evidence source carries them', () => {
    const draft = { ...emptyDraft(), evidence: SITE_NOTICE, causes: [1, 20] };
    expect(buildRequestBody(draft, INSIDE, token).causes).toEqual([1, 20]);
  });

  it('strips links out of the note', () => {
    const draft = { ...emptyDraft(), note: 'see https://threads.net/post/1 for the notice' };
    expect(buildRequestBody(draft, INSIDE, token).note).toBe('see for the notice');
  });

  it('nulls a note that was nothing but a link', () => {
    const draft = { ...emptyDraft(), note: 'https://threads.net/post/1' };
    expect(buildRequestBody(draft, INSIDE, token).note).toBeNull();
  });

  it('uppercases the inventory id and trims the rest', () => {
    const draft = { ...emptyDraft(), inventoryTreeId: ' bt0614021096 ', species: ' Ficus  ' };
    const body = buildRequestBody(draft, INSIDE, token);
    expect(body.inventory_tree_id).toBe('BT0614021096');
    expect(body.species).toBe('Ficus');
  });

  it('carries the challenge token', () => {
    expect(buildRequestBody(emptyDraft(), INSIDE, token).turnstile_token).toBe(token);
  });
});
