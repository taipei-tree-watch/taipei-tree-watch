import { describe, expect, it } from 'vitest';

import {
  editLinkUrl,
  parseEditLink,
  parsePermalink,
  permalinkSearch,
  permalinkUrl,
  withoutEditToken,
} from '../src/permalink.ts';

const ULID = '01JBZ8QF7KJ9M3N4P5R6S7T8V9';
const OTHER_ULID = '01JBZ8QF7KJ9M3N4P5R6S7T8W0';

describe('parsePermalink', () => {
  it('reads a report id', () => {
    expect(parsePermalink(`?report=${ULID}`)).toEqual({ kind: 'report', id: ULID });
  });

  it('reads a protected tree number', () => {
    expect(parsePermalink('?tree=768')).toEqual({ kind: 'tree', id: '768' });
  });

  it('accepts a query string without its leading question mark', () => {
    expect(parsePermalink('tree=768')).toEqual({ kind: 'tree', id: '768' });
  });

  it('normalises a lower case report id, which a link may arrive in', () => {
    expect(parsePermalink(`?report=${ULID.toLowerCase()}`)).toEqual({
      kind: 'report',
      id: ULID,
    });
  });

  it('answers with nothing when neither parameter is there', () => {
    expect(parsePermalink('')).toBeNull();
    expect(parsePermalink('?ortho=1')).toBeNull();
  });

  it('prefers the report when a link carries both', () => {
    expect(parsePermalink(`?tree=768&report=${ULID}`)).toEqual({ kind: 'report', id: ULID });
  });

  it('rejects an id that is not a ULID', () => {
    // U is not in the Crockford alphabet, and 25 characters is one short.
    expect(parsePermalink('?report=01JBZ8QF7KJ9M3N4P5R6S7T8VU')).toBeNull();
    expect(parsePermalink('?report=01JBZ8QF7KJ9M3N4P5R6S7T8V')).toBeNull();
    expect(parsePermalink('?report=')).toBeNull();
  });

  it('rejects a tree number that is not digits', () => {
    expect(parsePermalink('?tree=76a')).toBeNull();
    expect(parsePermalink('?tree=')).toBeNull();
  });

  it('falls back to a usable tree number when the report id is malformed', () => {
    expect(parsePermalink('?report=nope&tree=768')).toEqual({ kind: 'tree', id: '768' });
  });
});

describe('permalinkSearch', () => {
  it('adds the report parameter', () => {
    expect(permalinkSearch({ kind: 'report', id: ULID }, '')).toBe(`?report=${ULID}`);
  });

  it('keeps every other parameter', () => {
    const search = permalinkSearch({ kind: 'tree', id: '768' }, '?ortho=1');
    expect(search).toBe('?ortho=1&tree=768');
  });

  it('replaces a permalink that is already there', () => {
    const search = permalinkSearch({ kind: 'report', id: OTHER_ULID }, `?report=${ULID}`);
    expect(search).toBe(`?report=${OTHER_ULID}`);
  });

  it('swaps a tree permalink for a report one', () => {
    expect(permalinkSearch({ kind: 'report', id: ULID }, '?tree=768')).toBe(`?report=${ULID}`);
  });

  it('removes both parameters for a closed card and keeps the rest', () => {
    expect(permalinkSearch(null, `?ortho=1&report=${ULID}`)).toBe('?ortho=1');
    expect(permalinkSearch(null, '?tree=768')).toBe('');
  });
});

describe('permalinkUrl', () => {
  it('builds an absolute address on the current page', () => {
    const url = permalinkUrl({ kind: 'report', id: ULID }, 'https://example.test/?ortho=1');
    expect(url).toBe(`https://example.test/?ortho=1&report=${ULID}`);
  });

  it('keeps the path it was given', () => {
    const url = permalinkUrl({ kind: 'tree', id: '768' }, 'https://example.test/map');
    expect(url).toBe('https://example.test/map?tree=768');
  });
});

const TOKEN = 'abcDEF0123456789_-abcDEF0123456789_-abcDEF0';

describe('edit links', () => {
  it('reads the report and token of an edit link', () => {
    expect(parseEditLink(`?report=${ULID}&edit=${TOKEN}`)).toEqual({ id: ULID, token: TOKEN });
  });

  it('ignores a token without a report, beside a tree, or of the wrong shape', () => {
    expect(parseEditLink(`?edit=${TOKEN}`)).toBeNull();
    expect(parseEditLink(`?tree=768&edit=${TOKEN}`)).toBeNull();
    expect(parseEditLink(`?report=${ULID}&edit=short`)).toBeNull();
    expect(parseEditLink(`?report=${ULID}`)).toBeNull();
  });

  it('builds an edit link that parses back and keeps the page origin', () => {
    const url = editLinkUrl({ id: ULID, token: TOKEN }, 'https://example.test/?tree=768#x');

    expect(url).toBe(`https://example.test/?report=${ULID}&edit=${TOKEN}`);
    expect(parseEditLink(new URL(url).search)).toEqual({ id: ULID, token: TOKEN });
  });

  it('never carries the token into a permalink', () => {
    const page = `https://example.test/?report=${ULID}&edit=${TOKEN}`;

    expect(permalinkUrl({ kind: 'report', id: OTHER_ULID }, page)).not.toContain(TOKEN);
    expect(permalinkSearch(null, `?report=${ULID}&edit=${TOKEN}&ortho=1`)).toBe('?ortho=1');
  });

  it('takes only the token out of the address bar', () => {
    expect(withoutEditToken(`?report=${ULID}&edit=${TOKEN}&ortho=1`)).toBe(
      `?report=${ULID}&ortho=1`,
    );
    expect(withoutEditToken(`?edit=${TOKEN}`)).toBe('');
  });
});
