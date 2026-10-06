/**
 * The correction panel: the sheet's third mode, beside aiming and the report
 * fields.
 *
 * It lists only the fields a correction may change, filled with the report's
 * current values, and sends only what the reader changed. The position is
 * left alone unless the reader chooses to aim again: then the sheet shrinks
 * as it does while aiming a report, the crosshair measures how far the point
 * would move, and "use this position" locks it.
 *
 * Nothing is kept locally after a correction is accepted. Someone else may be
 * correcting the same report, so what the map shows next is left to the
 * snapshot the Worker publishes.
 */
import { CORRECTION_MAX_DISTANCE_M, REASON_MAX_CHARS } from '../../../shared/revisions.ts';
import type { EvidenceCode } from '../../../shared/tags.ts';
import { causes as causeTags, evidence as evidenceTags } from '../../../shared/tags.ts';
import type { Bbox } from '../../../shared/validation.ts';
import { SPECIES_MAX_CHARS, countCharacters, stripUrls } from '../../../shared/validation.ts';
import type { RevisionsLoader } from '../data/revisions.ts';
import { latestRevisionId } from '../data/revisions.ts';
import type { ReportRecord } from '../data/snapshot.ts';
import { formatTemplate } from '../format.ts';
import type { LatLng } from '../geo.ts';
import type { CorrectionDraft, CorrectionIssueCode } from '../report/correction.ts';
import {
  buildCorrectionBody,
  correctionChanges,
  correctionDraftFrom,
  correctionIssues,
  locationIssue,
  moveDistance,
  submitCorrection,
} from '../report/correction.ts';
import type { PickedView } from '../report/draft.ts';
import { causesAllowed, linkFeedback } from '../report/draft.ts';
import type { FetchLike } from '../report/submit.ts';
import type { TurnstileWidget } from '../turnstile.ts';
import { renderTurnstile } from '../turnstile.ts';
import { Check, Crosshair, Send, setIconLabel, X } from '../icons.ts';
import strings from '../ui-strings.json';
import { hintCounter, labelled, tagGroup } from './form-controls.ts';

export interface CorrectionPanelOptions {
  readonly getView: () => PickedView;
  readonly bbox: Bbox;
  readonly fetchImpl: FetchLike;
  readonly loadRevisions: RevisionsLoader;
  /** Bring the crosshair back over the report before the reader aims. */
  readonly flyTo: (point: LatLng) => void;
  /** Aiming started or ended, so the sheet can shrink or grow. */
  readonly onAimingChange: (aiming: boolean) => void;
  /** Cancelled, or finished after a correction was accepted. */
  readonly onClose: () => void;
}

export interface CorrectionPanel {
  readonly element: HTMLElement;
  start(report: ReportRecord): void;
  /** The camera moved. */
  update(): void;
  /** The sheet closed or turned to another task. */
  stop(): void;
}

type BaseState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly id: string | null }
  | { readonly kind: 'failed' };

