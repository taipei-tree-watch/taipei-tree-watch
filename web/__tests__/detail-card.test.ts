/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlanSite } from '../src/data/plan-sites.ts';
import type { ReportRecord } from '../src/data/snapshot.ts';
import type { ProtectedTree } from '../src/data/trees.ts';
import type { PermalinkTarget } from '../src/permalink.ts';
import { permalinkUrl } from '../src/permalink.ts';
import type { CopyOutcome } from '../src/copy-link.ts';
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
  readonly copied: string[];
  readonly notices: string[];
  readonly button: HTMLButtonElement;
  readonly feedback: HTMLElement;
  readonly manual: HTMLElement;
}

function harness(outcome: CopyOutcome, overrides: Partial<DetailCardOptions> = {}) {
  const element = document.createElement('div');
  element.hidden = true;
  document.body.replaceChildren(element);

  const targets: (PermalinkTarget | null)[] = [];
  const copied: string[] = [];
  const notices: string[] = [];

  const card = createDetailCard(element, {
    permalinkUrl: (target) => permalinkUrl(target, PAGE),
    copy: (url) => {
      copied.push(url);
      return Promise.resolve(outcome);
    },
    notify: (message) => {
      notices.push(message);
    },
    onTargetChange: (target) => {
      targets.push(target);
    },
    canEdit: () => false,
    onEdit: () => undefined,
    onReportTree: vi.fn(),
    sameTreeReports: () => [],
    loadRevisions: () => Promise.resolve(new Map()),
    onFollowUp: vi.fn(),
    onCorrect: vi.fn(),
    onShowReport: vi.fn(),
    sameSpotSites: () => [],
    onShowSite: vi.fn(),
    ...overrides,
  });

  const parts: Harness = {
    element,
    targets,
    copied,
    notices,
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

  it('copies the permalink of the card that is open', async () => {
    const { card, copied } = harness('copied');
    card.showTree(TREE);
    await card.copyCurrent();
    expect(copied).toEqual([`${PAGE}?tree=768`]);
  });

  it('confirms a copy in the toast and leaves the card as it was', async () => {
    const { card, feedback, notices } = harness('copied');
    card.showReport(REPORT);
    await card.copyCurrent();
    expect(notices).toEqual([strings.card.copied]);
    expect(feedback.hidden).toBe(true);
  });

  it('shows the address to copy by hand when the clipboard refused', async () => {
    const { card, feedback, manual, notices } = harness('manual');
    card.showReport(REPORT);
    await card.copyCurrent();
    expect(notices).toEqual([]);
    expect(feedback.textContent).toBe(strings.card.copyManual);
    expect(manual.hidden).toBe(false);
    expect(manual.textContent).toBe(`${PAGE}?report=${ULID}`);
  });

  it('leaves no stale manual address on the next card', async () => {
    const { card, feedback, manual } = harness('manual');
    card.showReport(REPORT);
    await card.copyCurrent();
    card.showTree(TREE);
    expect(feedback.hidden).toBe(true);
    expect(manual.hidden).toBe(true);
  });

  it('copies nothing while no card is open', async () => {
    const { card, copied } = harness('copied');
    await card.copyCurrent();
    expect(copied).toEqual([]);
  });

  it('copies from the button as well', () => {
    const { card, button, copied } = harness('copied');
    card.showReport(REPORT);
    button.click();
    expect(copied).toHaveLength(1);
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

describe('detail card choices about a report', () => {
  function labelled(element: HTMLElement, label: string): HTMLButtonElement {
    const found = [...element.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === label,
    );
    if (found === undefined) {
      throw new Error(`button ${label} is missing`);
    }
    return found;
  }

  it('offers follow-up, correction and nothing to add for a user report', () => {
    const onFollowUp = vi.fn();
    const onCorrect = vi.fn();
    const { card, element } = harness('copied', { onFollowUp, onCorrect });
    card.showReport(REPORT);

    const about = labelled(element, strings.card.about);
    expect(about.hidden).toBe(false);
    const box = element.querySelector<HTMLElement>('.card-about');
    expect(box?.hidden).toBe(true);

    about.click();
    expect(box?.hidden).toBe(false);
    labelled(element, strings.card.followUp).click();
    labelled(element, strings.card.correct).click();
    expect(onFollowUp).toHaveBeenCalledWith(REPORT);
    expect(onCorrect).toHaveBeenCalledWith(REPORT);

    labelled(element, strings.card.unchanged).click();
    expect(box?.hidden).toBe(true);
  });

  it('offers nothing for an official record or a report not yet public', () => {
    const { card, element } = harness('copied');
    card.showReport({ ...REPORT, source: 2 });
    expect(labelled(element, strings.card.about).hidden).toBe(true);
    card.showReport({ ...REPORT, pending: true });
    expect(labelled(element, strings.card.about).hidden).toBe(true);
    card.showTree(TREE);
    expect(labelled(element, strings.card.about).hidden).toBe(true);
  });
});

describe('detail card corrections and same tree', () => {
  it('counts corrections and lists them only when asked', async () => {
    const loadRevisions = vi.fn(() =>
      Promise.resolve(
        new Map([
          [
            ULID,
            [
              {
                id: '01',
                reportId: ULID,
                changes: { species: '樟' },
                previous: { species: '榕' },
                reason: '樹牌寫的是樟樹',
                link: 'https://www.threads.net/@a/post/1',
                createdAt: '2026-09-18T07:30:00.000Z',
              },
            ],
          ],
        ]),
      ),
    );
    const { card, element } = harness('copied', { loadRevisions });
    card.showReport({ ...REPORT, revisionCount: 1, revisedAt: '2026-09-18T07:30:00.000Z' });

    const section = element.querySelector<HTMLElement>('.card-revisions');
    expect(section?.textContent).toContain('已更正 1 次，最近 2026-09-18');
    expect(loadRevisions).not.toHaveBeenCalled();

    const toggle = section?.querySelector('button');
    toggle?.click();
    await Promise.resolve();
    await Promise.resolve();

    const list = element.querySelector<HTMLElement>('.card-revision-list');
    expect(list?.hidden).toBe(false);
    expect(list?.textContent).toContain('榕 → 樟');
    expect(list?.textContent).toContain('理由：樹牌寫的是樟樹');
    expect(list?.querySelector('a')?.textContent).toBe('www.threads.net');
    expect(list?.querySelector('a')?.rel).toBe('nofollow noopener');
  });

  it('shows no correction section for an uncorrected report', () => {
    const { card, element } = harness('copied');
    card.showReport(REPORT);
    expect(element.querySelector('.card-revisions')).toBeNull();
  });

  it('links the other reports of the same tree to their own cards', () => {
    const earlier: ReportRecord = { ...REPORT, id: '01JBZ8QF7KJ9M3N4P5R6S7T8V0', observedAt: '2026-08-01' };
    const onShowReport = vi.fn();
    const { card, element } = harness('copied', {
      sameTreeReports: () => [earlier],
      onShowReport,
    });
    card.showReport({ ...REPORT, followsReportId: earlier.id });

    const section = element.querySelector<HTMLElement>('.card-same-tree');
    expect(section?.textContent).toContain('同一棵樹的其他回報 1 筆');
    const anchor = section?.querySelector('a');
    expect(anchor?.textContent).toBe('2026-08-01 的回報');
    expect(anchor?.getAttribute('href')).toContain(earlier.id);
    anchor?.click();
    expect(onShowReport).toHaveBeenCalledWith(earlier);
  });
});

const SITE: PlanSite = {
  id: 'cf720-ruiguang-park',
  lat: 25.07065,
  lng: 121.57833,
  via: 'park-centroid',
  locations: ['內湖區瑞光公園'],
  remove: 174,
  transplant: 0,
  species: [{ name: '榕樹', count: 80 }],
  placed: 0,
  inventoryGone: null,
  title: '臺北捷運環狀線東環段CF720區段標樹木移除計畫',
  status: 'under_review',
  url: 'https://pkl.gov.taipei/News_Content.aspx?n=1&s=2',
  causes: [20],
  causeCounts: [{ code: 20, count: 174 }],
  dispositions: [],
  evidence: 3,
  source: 3,
  observedAt: '2026-09-23',
};

describe('plan site card', () => {
  it('says the point marks the site, then how many trees the plan lists there', () => {
    const { card, element, targets } = harness('copied');
    card.showSite(SITE);
    expect(element.hidden).toBe(false);
    expect(element.querySelector('h2')?.textContent).toBe('公園處計畫地點');
    const caveat = element.querySelector('.card-planned');
    expect(caveat?.textContent).toContain('不是某一棵樹的位置');
    expect(element.querySelector('.card-headline')?.textContent).toBe('此地點計畫移除 174 株');
    expect(element.textContent).toContain('榕樹 80 株');
    expect(element.textContent).toContain('審查中');
    const plan = element.querySelector<HTMLAnchorElement>('.card-row a');
    expect(plan?.href).toBe(SITE.url);
    expect(plan?.rel).toBe('nofollow noopener');
    expect(targets).toEqual([{ kind: 'site', id: SITE.id }]);
  });

  it('offers no report actions on a site', () => {
    const { card, element } = harness('copied');
    card.showSite(SITE);
    const shown = [...element.querySelectorAll<HTMLButtonElement>('.card-share button')]
      .filter((button) => button.closest('[hidden]') === null)
      .map((button) => button.textContent);
    expect(shown).toEqual([strings.card.copyLink]);
  });

  it('copies the site permalink', async () => {
    const { card, copied } = harness('copied');
    card.showSite(SITE);
    await card.copyCurrent();
    expect(copied).toEqual([`${PAGE}?site=${SITE.id}`]);
  });

  it('links other sites on the same point to their own cards', () => {
    const other: PlanSite = { ...SITE, id: 'other', title: '移植計畫', remove: 0, transplant: 18 };
    const onShowSite = vi.fn();
    const { card, element } = harness('copied', { sameSpotSites: () => [other], onShowSite });
    card.showSite(SITE);
    const anchor = element.querySelector<HTMLAnchorElement>('.card-same-tree a');
    expect(anchor?.textContent).toBe('移植計畫（18 株）');
    anchor?.click();
    expect(onShowSite).toHaveBeenCalledWith(other);
  });
});
