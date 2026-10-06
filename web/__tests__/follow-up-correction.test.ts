/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from 'vitest';

import type { RevisionsByReport } from '../src/data/revisions.ts';
import type { ReportRecord } from '../src/data/snapshot.ts';
import type { ReportFormOptions } from '../src/ui/report-form.ts';
import { createReportForm } from '../src/ui/report-form.ts';
import strings from '../src/ui-strings.json';

vi.mock('../src/turnstile.ts', () => ({
  renderTurnstile: () => Promise.resolve({ getToken: () => 'solved', reset: () => undefined }),
}));

const CENTER = { lat: 25.04, lng: 121.54 };

const NEARBY: ReportRecord = {
  id: '01JBZ8QF7KJ9M3N4P5R6S7T8V9',
  lat: CENTER.lat + 0.00005,
  lng: CENTER.lng,
  species: '榕',
  causes: [],
  dispositions: [2],
  evidence: 6,
  source: 1,
  note: null,
  link: null,
  observedAt: '2026-08-01',
  protectedTreeId: '1525',
  inventoryTreeId: null,
  createdAt: '2026-08-02T00:00:00.000Z',
  revisionCount: 0,
};

interface Sent {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

function harness(overrides: Partial<ReportFormOptions> = {}) {
  const values = new Map<string, string>();
  const sent: Sent[] = [];
  let view = { ...CENTER, zoom: 19 };
  const respond = vi.fn((url: string) =>
    url.endsWith('/revisions')
      ? Response.json({ id: '01JBZ8QF7KJ9M3N4P5R6S7T8VB' }, { status: 201 })
      : Response.json({ id: '01JBZ8QF7KJ9M3N4P5R6S7T8VA', edit_token: 'token' }, { status: 201 }),
  );
  const options: ReportFormOptions = {
    getView: () => view,
    bbox: { minLng: 121.43, minLat: 24.94, maxLng: 121.68, maxLat: 25.24 },
    onPendingReport: vi.fn(),
    onModeChange: vi.fn(),
    onDismiss: vi.fn(),
    fetchImpl: (url, init) => {
      sent.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return Promise.resolve(respond(url));
    },
    now: () => new Date('2026-09-01T00:00:00Z'),
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
    onEditLink: vi.fn(),
    onEditLinkGone: vi.fn(),
    onEditingChange: vi.fn(),
    onCorrectingChange: vi.fn(),
    loadRevisions: () => Promise.resolve(new Map()),
    flyTo: vi.fn(),
    editLinkUrl: () => 'https://example.test/?edit=x',
    reportUrl: (id) => `https://example.test/?report=${id}`,
    copy: () => Promise.resolve('copied'),
    notify: vi.fn(),
    confirm: () => true,
    ...overrides,
  };
  const container = document.createElement('div');
  const form = createReportForm(container, options);
  form.setReports([NEARBY]);
  form.setActive(true);
  return {
    container,
    form,
    options,
    sent,
    respond,
    moveTo(lat: number, lng: number) {
      view = { lat, lng, zoom: 19 };
      form.update();
    },
  };
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (element) => element.textContent === label && !isHidden(element),
  );
  if (found === undefined) {
    throw new Error(`button ${label} is missing`);
  }
  return found;
}

function isHidden(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node !== null; node = node.parentElement) {
    if (node.hidden) {
      return true;
    }
  }
  return false;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function submit(form: HTMLFormElement | null): void {
  form?.dispatchEvent(new Event('submit', { cancelable: true }));
}

