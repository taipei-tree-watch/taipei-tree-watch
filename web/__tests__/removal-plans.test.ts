import { describe, expect, it } from 'vitest';

import committed from '../../data/removal-plans/index.json';
import { DecodeError } from '../src/data/columns.ts';
import { attachPlans, decodeRemovalPlans } from '../src/data/removal-plans.ts';
import type { ReportRecord } from '../src/data/snapshot.ts';

const URL = 'https://pkl.gov.taipei/News_Content.aspx?n=1&s=2';

function payload(rows: unknown[], cases: unknown = {}): unknown {
  return {
    schema: 1,
    cases: {
      removal_A: { title: 'A plan', status: 'approved', posted_at: '2026-09-23', url: URL },
      ...(cases as object),
    },
    columns: ['id', 'case', 'action'],
    rows,
  };
}

function report(id: string): ReportRecord {
  return {
    id,
    lat: 25.03,
    lng: 121.56,
    species: null,
    causes: [],
    dispositions: [],
    evidence: 3,
    source: 3,
    note: null,
    link: null,
    observedAt: '2026-09-23',
    protectedTreeId: null,
    inventoryTreeId: null,
    createdAt: null,
  };
}

describe('decodeRemovalPlans', () => {
  it('joins each row to its case', () => {
    const plans = decodeRemovalPlans(payload([['R1', 'removal_A', 'transplant']]));
    expect(plans.get('R1')).toEqual({
      title: 'A plan',
      status: 'approved',
      url: URL,
      action: 'transplant',
    });
  });

  it('reads rows by column name', () => {
    const plans = decodeRemovalPlans({
      ...(payload([]) as object),
      columns: ['action', 'id', 'case'],
      rows: [['remove', 'R1', 'removal_A']],
    });
    expect(plans.get('R1')?.action).toBe('remove');
  });

  it('skips rows naming an unknown case, action or status', () => {
    const plans = decodeRemovalPlans(
      payload(
        [
          ['R1', 'removal_missing', 'remove'],
          ['R2', 'removal_A', 'retain'],
          ['R3', 'removal_B', 'remove'],
          'not a row',
          ['R4', 'removal_A', 'remove'],
        ],
        { removal_B: { title: 'B', status: 'maybe', url: URL } },
      ),
    );
    expect([...plans.keys()]).toEqual(['R4']);
  });

  it('rejects a payload without the required columns', () => {
    expect(() => decodeRemovalPlans({ cases: {}, columns: ['id'], rows: [] })).toThrow(DecodeError);
  });

  it('decodes the committed index in full', () => {
    const plans = decodeRemovalPlans(committed);
    expect(plans.size).toBe(committed.rows.length);
    expect(plans.size).toBeGreaterThan(0);
    for (const plan of plans.values()) {
      expect(plan.url.startsWith('https://pkl.gov.taipei/')).toBe(true);
    }
  });
});

describe('attachPlans', () => {
  it('adds the plan to the records it names and leaves the rest alone', () => {
    const plans = decodeRemovalPlans(payload([['R1', 'removal_A', 'remove']]));
    const other = report('R2');
    const [first, second] = attachPlans([report('R1'), other], plans);
    expect(first?.plan?.title).toBe('A plan');
    expect(second).toBe(other);
  });

  it('returns the same list when the file did not load', () => {
    const reports = [report('R1')];
    expect(attachPlans(reports, null)).toBe(reports);
  });
});
