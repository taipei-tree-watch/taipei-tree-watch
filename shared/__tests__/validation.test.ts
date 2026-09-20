import { describe, expect, it } from 'vitest';

import {
  EARLIEST_OBSERVED_DATE,
  countCharacters,
  isAllowedLink,
  isCalendarDate,
  isInsideBbox,
  isInventoryTreeId,
  isObservedDateInRange,
  isProtectedTreeId,
  normalizeInventoryTreeId,
  parseBbox,
  roundCoordinate,
  stripUrls,
  taipeiDate,
} from '../validation.ts';

describe('stripUrls', () => {
  it('removes http and https links with their path and query', () => {
    expect(stripUrls('before https://example.com/a?b=c after')).toBe('before after');
    expect(stripUrls('before http://example.com after')).toBe('before after');
  });

  it('removes bare www hosts', () => {
    expect(stripUrls('see www.example.com for details')).toBe('see for details');
  });

  it('removes protocol-relative and non-http schemes', () => {
    expect(stripUrls('a //example.com/x b')).toBe('a b');
    expect(stripUrls('a ftp://example.com/x b')).toBe('a b');
  });

  it('removes every link, not only the first', () => {
    expect(stripUrls('https://a.example https://b.example')).toBe('');
  });

  it('leaves text without links untouched', () => {
    expect(stripUrls('公告記載原因為褐根病')).toBe('公告記載原因為褐根病');
  });
});

describe('isAllowedLink', () => {
  it('accepts a whitelisted domain over https', () => {
    expect(isAllowedLink('https://threads.net/@someone/post/1')).toBe(true);
  });

  it('accepts a subdomain of a whitelisted domain', () => {
    expect(isAllowedLink('https://www.threads.net/@someone/post/1')).toBe(true);
    expect(isAllowedLink('https://i.imgur.com/abc.jpg')).toBe(true);
  });

  it('rejects a domain that merely ends with a whitelisted string', () => {
    expect(isAllowedLink('https://evilthreads.net/x')).toBe(false);
    expect(isAllowedLink('https://threads.net.example.com/x')).toBe(false);
  });

  it('rejects http and other schemes', () => {
    expect(isAllowedLink('http://threads.net/x')).toBe(false);
    expect(isAllowedLink('javascript:alert(1)')).toBe(false);
  });

  it('rejects a domain outside the whitelist and malformed input', () => {
    expect(isAllowedLink('https://example.com/x')).toBe(false);
    expect(isAllowedLink('not a url')).toBe(false);
  });

  it('ignores hostname casing', () => {
    expect(isAllowedLink('https://WWW.Threads.NET/x')).toBe(true);
  });
});

describe('parseBbox and isInsideBbox', () => {
  const bbox = parseBbox('121.43,24.94,121.68,25.24');

  it('parses the minLng,minLat,maxLng,maxLat form', () => {
    expect(bbox).toEqual({ minLng: 121.43, minLat: 24.94, maxLng: 121.68, maxLat: 25.24 });
  });

  it('returns null for malformed or inverted boxes', () => {
    expect(parseBbox('121.43,24.94,121.68')).toBeNull();
    expect(parseBbox('a,b,c,d')).toBeNull();
    expect(parseBbox('121.68,24.94,121.43,25.24')).toBeNull();
  });

  it('accepts a point inside and on the edge', () => {
    expect(bbox).not.toBeNull();
    expect(isInsideBbox(bbox!, 25.0338, 121.5645)).toBe(true);
    expect(isInsideBbox(bbox!, 24.94, 121.43)).toBe(true);
  });

  it('rejects a point outside', () => {
    expect(isInsideBbox(bbox!, 22.6273, 120.3014)).toBe(false);
    expect(isInsideBbox(bbox!, 25.25, 121.5)).toBe(false);
  });
});

describe('roundCoordinate', () => {
  it('rounds to five decimals', () => {
    expect(roundCoordinate(25.0338123456)).toBe(25.03381);
    expect(roundCoordinate(121.564567891)).toBe(121.56457);
  });

  it('leaves an already short value unchanged', () => {
    expect(roundCoordinate(25.033)).toBe(25.033);
  });
});

describe('isCalendarDate', () => {
  it('accepts a real date', () => {
    expect(isCalendarDate('2026-09-19')).toBe(true);
    expect(isCalendarDate('2024-02-29')).toBe(true);
  });

  it('rejects an impossible date', () => {
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
  });

  it('rejects a wrong shape', () => {
    expect(isCalendarDate('2026-9-19')).toBe(false);
    expect(isCalendarDate('19/09/2026')).toBe(false);
  });
});

describe('taipeiDate', () => {
  it('is one day ahead of UTC late in the UTC evening', () => {
    expect(taipeiDate(new Date('2026-09-18T17:00:00Z'))).toBe('2026-09-19');
  });

  it('matches UTC during the UTC daytime', () => {
    expect(taipeiDate(new Date('2026-09-19T03:00:00Z'))).toBe('2026-09-19');
  });
});

describe('isObservedDateInRange', () => {
  const today = '2026-09-19';

  it('accepts today and a past date', () => {
    expect(isObservedDateInRange(today, today)).toBe(true);
    expect(isObservedDateInRange('2020-01-01', today)).toBe(true);
    expect(isObservedDateInRange(EARLIEST_OBSERVED_DATE, today)).toBe(true);
  });

  it('rejects a future date', () => {
    expect(isObservedDateInRange('2026-09-20', today)).toBe(false);
  });

  it('rejects a date before the earliest accepted one', () => {
    expect(isObservedDateInRange('1999-12-31', today)).toBe(false);
  });
});

describe('tree id formats', () => {
  it('accepts digits for a protected tree id', () => {
    expect(isProtectedTreeId('1525')).toBe(true);
    expect(isProtectedTreeId('0768')).toBe(true);
  });

  it('rejects a protected tree id with letters or punctuation', () => {
    expect(isProtectedTreeId('A1525')).toBe(false);
    expect(isProtectedTreeId('15-25')).toBe(false);
    expect(isProtectedTreeId('')).toBe(false);
  });

  it('accepts two letters plus ten digits for an inventory tree id', () => {
    expect(isInventoryTreeId('BT0614021096')).toBe(true);
    expect(isInventoryTreeId('bt0614021096')).toBe(true);
  });

  it('rejects the wrong number of letters or digits', () => {
    expect(isInventoryTreeId('B0614021096')).toBe(false);
    expect(isInventoryTreeId('BT061402109')).toBe(false);
    expect(isInventoryTreeId('BT06140210966')).toBe(false);
  });

  it('normalizes an inventory tree id to uppercase', () => {
    expect(normalizeInventoryTreeId('bt0614021096')).toBe('BT0614021096');
  });
});

describe('countCharacters', () => {
  it('counts a CJK character as one', () => {
    expect(countCharacters('褐根病')).toBe(3);
  });

  it('counts an astral character as one', () => {
    expect(countCharacters('🌳')).toBe(1);
  });
});
