/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReportRecord } from '../src/data/snapshot.ts';
import type { ProtectedTree } from '../src/data/trees.ts';
import type { PermalinkTarget } from '../src/permalink.ts';
import { permalinkUrl } from '../src/permalink.ts';
import type { ShareOutcome } from '../src/share.ts';
import type { DetailCardOptions } from '../src/ui/detail-card.ts';
import { createDetailCard } from '../src/ui/detail-card.ts';
import strings from '../src/ui-strings.json';

const ULID = '01JBZ8QF7KJ9M3N4P5R6S7T8V9';
const PAGE = 'https://example.test/';

const REPORT: ReportRecord = {
  id: ULID,
  lat: 25.0232,
  lng: 121.5056,
  species: null,
  causes: [],
  dispositions: [],
  evidence: null,
  source: null,
  note: null,
  link: null,
  observedAt: null,
  protectedTreeId: null,
  inventoryTreeId: null,
  createdAt: null,
};

const TREE: ProtectedTree = {
  id: '768',
  species: null,
  lat: 25.0232,
  lng: 121.5056,
  dbhM: null,
  address: null,
  manager: null,
  siteType: null,
  district: null,
};

interface Harness {
  readonly element: HTMLElement;
  readonly targets: (PermalinkTarget | null)[];
  readonly shared: { url: string; title: string }[];
  readonly button: HTMLButtonElement;
  readonly feedback: HTMLElement;
  readonly manual: HTMLElement;
}

