import { describe, expect, it } from 'vitest';

import type { ReportRecord } from '../src/data/snapshot.ts';
import { emptyDraft } from '../src/report/draft.ts';
import { prefillFromReport, sameTreeStage } from '../src/report/same-tree.ts';

const REPORT: ReportRecord = {
  id: '01JBZ8QF7KJ9M3N4P5R6S7T8V9',
  lat: 25.0448,
  lng: 121.532,
  species: '榕',
  causes: [1],
  dispositions: [2],
  evidence: 3,
  source: null,
  note: 'leaves falling',
  link: 'https://example.test/notice',
  observedAt: '2026-09-01',
  protectedTreeId: '1',
  inventoryTreeId: 'A-17',
  createdAt: '2026-09-02T00:00:00.000Z',
};

describe('sameTreeStage', () => {
  it('hides the box when no report is near', () => {
    expect(sameTreeStage(null, null)).toBe('none');
    expect(sameTreeStage(null, { reportId: REPORT.id, answer: 'same' })).toBe('none');
  });

  it('asks when the nearby report has no answer yet', () => {
    expect(sameTreeStage(REPORT.id, null)).toBe('ask');
  });

  it('keeps the answer while the same report stays nearest', () => {
    expect(sameTreeStage(REPORT.id, { reportId: REPORT.id, answer: 'same' })).toBe('same');
    expect(sameTreeStage(REPORT.id, { reportId: REPORT.id, answer: 'different' })).toBe(
      'different',
    );
    expect(sameTreeStage(REPORT.id, { reportId: REPORT.id, answer: 'update' })).toBe('update');
  });

  it('asks again once a different report is nearest', () => {
    expect(sameTreeStage('01JBZ8QF7KJ9M3N4P5R6S7T8VA', { reportId: REPORT.id, answer: 'different' })).toBe(
      'ask',
    );
  });
});

describe('prefillFromReport', () => {
  it('copies what identifies the tree into an empty draft', () => {
    const draft = prefillFromReport(emptyDraft(), REPORT);
    expect(draft.species).toBe('榕');
    expect(draft.protectedTreeId).toBe('1');
    expect(draft.inventoryTreeId).toBe('A-17');
  });

  it('leaves the condition for the reporter to describe', () => {
    const empty = emptyDraft();
    const draft = prefillFromReport(empty, REPORT);
    expect(draft.causes).toEqual(empty.causes);
    expect(draft.dispositions).toEqual(empty.dispositions);
    expect(draft.evidence).toBe(empty.evidence);
    expect(draft.note).toBe('');
    expect(draft.link).toBe('');
    expect(draft.observedAt).toBe('');
  });

  it('never overwrites what the reporter already filled', () => {
    const draft = prefillFromReport(
      { ...emptyDraft(), species: '樟', protectedTreeId: '99', inventoryTreeId: 'B-2' },
      REPORT,
    );
    expect(draft.species).toBe('樟');
    expect(draft.protectedTreeId).toBe('99');
    expect(draft.inventoryTreeId).toBe('B-2');
  });

  it('leaves fields empty when the earlier report has nothing to give', () => {
    const draft = prefillFromReport(emptyDraft(), {
      ...REPORT,
      species: null,
      protectedTreeId: null,
      inventoryTreeId: null,
    });
    expect(draft.species).toBe('');
    expect(draft.protectedTreeId).toBe('');
    expect(draft.inventoryTreeId).toBe('');
  });
});