function type(input: HTMLInputElement | HTMLTextAreaElement | null, value: string): void {
  if (input === null) {
    throw new Error('input is missing');
  }
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('follow-up report from the nearby box', () => {
  async function answerUpdate(container: HTMLElement): Promise<void> {
    button(container, strings.form.toForm).click();
    button(container, strings.form.nearbyReportSame).click();
    button(container, strings.form.nearbyReportUpdate).click();
    await settle();
  }

  it('sends the report it follows', async () => {
    const { container, sent } = harness();
    await answerUpdate(container);

    submit(container.querySelector('form.form-fields'));
    await settle();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe('/api/reports');
    expect(sent[0]?.body.follows_report_id).toBe(NEARBY.id);
    expect(sent[0]?.body.species).toBe('榕');
  });

  it('sends a plain report when the tree is a different one', async () => {
    const { container, sent } = harness();
    button(container, strings.form.toForm).click();
    button(container, strings.form.nearbyReportDifferent).click();
    await settle();

    submit(container.querySelector('form.form-fields'));
    await settle();

    expect(sent[0]?.body).not.toHaveProperty('follows_report_id');
  });

  it('asks again when the point moved more than 20 m away, and can drop the link', async () => {
    const confirm = vi.fn(() => false);
    const { container, sent, moveTo } = harness({ confirm });
    await answerUpdate(container);
    button(container, strings.form.toPicking).click();
    moveTo(CENTER.lat + 0.0004, CENTER.lng);
    button(container, strings.form.toForm).click();
    await settle();

    submit(container.querySelector('form.form-fields'));
    await settle();

    expect(confirm).toHaveBeenCalledWith(strings.form.followTooFar);
    expect(sent[0]?.body).not.toHaveProperty('follows_report_id');
  });

  it('starts from a card with the answer already given', async () => {
    const { container, form, options, sent } = harness();
    form.startFollowUp(NEARBY);
    expect(options.flyTo).toHaveBeenCalledWith(NEARBY);

    button(container, strings.form.toForm).click();
    await settle();
    submit(container.querySelector('form.form-fields'));
    await settle();

    expect(sent[0]?.body.follows_report_id).toBe(NEARBY.id);
  });
});

describe('correction from the nearby box', () => {
  it('opens the correction panel on the nearby report', async () => {
    const { container, options } = harness();
    button(container, strings.form.toForm).click();
    button(container, strings.form.nearbyReportSame).click();
    button(container, strings.form.nearbyReportCorrect).click();
    await settle();

    expect(container.dataset.mode).toBe('correcting');
    expect(container.querySelector<HTMLElement>('.correction')?.hidden).toBe(false);
    expect(container.querySelector<HTMLElement>('.form-picker')?.hidden).toBe(true);
    expect(options.onCorrectingChange).toHaveBeenLastCalledWith(true);
    expect(options.onModeChange).toHaveBeenLastCalledWith('correcting');
  });

  it('is not offered for a report that is not a user report', () => {
    const { container, form } = harness();
    form.setReports([{ ...NEARBY, source: 2 }]);
    button(container, strings.form.toForm).click();
    button(container, strings.form.nearbyReportSame).click();

    expect(() => button(container, strings.form.nearbyReportCorrect)).toThrow();
  });
});

describe('correction panel', () => {
  function panel(container: HTMLElement): HTMLElement {
    const element = container.querySelector<HTMLElement>('.correction');
    if (element === null) {
      throw new Error('correction panel is missing');
    }
    return element;
  }

  function submitButton(container: HTMLElement): HTMLButtonElement {
    return button(panel(container), strings.correction.submit);
  }

  it('fills the current values and sends only what changed', async () => {
    const { container, form, sent } = harness();
    form.startCorrection(NEARBY);
    await settle();

    const inputs = panel(container).querySelectorAll<HTMLInputElement>('input[type="text"]');
    expect(inputs[0]?.value).toBe('榕');
    expect(inputs[1]?.value).toBe('1525');
    expect(submitButton(container).disabled).toBe(true);

    type(inputs[0] ?? null, '樟');
    expect(submitButton(container).disabled).toBe(true);
    type(panel(container).querySelector('textarea'), '樹牌寫的是樟樹');
    expect(submitButton(container).disabled).toBe(false);

    submit(panel(container).querySelector('form'));
    await settle();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(`/api/reports/${NEARBY.id}/revisions`);
    expect(sent[0]?.body).toEqual({
      turnstile_token: 'solved',
      base_revision_id: null,
      changes: { species: '樟' },
      reason: '樹牌寫的是樟樹',
      link: null,
    });
    expect(panel(container).querySelector('.form-result')?.textContent).toBe(
      strings.correction.success,
    );
  });

  it('bases the correction on the latest revision of a corrected report', async () => {
    const revisions: RevisionsByReport = new Map([
      [
        NEARBY.id,
        [
          {
            id: '01JBZ8QF7KJ9M3N4P5R6S7T8W1',
            reportId: NEARBY.id,
            changes: { species: '榕' },
            previous: { species: null },
            reason: 'x',
            link: null,
            createdAt: null,
          },
        ],
      ],
    ]);
    const { container, form, sent } = harness({ loadRevisions: () => Promise.resolve(revisions) });
    form.startCorrection({ ...NEARBY, revisionCount: 1 });
    await settle();

    type(panel(container).querySelector('input[type="text"]'), '樟');
    type(panel(container).querySelector('textarea'), '樹牌');
    submit(panel(container).querySelector('form'));
    await settle();

    expect(sent[0]?.body.base_revision_id).toBe('01JBZ8QF7KJ9M3N4P5R6S7T8W1');
  });

  it('moves the point only after aiming, and not beyond 30 m', async () => {
    const { container, form, sent, moveTo } = harness();
    form.startCorrection(NEARBY);
    await settle();

    button(panel(container), strings.correction.aim).click();
    expect(container.dataset.mode).toBe('picking');
    moveTo(NEARBY.lat + 0.0004, NEARBY.lng);
    expect(button(panel(container), strings.correction.useLocation).disabled).toBe(true);

    moveTo(NEARBY.lat + 0.0001, NEARBY.lng);
    button(panel(container), strings.correction.useLocation).click();
    expect(container.dataset.mode).toBe('correcting');

    type(panel(container).querySelector('textarea'), '點位偏到隔壁');
    submit(panel(container).querySelector('form'));
    await settle();

    expect(sent[0]?.body.changes).toEqual({ lat: NEARBY.lat + 0.0001, lng: NEARBY.lng });
  });

  it('explains a conflict and keeps what was typed', async () => {
    const { container, form, respond } = harness();
    respond.mockImplementation(() => Response.json({ errors: [] }, { status: 409 }));
    form.startCorrection(NEARBY);
    await settle();

    type(panel(container).querySelector('input[type="text"]'), '樟');
    type(panel(container).querySelector('textarea'), '樹牌');
    submit(panel(container).querySelector('form'));
    await settle();

    expect(panel(container).querySelector('.form-result')?.textContent).toBe(
      strings.correction.errors.conflict,
    );
    expect(panel(container).querySelector<HTMLInputElement>('input[type="text"]')?.value).toBe(
      '樟',
    );
    expect(submitButton(container).hidden).toBe(false);
  });

  it('closes the sheet on cancel and brings the picker back next time', async () => {
    const { container, form, options } = harness();
    form.startCorrection(NEARBY);
    await settle();

    button(panel(container), strings.correction.cancel).click();
    expect(options.onDismiss).toHaveBeenCalled();
    form.setActive(false);
    form.setActive(true);

    expect(panel(container).hidden).toBe(true);
    expect(container.querySelector<HTMLElement>('.form-picker')?.hidden).toBe(false);
    expect(container.dataset.mode).toBe('picking');
    expect(options.onCorrectingChange).toHaveBeenLastCalledWith(false);
  });
});