function harness(outcome: ShareOutcome, overrides: Partial<DetailCardOptions> = {}) {
  const element = document.createElement('div');
  element.hidden = true;
  document.body.replaceChildren(element);

  const targets: (PermalinkTarget | null)[] = [];
  const shared: { url: string; title: string }[] = [];

  const card = createDetailCard(element, {
    permalinkUrl: (target) => permalinkUrl(target, PAGE),
    share: (url, title) => {
      shared.push({ url, title });
      return Promise.resolve(outcome);
    },
    onTargetChange: (target) => {
      targets.push(target);
    },
    canEdit: () => false,
    onEdit: () => undefined,
    onReportTree: vi.fn(),
    ...overrides,
  });

  const parts: Harness = {
    element,
    targets,
    shared,
    button: element.querySelector('.card-share .form-secondary') as HTMLButtonElement,
    feedback: element.querySelector('.card-share-feedback') as HTMLElement,
    manual: element.querySelector('.card-share-url') as HTMLElement,
  };
  return { card, ...parts };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('detail card permalink', () => {
  it('announces the open report so the page can write the address', () => {
    const { card, targets } = harness('copied');
    card.showReport(REPORT);
    expect(targets).toEqual([{ kind: 'report', id: ULID }]);
  });

  it('announces the open protected tree', () => {
    const { card, targets } = harness('copied');
    card.showTree(TREE);
    expect(targets).toEqual([{ kind: 'tree', id: '768' }]);
  });

  it('announces a closed card so the address goes back to the plain map', () => {
    const { card, targets } = harness('copied');
    card.showReport(REPORT);
    card.hide();
    expect(targets).toEqual([{ kind: 'report', id: ULID }, null]);
  });

  it('closes from the card button as well', () => {
    const { card, element, targets } = harness('copied');
    card.showReport(REPORT);
    const close = element.querySelector('.panel-close') as HTMLButtonElement;
    expect(close.getAttribute('aria-label')).toBe(strings.card.close);
    expect(close.querySelector('svg')).not.toBeNull();
    close.click();
    expect(element.hidden).toBe(true);
    expect(targets.at(-1)).toBeNull();
  });

  it('shares the permalink of the card that is open', async () => {
    const { card, shared } = harness('shared');
    card.showTree(TREE);
    await card.shareCurrent();
    expect(shared).toEqual([{ url: `${PAGE}?tree=768`, title: strings.app.title }]);
  });

  it('confirms a copy and takes the confirmation back down', async () => {
    vi.useFakeTimers();
    try {
      const { card, feedback } = harness('copied', { feedbackMs: 1000 });
      card.showReport(REPORT);
      await card.shareCurrent();
      expect(feedback.hidden).toBe(false);
      expect(feedback.textContent).toBe(strings.card.copied);

      vi.advanceTimersByTime(1000);
      expect(feedback.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the address to copy by hand when nothing automatic worked', async () => {
    const { card, feedback, manual } = harness('manual');
    card.showReport(REPORT);
    await card.shareCurrent();
    expect(feedback.textContent).toBe(strings.card.copyManual);
    expect(manual.hidden).toBe(false);
    expect(manual.textContent).toBe(`${PAGE}?report=${ULID}`);
  });

  it('says nothing when the reader closed the share sheet', async () => {
    const { card, feedback, manual } = harness('dismissed');
    card.showReport(REPORT);
    await card.shareCurrent();
    expect(feedback.hidden).toBe(true);
    expect(manual.hidden).toBe(true);
  });

  it('leaves no stale confirmation on the next card', async () => {
    const { card, feedback } = harness('copied');
    card.showReport(REPORT);
    await card.shareCurrent();
    card.showTree(TREE);
    expect(feedback.hidden).toBe(true);
  });

  it('shares nothing while no card is open', async () => {
    const { card, shared } = harness('copied');
    await card.shareCurrent();
    expect(shared).toEqual([]);
  });

  it('shares from the button as well', () => {
    const { card, button, shared } = harness('copied');
    card.showReport(REPORT);
    button.click();
    expect(shared).toHaveLength(1);
  });
});

describe('edit button', () => {
  function editButton(element: HTMLElement): HTMLButtonElement {
    const buttons = element.querySelectorAll<HTMLButtonElement>('.card-share .form-secondary');
    return buttons[1] as HTMLButtonElement;
  }

  it('is hidden for a report this browser holds no edit link for', () => {
    const { card, element } = harness('copied');
    card.showReport(REPORT);
    expect(editButton(element).hidden).toBe(true);
  });

  it('opens the edit for a report whose link is held', () => {
    const edited: string[] = [];
    const { card, element } = harness('copied', {
      canEdit: (id) => id === REPORT.id,
      onEdit: (id) => {
        edited.push(id);
      },
    });
    card.showReport(REPORT);

    expect(editButton(element).hidden).toBe(false);
    editButton(element).click();
    expect(edited).toEqual([REPORT.id]);
  });

  it('is hidden on a protected tree card', () => {
    const { card, element } = harness('copied', { canEdit: () => true });
    card.showTree(TREE);
    expect(editButton(element).hidden).toBe(true);
  });
});

describe('report from a protected tree card', () => {
  function reportButton(element: HTMLElement): HTMLButtonElement {
    return element.querySelector('.card-share .form-submit') as HTMLButtonElement;
  }

  it('offers the button on a tree card and hands over that tree', () => {
    const onReportTree = vi.fn();
    const { card, element } = harness('copied', { onReportTree });
    card.showTree(TREE);

    const button = reportButton(element);
    expect(button.hidden).toBe(false);
    expect(button.textContent).toBe(strings.card.reportTree);
    button.click();
    expect(onReportTree).toHaveBeenCalledWith(TREE);
  });

  it('leaves the button off a report card', () => {
    const onReportTree = vi.fn();
    const { card, element } = harness('copied', { onReportTree });
    card.showTree(TREE);
    card.showReport(REPORT);

    const button = reportButton(element);
    expect(button.hidden).toBe(true);
    button.click();
    expect(onReportTree).not.toHaveBeenCalled();
  });
});

describe('pending notice', () => {
  it('heads a report only this browser holds with a not yet public notice', () => {
    const { card, element } = harness('copied');
    card.showReport({ ...REPORT, pending: true });
    const first = element.querySelector('.card-body')?.firstElementChild;
    expect(first?.classList.contains('card-pending')).toBe(true);
    expect(first?.textContent).toBe(strings.card.pending);
  });

  it('leaves a snapshot report without the notice', () => {
    const { card, element } = harness('copied');
    card.showReport(REPORT);
    expect(element.querySelector('.card-pending')).toBeNull();
  });

  it('drops the notice when the next card is a snapshot report', () => {
    const { card, element } = harness('copied');
    card.showReport({ ...REPORT, pending: true });
    card.showReport(REPORT);
    expect(element.querySelector('.card-pending')).toBeNull();
  });
});
