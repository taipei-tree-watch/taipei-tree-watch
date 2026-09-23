import { describe, expect, it } from 'vitest';

import { isEditToken } from '../../shared/validation.ts';
import {
  SELECT_REPORTS_WITHOUT_LINK,
  editUrl,
  importSnippet,
  issueLinks,
  newToken,
  storageEntries,
  tokenHash,
  updateSql,
} from '../edit-links.ts';

const ROW = { id: '01JBZ8QF7KJ9M3N4P5R6S7T8V9', lat: 25.03, lng: 121.56, species: '榕' };
const TOKEN = 'a'.repeat(43);

describe('issue edit links', () => {
  it('generates tokens the site accepts', () => {
    const token = newToken();
    expect(isEditToken(token)).toBe(true);
    expect(newToken()).not.toBe(token);
  });

  it('hashes like the Worker: sha256 hex of the token text', () => {
    expect(tokenHash('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('builds an edit link on the given site', () => {
    expect(editUrl('https://example.test/path?x=1#y', ROW.id, TOKEN)).toBe(
      `https://example.test/path?report=${ROW.id}&edit=${TOKEN}`,
    );
  });

  it('only selects visible user reports without a link', () => {
    expect(SELECT_REPORTS_WITHOUT_LINK).toContain('edit_token_hash IS NULL');
    expect(SELECT_REPORTS_WITHOUT_LINK).toContain('status = 0');
    expect(SELECT_REPORTS_WITHOUT_LINK).toContain('source = 1');
  });

  it('writes one guarded UPDATE per report and never the token itself', () => {
    const links = issueLinks([ROW], 'https://example.test/', () => TOKEN);
    const sql = updateSql(links);

    expect(sql).toBe(
      `UPDATE reports SET edit_token_hash = '${tokenHash(TOKEN)}' ` +
        `WHERE id = '${ROW.id}' AND edit_token_hash IS NULL;`,
    );
    expect(sql).not.toContain(TOKEN);
  });

  it('refuses a row whose id is not a ULID', () => {
    expect(() => issueLinks([{ ...ROW, id: "x'; DROP TABLE reports;--" }], 'https://e/')).toThrow();
  });

  it('produces browser storage entries and a console snippet that carries them', () => {
    const links = issueLinks([ROW], 'https://example.test/', () => TOKEN);

    expect(storageEntries(links, 'now')).toEqual([
      { id: ROW.id, token: TOKEN, savedAt: 'now', lat: 25.03, lng: 121.56, species: '榕' },
    ]);
    const snippet = importSnippet(links, 'now');
    expect(snippet).toContain("'ttw:edit-links'");
    expect(snippet).toContain(TOKEN);
  });
});
