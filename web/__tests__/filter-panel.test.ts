/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';

import { REMOVAL_PLAN_SOURCE_CODES, USER_REPORT_SOURCE_CODE } from '../../shared/tags.ts';

const [REMOVAL_PLAN_SOURCE_CODE] = REMOVAL_PLAN_SOURCE_CODES;
import type { FilterState } from '../src/filters.ts';
import { createFilterPanel } from '../src/ui/filter-panel.ts';

function sourceBox(element: HTMLElement, code: number): HTMLInputElement {
  const input = element.querySelector<HTMLInputElement>(`input[name=source][value="${String(code)}"]`);
  if (input === null) {
    throw new Error(`no source option ${String(code)}`);
  }
  return input;
}

describe('filter panel data source group', () => {
  it('opens with only user reports ticked', () => {
    const element = document.body.appendChild(document.createElement('div'));
    const panel = createFilterPanel(element, () => undefined);
    expect(sourceBox(element, USER_REPORT_SOURCE_CODE).checked).toBe(true);
    expect(sourceBox(element, REMOVAL_PLAN_SOURCE_CODE).checked).toBe(false);
    expect([...panel.getState().sources]).toEqual([USER_REPORT_SOURCE_CODE]);
  });

  it('adds plan trees when their box is ticked', () => {
    const element = document.body.appendChild(document.createElement('div'));
    const states: FilterState[] = [];
    createFilterPanel(element, (state) => states.push(state));
    sourceBox(element, REMOVAL_PLAN_SOURCE_CODE).click();
    expect([...(states.at(-1)?.sources ?? [])].sort()).toEqual([
      USER_REPORT_SOURCE_CODE,
      REMOVAL_PLAN_SOURCE_CODE,
    ]);
  });

  it('resets to the default rather than to nothing', () => {
    const element = document.body.appendChild(document.createElement('div'));
    const panel = createFilterPanel(element, () => undefined);
    sourceBox(element, REMOVAL_PLAN_SOURCE_CODE).click();
    sourceBox(element, USER_REPORT_SOURCE_CODE).click();
    element.querySelector<HTMLButtonElement>('.filter-reset')?.click();
    expect(sourceBox(element, USER_REPORT_SOURCE_CODE).checked).toBe(true);
    expect(sourceBox(element, REMOVAL_PLAN_SOURCE_CODE).checked).toBe(false);
    expect([...panel.getState().sources]).toEqual([USER_REPORT_SOURCE_CODE]);
  });

  it('shows a report count on each source option, zero when none is given', () => {
    const element = document.body.appendChild(document.createElement('div'));
    const panel = createFilterPanel(element, () => undefined);
    panel.setSourceCounts(new Map([[USER_REPORT_SOURCE_CODE, 12]]));
    const countOf = (code: number): string | null | undefined =>
      sourceBox(element, code).parentElement?.querySelector('.filter-count')?.textContent;
    expect(countOf(USER_REPORT_SOURCE_CODE)).toBe('12');
    expect(countOf(REMOVAL_PLAN_SOURCE_CODE)).toBe('0');
  });
});
