import { describe, expect, it } from 'vitest';

import { causes, evidence } from '../../shared/tags.ts';
import { formatTemplate, labelForCode, labelsForCodes, linkHostname } from '../src/format.ts';

describe('linkHostname', () => {
  it('shows the hostname instead of the full URL', () => {
    expect(linkHostname('https://www.threads.net/@someone/post/abc?x=1')).toBe('www.threads.net');
    expect(linkHostname('https://imgur.com/a/xyz')).toBe('imgur.com');
  });

  it('lowercases the hostname so a mixed case host cannot look like another site', () => {
    expect(linkHostname('https://ImGuR.com/a/xyz')).toBe('imgur.com');
  });

  it('keeps the real host when the path is dressed up to look like one', () => {
    expect(linkHostname('https://evil.example/threads.net/post')).toBe('evil.example');
  });

  it('returns null for anything that is not an http or https URL', () => {
    expect(linkHostname('not a url')).toBeNull();
    expect(linkHostname('javascript:alert(1)')).toBeNull();
    expect(linkHostname('')).toBeNull();
  });
});

describe('labelForCode', () => {
  it('reads the label out of the shared tag table', () => {
    expect(labelForCode(causes, 1)).toBe('\u8910\u6839\u75C5');
    expect(labelForCode(evidence, 6)).toBe(
      '\u7121\u516C\u544A\uFF0C\u50C5\u76EE\u64CA',
    );
  });

  it('returns null for a missing or unknown code', () => {
    expect(labelForCode(causes, null)).toBeNull();
    expect(labelForCode(causes, 9999)).toBeNull();
  });

  it('drops unknown codes when mapping a list', () => {
    expect(labelsForCodes(causes, [1, 9999])).toEqual(['\u8910\u6839\u75C5']);
  });
});

describe('formatTemplate', () => {
  it('substitutes named placeholders', () => {
    expect(formatTemplate('{shown} of {total}', { shown: 3, total: 9 })).toBe('3 of 9');
  });

  it('leaves a placeholder alone when no value is supplied', () => {
    expect(formatTemplate('{missing}', {})).toBe('{missing}');
  });
});
