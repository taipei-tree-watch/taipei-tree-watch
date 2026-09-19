import { describe, expect, it } from 'vitest';

import { isFormField, mapApiErrors } from '../src/report/errors.ts';

describe('isFormField', () => {
  it('recognises a request body field', () => {
    expect(isFormField('observed_at')).toBe(true);
  });

  it('rejects a request level name', () => {
    expect(isFormField('content-type')).toBe(false);
  });
});

describe('mapApiErrors', () => {
  it('maps a field error onto its form field', () => {
    const mapped = mapApiErrors({
      errors: [{ field: 'link', message: 'Link must be an https URL on the allowed domain list' }],
    });
    expect(mapped.byField.get('link')).toContain('https');
    expect(mapped.general).toEqual([]);
  });

  it('maps several fields at once', () => {
    const mapped = mapApiErrors({
      errors: [
        { field: 'protected_tree_id', message: 'Protected tree id must be digits' },
        { field: 'inventory_tree_id', message: 'Inventory tree id must be two letters' },
      ],
    });
    expect([...mapped.byField.keys()]).toEqual(['protected_tree_id', 'inventory_tree_id']);
  });

  it('keeps the first message when a field fails twice', () => {
    const mapped = mapApiErrors({
      errors: [
        { field: 'causes', message: 'Unknown cause code 99' },
        { field: 'causes', message: 'Unknown cause code 98' },
      ],
    });
    expect(mapped.byField.get('causes')).toBe('Unknown cause code 99');
  });

  it('collects a request level failure separately', () => {
    const mapped = mapApiErrors({
      errors: [{ field: 'content-type', message: 'Content-Type must be application/json' }],
    });
    expect(mapped.byField.size).toBe(0);
    expect(mapped.general).toEqual([
      { field: 'content-type', message: 'Content-Type must be application/json' },
    ]);
  });

  it('separates field errors from request level ones in the same response', () => {
    const mapped = mapApiErrors({
      errors: [
        { field: 'note', message: 'Note must be at most 300 characters' },
        { field: 'somethingElse', message: 'Unknown field' },
      ],
    });
    expect(mapped.byField.get('note')).toContain('300');
    expect(mapped.general.map((item) => item.field)).toEqual(['somethingElse']);
  });

  it('reports a general failure when the body carries no errors array', () => {
    expect(mapApiErrors({}).general).toHaveLength(1);
    expect(mapApiErrors(null).general).toHaveLength(1);
  });

  it('reports a general failure for an empty errors array', () => {
    expect(mapApiErrors({ errors: [] }).general).toHaveLength(1);
  });

  it('treats a nameless error as a request level one', () => {
    const mapped = mapApiErrors({ errors: [{ message: 'Body must be valid JSON' }] });
    expect(mapped.general).toEqual([{ field: 'body', message: 'Body must be valid JSON' }]);
  });
});