export function createCorrectionPanel(options: CorrectionPanelOptions): CorrectionPanel {
  let report: ReportRecord | null = null;
  let draft: CorrectionDraft | null = null;
  /** The aimed position; null keeps the report where it is. */
  let location: PickedView | null = null;
  let aiming = false;
  let base: BaseState = { kind: 'loading' };
  let widget: TurnstileWidget | null = null;
  let widgetPending = false;
  let submitting = false;
  let message: { readonly text: string; readonly tone: 'ok' | 'error' } | null = null;
  let done = false;
  /** Guards a revisions load that finishes after the reader moved on. */
  let session = 0;

  const element = document.createElement('section');
  element.className = 'correction';
  element.hidden = true;

  const intro = document.createElement('p');
  intro.className = 'form-hint';
  intro.textContent = strings.correction.intro;
  const publicNote = document.createElement('p');
  publicNote.className = 'form-hint';
  publicNote.textContent = strings.correction.publicNote;

  /* Location ------------------------------------------------------------- */

  const locationBox = document.createElement('div');
  locationBox.className = 'form-nearby';
  const locationTitle = document.createElement('p');
  locationTitle.className = 'form-nearby-question';
  locationTitle.textContent = strings.correction.location;
  const locationLine = document.createElement('p');
  locationLine.className = 'form-hint';
  const locationGate = document.createElement('p');
  locationGate.className = 'form-gate';
  locationGate.hidden = true;

  function button(className: string, icon: Parameters<typeof setIconLabel>[1], label: string) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    setIconLabel(element, icon, label);
    return element;
  }

  const aimButton = button('form-secondary', Crosshair, strings.correction.aim);
  const useButton = button('form-secondary', Check, strings.correction.useLocation);
  const keepButton = button('form-secondary', X, strings.correction.keepLocation);
  const locationActions = document.createElement('div');
  locationActions.className = 'form-picker-actions';
  locationActions.append(aimButton, useButton, keepButton);
  locationBox.append(locationTitle, locationLine, locationGate, locationActions);

  /* Fields --------------------------------------------------------------- */

  const fields = document.createElement('form');
  fields.className = 'form-fields correction-fields';
  fields.noValidate = true;

  const errorSlots = new Map<string, HTMLElement>();

  const speciesInput = document.createElement('input');
  speciesInput.type = 'text';
  speciesInput.maxLength = SPECIES_MAX_CHARS;
  speciesInput.autocomplete = 'off';
  const speciesRow = labelled(strings.form.species, speciesInput, strings.form.speciesHint, true);
  errorSlots.set('species', speciesRow.error);

  const evidenceGroup = document.createElement('fieldset');
  evidenceGroup.className = 'form-group';
  const evidenceLegend = document.createElement('legend');
  evidenceLegend.textContent = strings.form.evidence;
  const evidenceOptions = document.createElement('div');
  evidenceOptions.className = 'form-options';
  const evidenceInputs: HTMLInputElement[] = [];
  for (const tag of evidenceTags) {
    const wrapper = document.createElement('label');
    wrapper.className = 'form-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'correction-evidence';
    input.value = String(tag.code);
    input.addEventListener('change', () => {
      if (!input.checked || draft === null) {
        return;
      }
      const evidence = tag.code as EvidenceCode;
      draft = {
        ...draft,
        evidence,
        causes: causesAllowed(evidence) ? draft.causes : [],
      };
      render();
    });
    evidenceInputs.push(input);
    const caption = document.createElement('span');
    caption.textContent = tag.label;
    wrapper.append(input, caption);
    evidenceOptions.append(wrapper);
  }
  evidenceGroup.append(evidenceLegend, evidenceOptions);

  const causeBlock = tagGroup(
    strings.form.causes,
    strings.form.causesHint,
    causeTags,
    'correction-cause',
    (code, checked) => {
      if (draft === null) {
        return;
      }
      const next = draft.causes.filter((entry) => entry !== code);
      if (checked) {
        next.push(code);
      }
      draft = { ...draft, causes: next };
      render();
    },
  );
  errorSlots.set('causes', causeBlock.error);

  const protectedInput = document.createElement('input');
  protectedInput.type = 'text';
  protectedInput.inputMode = 'numeric';
  protectedInput.autocomplete = 'off';
  const protectedRow = labelled(
    strings.form.protectedTreeId,
    protectedInput,
    strings.form.protectedTreeIdHint,
    true,
  );
  errorSlots.set('protected_tree_id', protectedRow.error);

  const inventoryInput = document.createElement('input');
  inventoryInput.type = 'text';
  inventoryInput.autocomplete = 'off';
  const inventoryRow = labelled(
    strings.form.inventoryTreeId,
    inventoryInput,
    strings.form.inventoryTreeIdHint,
    true,
  );
  errorSlots.set('inventory_tree_id', inventoryRow.error);

  const reasonInput = document.createElement('textarea');
  reasonInput.rows = 3;
  const reasonRow = labelled(
    strings.correction.reason,
    reasonInput,
    strings.correction.reasonHint,
    false,
  );
  const reasonCounter = hintCounter(reasonRow.hint);
  errorSlots.set('reason', reasonRow.error);

  const linkInput = document.createElement('input');
  linkInput.type = 'url';
  linkInput.inputMode = 'url';
  linkInput.autocomplete = 'off';
  const linkRow = labelled(strings.correction.link, linkInput, strings.form.linkHint, true);
  const linkDomain = document.createElement('p');
  linkDomain.className = 'form-hint';
  linkDomain.hidden = true;
  linkRow.row.insertBefore(linkDomain, linkRow.error);
  errorSlots.set('link', linkRow.error);

  const turnstileBox = document.createElement('div');
  turnstileBox.className = 'form-turnstile';

  const pendingLine = document.createElement('p');
  pendingLine.className = 'form-hint';
  pendingLine.hidden = true;

  const resultLine = document.createElement('p');
  resultLine.className = 'form-result';
  resultLine.setAttribute('role', 'status');
  resultLine.hidden = true;

  const submitButton = document.createElement('button');
  submitButton.type = 'submit';
  submitButton.className = 'form-submit';
  setIconLabel(submitButton, Send, strings.correction.submit);

  const cancelButton = button('form-secondary', X, strings.correction.cancel);
  const doneButton = button('form-secondary', Check, strings.correction.done);
  doneButton.hidden = true;

  fields.append(
    speciesRow.row,
    evidenceGroup,
    causeBlock.group,
    protectedRow.row,
    inventoryRow.row,
    reasonRow.row,
    linkRow.row,
    turnstileBox,
    pendingLine,
    submitButton,
    resultLine,
  );

  const footer = document.createElement('div');
  footer.className = 'form-picker-actions';
  footer.append(cancelButton, doneButton);

  element.append(intro, publicNote, locationBox, fields, footer);

  /* Behaviour ------------------------------------------------------------ */

  function issueText(code: CorrectionIssueCode): string {
    return strings.correction.issues[code];
  }

  function setAiming(next: boolean): void {
    if (aiming === next) {
      return;
    }
    aiming = next;
    options.onAimingChange(next);
  }

  async function ensureWidget(): Promise<void> {
    if (widget !== null || widgetPending) {
      return;
    }
    widgetPending = true;
    try {
      widget = await renderTurnstile(turnstileBox);
    } catch (error) {
      console.error('turnstile failed to render', error);
      message = { text: strings.form.errors.turnstileLoad, tone: 'error' };
    } finally {
      widgetPending = false;
      render();
    }
  }

  function fill(): void {
    if (draft === null) {
      return;
    }
    speciesInput.value = draft.species;
    protectedInput.value = draft.protectedTreeId;
    inventoryInput.value = draft.inventoryTreeId;
    reasonInput.value = draft.reason;
    linkInput.value = draft.link;
    linkDomain.hidden = true;
  }

  function renderLocation(target: ReportRecord): void {
    const view = options.getView();
    locationGate.hidden = true;
    if (aiming) {
      const distance = moveDistance(target, view);
      locationLine.textContent = `${strings.correction.aimHint} ${formatTemplate(
        strings.correction.distance,
        { distance: distance.toFixed(0), max: CORRECTION_MAX_DISTANCE_M },
      )}`;
      const issue = locationIssue(target, view, options.bbox);
      if (issue !== null) {
        locationGate.hidden = false;
        locationGate.textContent = issueText(issue);
      }
      useButton.disabled = issue !== null;
    } else if (location === null) {
      locationLine.textContent = strings.correction.locationKept;
    } else {
      locationLine.textContent = formatTemplate(strings.correction.locationMoved, {
        distance: moveDistance(target, location).toFixed(0),
      });
    }
    setIconLabel(
      aimButton,
      Crosshair,
      location === null ? strings.correction.aim : strings.correction.reaim,
    );
    aimButton.hidden = aiming || done;
    useButton.hidden = !aiming;
    keepButton.hidden = !aiming && location === null;
    keepButton.disabled = done;
  }

  function render(): void {
    const target = report;
    const current = draft;
    if (target === null || current === null) {
      return;
    }
    renderLocation(target);

    // Aiming wants the map, so everything below the location box steps aside.
    fields.hidden = aiming;
    footer.hidden = aiming;
    intro.hidden = aiming;
    publicNote.hidden = aiming;

    const allowed = causesAllowed(current.evidence);
    for (const input of causeBlock.inputs) {
      input.checked = allowed && current.causes.includes(Number(input.value));
      input.disabled = !allowed || done;
    }
    causeBlock.group.hidden = !allowed;
    for (const input of evidenceInputs) {
      input.checked = Number(input.value) === current.evidence;
      input.disabled = done;
    }
    for (const input of [speciesInput, protectedInput, inventoryInput, reasonInput, linkInput]) {
      input.disabled = done;
    }

    reasonCounter.textContent = formatTemplate(strings.form.charCounter, {
      count: countCharacters(stripUrls(reasonInput.value)),
      max: REASON_MAX_CHARS,
    });

    const issues = correctionIssues(current, target, location, options.bbox);
    const shown = new Map<string, string>();
    for (const issue of issues) {
      // A missing reason is the normal state of an untouched form; the
      // disabled button says enough until the reader starts typing.
      if (issue.code === 'reasonMissing' || issue.code === 'noChanges') {
        continue;
      }
      shown.set(issue.field, issueText(issue.code));
    }
    for (const [field, slot] of errorSlots) {
      const text = shown.get(field);
      slot.hidden = text === undefined;
      slot.textContent = text ?? '';
    }

    const blocking = issues.find((issue) => issue.code === 'noChanges');
    pendingLine.hidden = done || blocking === undefined;
    pendingLine.textContent = blocking === undefined ? '' : issueText(blocking.code);

    resultLine.hidden = message === null;
    resultLine.textContent = message?.text ?? '';
    if (message !== null) {
      resultLine.dataset.tone = message.tone;
    }

    submitButton.hidden = done;
    submitButton.disabled =
      issues.length > 0 || submitting || base.kind !== 'ready' || widget === null;
    setIconLabel(
      submitButton,
      Send,
      submitting ? strings.correction.submitting : strings.correction.submit,
    );
    cancelButton.hidden = done;
    doneButton.hidden = !done;
  }

  function loadBase(target: ReportRecord): void {
    if ((target.revisionCount ?? 0) === 0) {
      base = { kind: 'ready', id: null };
      return;
    }
    base = { kind: 'loading' };
    const started = session;
    options
      .loadRevisions()
      .then((revisions) => {
        if (started !== session) {
          return;
        }
        base = { kind: 'ready', id: latestRevisionId(revisions, target.id) };
        render();
      })
      .catch((error: unknown) => {
        if (started !== session) {
          return;
        }
        console.error('revisions failed to load', error);
        base = { kind: 'failed' };
        message = { text: strings.correction.errors.revisions, tone: 'error' };
        render();
      });
  }

  async function send(): Promise<void> {
    const target = report;
    const current = draft;
    if (target === null || current === null || submitting || done || base.kind !== 'ready') {
      return;
    }
    const token = widget?.getToken() ?? '';
    if (token === '') {
      message = { text: strings.form.errors.turnstileMissing, tone: 'error' };
      render();
      return;
    }
    const changes = correctionChanges(current, target, location);
    submitting = true;
    message = null;
    render();

    const outcome = await submitCorrection(
      target.id,
      buildCorrectionBody(current, changes, base.id, token),
      options.fetchImpl,
    );
    submitting = false;
    widget?.reset();

    if (outcome.kind === 'created') {
      done = true;
      message = { text: strings.correction.success, tone: 'ok' };
    } else if (outcome.kind === 'conflict') {
      message = { text: strings.correction.errors.conflict, tone: 'error' };
    } else if (outcome.kind === 'missing') {
      message = { text: strings.correction.errors.missing, tone: 'error' };
    } else if (outcome.kind === 'turnstile') {
      message = { text: strings.form.errors.turnstile_token, tone: 'error' };
    } else if (outcome.kind === 'rejected') {
      message = { text: strings.correction.errors.rejected, tone: 'error' };
    } else {
      message = { text: strings.correction.errors.network, tone: 'error' };
    }
    render();
  }

  /* Wiring --------------------------------------------------------------- */

  speciesInput.addEventListener('input', () => {
    if (draft !== null) {
      draft = { ...draft, species: speciesInput.value };
      render();
    }
  });
  protectedInput.addEventListener('input', () => {
    if (draft !== null) {
      draft = { ...draft, protectedTreeId: protectedInput.value };
      render();
    }
  });
  inventoryInput.addEventListener('input', () => {
    if (draft !== null) {
      draft = { ...draft, inventoryTreeId: inventoryInput.value };
      render();
    }
  });
  reasonInput.addEventListener('input', () => {
    if (draft !== null) {
      draft = { ...draft, reason: reasonInput.value };
      render();
    }
  });
  reasonInput.addEventListener('blur', () => {
    const stripped = stripUrls(reasonInput.value);
    if (draft !== null && stripped !== reasonInput.value.trim()) {
      reasonInput.value = stripped;
      draft = { ...draft, reason: stripped };
      render();
    }
  });
  linkInput.addEventListener('input', () => {
    if (draft === null) {
      return;
    }
    draft = { ...draft, link: linkInput.value };
    const feedback = linkFeedback(linkInput.value);
    linkDomain.hidden = feedback.kind !== 'accepted';
    if (feedback.kind === 'accepted') {
      linkDomain.dataset.tone = 'ok';
      linkDomain.textContent = formatTemplate(strings.form.linkDomainOk, {
        domain: feedback.domain,
      });
    }
    render();
  });

  aimButton.addEventListener('click', () => {
    if (report === null) {
      return;
    }
    options.flyTo(location ?? report);
    setAiming(true);
    render();
  });
  useButton.addEventListener('click', () => {
    if (report === null) {
      return;
    }
    const view = options.getView();
    if (locationIssue(report, view, options.bbox) !== null) {
      return;
    }
    location = view;
    setAiming(false);
    render();
  });
  keepButton.addEventListener('click', () => {
    location = null;
    setAiming(false);
    if (report !== null) {
      options.flyTo(report);
    }
    render();
  });

  fields.addEventListener('submit', (event) => {
    event.preventDefault();
    void send();
  });
  cancelButton.addEventListener('click', () => {
    options.onClose();
  });
  doneButton.addEventListener('click', () => {
    options.onClose();
  });

  return {
    element,
    start(next) {
      session += 1;
      report = next;
      draft = correctionDraftFrom(next);
      location = null;
      aiming = false;
      submitting = false;
      message = null;
      done = false;
      fill();
      loadBase(next);
      element.hidden = false;
      widget?.reset();
      void ensureWidget();
      render();
    },
    update() {
      if (!element.hidden && aiming) {
        render();
      }
    },
    stop() {
      session += 1;
      report = null;
      draft = null;
      location = null;
      setAiming(false);
      element.hidden = true;
    },
  };
}
