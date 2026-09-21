/**
 * The report form inside the bottom sheet, and the crosshair picker it sits on.
 *
 * Two modes share one point. In `picking` the sheet collapses to a bar so the
 * crosshair stays visible while the map is dragged; in `form` the fields are
 * shown. The point is always the map centre, read live, so moving the map at
 * any moment updates the coordinates, the submit gate and the nearby
 * protected tree question.
 *
 * Every rule enforced here is also enforced by the Worker. This layer exists
 * to show the reporter what is wrong before a request is made, never to
 * decide what is accepted.
 */
import {
  causes as causeTags,
  dispositions as dispositionTags,
  evidence as evidenceTags,
} from '../../../shared/tags.ts';
import type { EvidenceCode, Tag } from '../../../shared/tags.ts';
import type { Bbox } from '../../../shared/validation.ts';
import {
  NOTE_MAX_CHARS,
  SPECIES_MAX_CHARS,
  countCharacters,
  stripUrls,
  taipeiDate,
} from '../../../shared/validation.ts';
import { sections } from '../content/index.ts';
import type { ReportRecord } from '../data/snapshot.ts';
import type { ProtectedTree } from '../data/trees.ts';
import { formatTemplate } from '../format.ts';
import type { Nearby } from '../geo.ts';
import {
  NEARBY_REPORT_RADIUS_M,
  PROTECTED_TREE_RADIUS_M,
  nearestWithin,
} from '../geo.ts';
import type { DraftIssue, PickedView, ReportDraft } from '../report/draft.ts';
import {
  MIN_SUBMIT_ZOOM,
  buildRequestBody,
  causesAllowed,
  draftIssues,
  emptyDraft,
  linkFeedback,
  submitBlock,
  withEvidence,
} from '../report/draft.ts';
import type { FormField } from '../report/errors.ts';
import type { PendingReport, StorageLike } from '../report/pending.ts';
import { toReportRecord } from '../report/pending.ts';
import { dismissSafety, isSafetyDismissed } from '../report/safety.ts';
import { reportRows } from './report-rows.ts';
import type { FetchLike } from '../report/submit.ts';
import { submitReport } from '../report/submit.ts';
import type { TurnstileWidget } from '../turnstile.ts';
import { renderTurnstile } from '../turnstile.ts';
import strings from '../ui-strings.json';

export type PickerMode = 'picking' | 'form';

export interface ReportFormOptions {
  readonly getView: () => PickedView;
  /** Accepted coordinate range, mirroring the Worker's BBOX var. */
  readonly bbox: Bbox;
  /** Move the map to the device location; rejects when it is unavailable. */
  readonly locate: () => Promise<void>;
  readonly onPendingReport: (report: PendingReport) => void;
  readonly onModeChange: (mode: PickerMode) => void;
  readonly fetchImpl: FetchLike;
  readonly now: () => Date;
  /** Holds the safety notice acknowledgement, one entry per browser. */
  readonly storage: StorageLike;
}

export interface ReportForm {
  setTrees(trees: readonly ProtectedTree[]): void;
  /** Reports already on the map, used only for the nearby notice. */
  setReports(reports: readonly ReportRecord[]): void;
  /** Called on every camera move while the sheet is open. */
  update(): void;
  /** Sheet opened or closed. */
  setActive(active: boolean): void;
}

/** Coordinates are shown at the precision they are stored at. */
const COORD_DIGITS = 5;

function labelled(
  labelText: string,
  control: HTMLElement,
  hintText: string,
  optional: boolean,
): { row: HTMLElement; error: HTMLElement } {
  const row = document.createElement('div');
  row.className = 'form-row';

  const label = document.createElement('label');
  label.className = 'form-label';
  label.append(document.createTextNode(labelText));
  if (optional) {
    const badge = document.createElement('span');
    badge.className = 'form-optional';
    badge.textContent = strings.form.optional;
    label.append(badge);
  }
  label.append(control);
  row.append(label);

  const hint = document.createElement('p');
  hint.className = 'form-hint';
  hint.textContent = hintText;
  row.append(hint);

  const error = document.createElement('p');
  error.className = 'form-error';
  error.hidden = true;
  row.append(error);

  return { row, error };
}

function tagGroup(
  legendText: string,
  hintText: string,
  tags: readonly Tag[],
  name: string,
  onChange: (code: number, checked: boolean) => void,
): { group: HTMLElement; options: HTMLElement; inputs: HTMLInputElement[]; error: HTMLElement } {
  const group = document.createElement('fieldset');
  group.className = 'form-group';

  const legend = document.createElement('legend');
  legend.textContent = legendText;
  group.append(legend);

  const hint = document.createElement('p');
  hint.className = 'form-hint';
  hint.textContent = hintText;
  group.append(hint);

  const options = document.createElement('div');
  options.className = 'form-options';
  const inputs: HTMLInputElement[] = [];

  for (const tag of tags) {
    const wrapper = document.createElement('label');
    wrapper.className = 'form-option';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.name = name;
    input.value = String(tag.code);
    input.addEventListener('change', () => {
      onChange(tag.code, input.checked);
    });
    inputs.push(input);

    const caption = document.createElement('span');
    caption.textContent = tag.label;
    wrapper.append(input, caption);
    options.append(wrapper);
  }
  group.append(options);

  const error = document.createElement('p');
  error.className = 'form-error';
  error.hidden = true;
  group.append(error);

  return { group, options, inputs, error };
}

/**
 * The safety notice, with the button that puts it away.
 *
 * Acknowledging it hides the whole section and records that in storage, so a
 * returning reporter goes straight to the fields. Where storage is refused
 * the notice simply comes back on the next visit.
 */
function safetySection(storage: StorageLike): HTMLElement {
  const section = document.createElement('section');
  section.className = 'form-safety';

  const safety = sections.find((entry) => entry.id === 'safety');
  if (safety === undefined) {
    return section;
  }

  const heading = document.createElement('h3');
  heading.textContent = safety.title;
  section.append(heading);

  // A build time fragment from web/src/content, never user input.
  const body = document.createElement('div');
  body.className = 'section-body';
  body.innerHTML = safety.html;
  section.append(body);

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'form-secondary';
  dismiss.textContent = strings.form.safetyDismiss;
  dismiss.addEventListener('click', () => {
    section.hidden = true;
    dismissSafety(storage);
  });
  section.append(dismiss);

  section.hidden = isSafetyDismissed(storage);

  return section;
}

export function createReportForm(
  container: HTMLElement,
  options: ReportFormOptions,
): ReportForm {
  let draft: ReportDraft = emptyDraft();
  let mode: PickerMode = 'picking';
  let trees: readonly ProtectedTree[] = [];
  let knownReports: readonly ReportRecord[] = [];
  let nearby: Nearby<ProtectedTree> | null = null;
  let widget: TurnstileWidget | null = null;
  let widgetPending = false;
  let submitting = false;
  let submitted = false;
  let apiErrors: ReadonlyMap<FormField, string> = new Map();
  let generalError: string | null = null;
  /**
   * The challenge has no draft field behind it, so its message is held here
   * rather than written straight to the DOM: render() rebuilds every error
   * slot from state and would otherwise clear it on the next keystroke.
   */
  let turnstileMessage: string | null = null;

  const errorSlots = new Map<FormField, HTMLElement>();

  /* Picker ---------------------------------------------------------------- */

  const picker = document.createElement('div');
  picker.className = 'form-picker';

  const pickerTitle = document.createElement('h3');
  pickerTitle.textContent = strings.form.positionTitle;

  const pickerHint = document.createElement('p');
  pickerHint.className = 'form-hint';
  pickerHint.textContent = strings.form.positionHint;

  const coordLine = document.createElement('p');
  coordLine.className = 'form-coords';

  const zoomLine = document.createElement('p');
  zoomLine.className = 'form-hint';

  const gateLine = document.createElement('p');
  gateLine.className = 'form-gate';

  const locateButton = document.createElement('button');
  locateButton.type = 'button';
  locateButton.className = 'form-secondary';
  locateButton.textContent = strings.form.locate;

  const modeButton = document.createElement('button');
  modeButton.type = 'button';
  modeButton.className = 'form-secondary';

  const pickerActions = document.createElement('div');
  pickerActions.className = 'form-picker-actions';
  pickerActions.append(locateButton, modeButton);

  const locateStatus = document.createElement('p');
  locateStatus.className = 'form-hint';
  locateStatus.hidden = true;

  const nearbyBox = document.createElement('div');
  nearbyBox.className = 'form-nearby';
  nearbyBox.hidden = true;

  const nearbyQuestion = document.createElement('p');
  nearbyQuestion.className = 'form-nearby-question';
  const nearbyDistance = document.createElement('p');
  nearbyDistance.className = 'form-hint';
  const nearbyConfirm = document.createElement('button');
  nearbyConfirm.type = 'button';
  nearbyConfirm.className = 'form-secondary';
  nearbyConfirm.textContent = strings.form.nearbyConfirm;
  const nearbyClear = document.createElement('button');
  nearbyClear.type = 'button';
  nearbyClear.className = 'form-secondary';
  nearbyClear.textContent = strings.form.nearbyClear;
  const nearbyActions = document.createElement('div');
  nearbyActions.className = 'form-picker-actions';
  nearbyActions.append(nearbyConfirm, nearbyClear);
  nearbyBox.append(nearbyQuestion, nearbyDistance, nearbyActions);

  /**
   * Says that this spot has been reported before. It is a note, not a
   * question: several reports of one tree are three reports, never merged,
   * so there is nothing here for the reporter to confirm or undo.
   */
  const nearbyReport = document.createElement('p');
  nearbyReport.className = 'form-notice';
  nearbyReport.hidden = true;

  picker.append(
    pickerTitle,
    pickerHint,
    coordLine,
    zoomLine,
    gateLine,
    pickerActions,
    locateStatus,
    nearbyBox,
    nearbyReport,
  );

  /* Form ------------------------------------------------------------------ */

  const form = document.createElement('form');
  form.className = 'form-fields';
  form.noValidate = true;
  form.hidden = true;

  form.append(safetySection(options.storage));

  const speciesInput = document.createElement('input');
  speciesInput.type = 'text';
  speciesInput.maxLength = SPECIES_MAX_CHARS;
  speciesInput.autocomplete = 'off';
  const speciesRow = labelled(
    strings.form.species,
    speciesInput,
    strings.form.speciesHint,
    true,
  );
  errorSlots.set('species', speciesRow.error);
  form.append(speciesRow.row);

  const evidenceGroup = document.createElement('fieldset');
  evidenceGroup.className = 'form-group';
  const evidenceLegend = document.createElement('legend');
  evidenceLegend.textContent = strings.form.evidence;
  evidenceGroup.append(evidenceLegend);
  const evidenceHint = document.createElement('p');
  evidenceHint.className = 'form-hint';
  evidenceHint.textContent = strings.form.evidenceHint;
  evidenceGroup.append(evidenceHint);
  const evidenceOptions = document.createElement('div');
  evidenceOptions.className = 'form-options';
  const evidenceInputs: HTMLInputElement[] = [];
  for (const tag of evidenceTags) {
    const wrapper = document.createElement('label');
    wrapper.className = 'form-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'report-evidence';
    input.value = String(tag.code);
    input.checked = tag.code === draft.evidence;
    input.addEventListener('change', () => {
      if (!input.checked) {
        return;
      }
      draft = withEvidence(draft, tag.code as EvidenceCode);
      clearFieldError('evidence');
      clearFieldError('causes');
      syncCauseInputs();
      render();
    });
    evidenceInputs.push(input);
    const caption = document.createElement('span');
    caption.textContent = tag.label;
    wrapper.append(input, caption);
    evidenceOptions.append(wrapper);
  }
  evidenceGroup.append(evidenceOptions);
  const evidenceError = document.createElement('p');
  evidenceError.className = 'form-error';
  evidenceError.hidden = true;
  evidenceGroup.append(evidenceError);
  errorSlots.set('evidence', evidenceError);
  form.append(evidenceGroup);

  const causeBlock = tagGroup(
    strings.form.causes,
    strings.form.causesHint,
    causeTags,
    'report-cause',
    (code, checked) => {
      draft = { ...draft, causes: toggleCode(draft.causes, code, checked) };
      clearFieldError('causes');
    },
  );
  const causesLocked = document.createElement('p');
  causesLocked.className = 'form-locked';
  causesLocked.textContent = strings.form.causesLocked;
  causesLocked.hidden = true;
  causeBlock.group.insertBefore(causesLocked, causeBlock.options);
  errorSlots.set('causes', causeBlock.error);
  form.append(causeBlock.group);

  const dispositionBlock = tagGroup(
    strings.form.dispositions,
    strings.form.dispositionsHint,
    dispositionTags,
    'report-disposition',
    (code, checked) => {
      draft = { ...draft, dispositions: toggleCode(draft.dispositions, code, checked) };
      clearFieldError('dispositions');
    },
  );
  errorSlots.set('dispositions', dispositionBlock.error);
  form.append(dispositionBlock.group);

  const noteInput = document.createElement('textarea');
  noteInput.rows = 4;
  const noteRow = labelled(strings.form.note, noteInput, strings.form.noteHint, true);
  const noteCounter = document.createElement('p');
  noteCounter.className = 'form-hint form-counter';
  noteRow.row.insertBefore(noteCounter, noteRow.error);
  const noteStripped = document.createElement('p');
  noteStripped.className = 'form-notice';
  noteStripped.textContent = strings.form.noteStripped;
  noteStripped.hidden = true;
  noteRow.row.insertBefore(noteStripped, noteRow.error);
  errorSlots.set('note', noteRow.error);
  form.append(noteRow.row);

  const linkInput = document.createElement('input');
  linkInput.type = 'url';
  linkInput.inputMode = 'url';
  linkInput.autocomplete = 'off';
  const linkRow = labelled(strings.form.link, linkInput, strings.form.linkHint, true);
  const linkDomain = document.createElement('p');
  linkDomain.className = 'form-hint';
  linkDomain.hidden = true;
  linkRow.row.insertBefore(linkDomain, linkRow.error);
  errorSlots.set('link', linkRow.error);
  form.append(linkRow.row);

  const observedInput = document.createElement('input');
  observedInput.type = 'date';
  const observedRow = labelled(
    strings.form.observedAt,
    observedInput,
    strings.form.observedAtHint,
    true,
  );
  errorSlots.set('observed_at', observedRow.error);
  form.append(observedRow.row);

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
  form.append(protectedRow.row);

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
  form.append(inventoryRow.row);

  const turnstileBox = document.createElement('div');
  turnstileBox.className = 'form-turnstile';
  form.append(turnstileBox);

  const turnstileError = document.createElement('p');
  turnstileError.className = 'form-error';
  turnstileError.hidden = true;
  errorSlots.set('turnstile_token', turnstileError);
  form.append(turnstileError);

  const submitButton = document.createElement('button');
  submitButton.type = 'submit';
  submitButton.className = 'form-submit';
  submitButton.textContent = strings.form.submit;
  form.append(submitButton);

  const resultLine = document.createElement('p');
  resultLine.className = 'form-result';
  resultLine.hidden = true;
  resultLine.setAttribute('role', 'status');
  form.append(resultLine);

  /**
   * What replaces the form once a report is in.
   *
   * The confirmation used to be a line under a form several screens long,
   * where it went unread. The form is put away instead and the report is
   * shown back, in the same rows the map card uses, so the reporter can see
   * that what arrived is what they meant.
   */
  const successPanel = document.createElement('section');
  successPanel.className = 'form-success';
  successPanel.hidden = true;

  const successMessage = document.createElement('p');
  successMessage.className = 'form-result';
  successMessage.dataset.tone = 'ok';
  successMessage.setAttribute('role', 'status');
  successMessage.textContent = strings.form.success;

  const successBody = document.createElement('div');
  successBody.className = 'form-success-body';

  const againButton = document.createElement('button');
  againButton.type = 'button';
  againButton.className = 'form-secondary';
  againButton.textContent = strings.form.successAgain;

  successPanel.append(successMessage, successBody, againButton);

  container.replaceChildren(picker, form, successPanel);

  /* Behaviour ------------------------------------------------------------- */

  function toggleCode(current: readonly number[], code: number, checked: boolean): number[] {
    const next = current.filter((entry) => entry !== code);
    if (checked) {
      next.push(code);
    }
    return next;
  }

  function clearFieldError(field: FormField): void {
    if (!apiErrors.has(field)) {
      return;
    }
    const next = new Map(apiErrors);
    next.delete(field);
    apiErrors = next;
    const slot = errorSlots.get(field);
    if (slot !== undefined) {
      slot.hidden = true;
    }
  }

  function syncCauseInputs(): void {
    const allowed = causesAllowed(draft.evidence);
    for (const input of causeBlock.inputs) {
      const code = Number(input.value);
      input.checked = allowed && draft.causes.includes(code);
      input.disabled = !allowed;
    }
    causeBlock.options.hidden = !allowed;
    causesLocked.hidden = allowed;
  }

  function showIssue(field: FormField, message: string | null): void {
    const slot = errorSlots.get(field);
    if (slot === undefined) {
      return;
    }
    if (message === null) {
      slot.hidden = true;
      return;
    }
    slot.textContent = message;
    slot.hidden = false;
  }

  function issueMessages(): Map<FormField, string> {
    const today = taipeiDate(options.now());
    const messages = new Map<FormField, string>();
    for (const issue of draftIssues(draft, today) as readonly DraftIssue[]) {
      messages.set(issue.field as FormField, strings.form.issues[issue.code]);
    }
    return messages;
  }

  function setMode(next: PickerMode): void {
    mode = next;
    form.hidden = next !== 'form';
    modeButton.textContent = next === 'form' ? strings.form.toPicking : strings.form.toForm;
    container.dataset.mode = next;
    options.onModeChange(next);
    if (next === 'form') {
      void ensureWidget();
    }
  }

  async function ensureWidget(): Promise<void> {
    if (widget !== null || widgetPending) {
      return;
    }
    widgetPending = true;
    try {
      widget = await renderTurnstile(turnstileBox);
      turnstileMessage = null;
    } catch (error) {
      console.error('turnstile failed to render', error);
      turnstileMessage = strings.form.errors.turnstileLoad;
    } finally {
      widgetPending = false;
      render();
    }
  }

  function renderNearbyReport(view: PickedView): void {
    const found = nearestWithin(knownReports, view, NEARBY_REPORT_RADIUS_M);
    if (found === null) {
      nearbyReport.hidden = true;
      return;
    }
    nearbyReport.hidden = false;
    nearbyReport.textContent = formatTemplate(strings.form.nearbyReport, {
      distance: found.distanceM.toFixed(0),
    });
  }

  function renderNearby(view: PickedView): void {
    renderNearbyReport(view);
    nearby = nearestWithin(trees, view, PROTECTED_TREE_RADIUS_M);
    const linked = draft.protectedTreeId !== '';

    if (linked) {
      nearbyBox.hidden = false;
      nearbyQuestion.textContent = formatTemplate(strings.form.nearbyLinked, {
        id: draft.protectedTreeId,
      });
      nearbyDistance.hidden = true;
      nearbyConfirm.hidden = true;
      nearbyClear.hidden = false;
      return;
    }

    if (nearby === null) {
      nearbyBox.hidden = true;
      return;
    }

    nearbyBox.hidden = false;
    nearbyQuestion.textContent = formatTemplate(strings.form.nearbyQuestion, {
      id: nearby.item.id,
      species: nearby.item.species ?? strings.form.nearbyUnknownSpecies,
    });
    nearbyDistance.hidden = false;
    nearbyDistance.textContent = formatTemplate(strings.form.nearbyDistance, {
      distance: nearby.distanceM.toFixed(0),
    });
    nearbyConfirm.hidden = false;
    nearbyClear.hidden = true;
  }

  function render(): void {
    const view = options.getView();

    coordLine.textContent = formatTemplate(strings.form.coords, {
      lat: view.lat.toFixed(COORD_DIGITS),
      lng: view.lng.toFixed(COORD_DIGITS),
    });
    zoomLine.textContent = formatTemplate(strings.form.zoomLevel, {
      zoom: view.zoom.toFixed(1),
      min: MIN_SUBMIT_ZOOM,
    });

    const block = submitBlock(view, options.bbox);
    if (block === 'zoom') {
      gateLine.textContent = strings.form.blockedZoom;
    } else if (block === 'bbox') {
      gateLine.textContent = strings.form.blockedBbox;
    } else {
      gateLine.textContent = strings.form.positionReady;
    }
    gateLine.dataset.tone = block === null ? 'ok' : 'blocked';

    renderNearby(view);
    syncCauseInputs();

    const issues = issueMessages();
    for (const field of errorSlots.keys()) {
      if (field === 'turnstile_token') {
        showIssue(field, turnstileMessage);
        continue;
      }
      const apiMessage = apiErrors.get(field);
      if (apiMessage !== undefined) {
        showIssue(field, strings.form.errors[field]);
        continue;
      }
      showIssue(field, issues.get(field) ?? null);
    }

    if (generalError === null) {
      resultLine.hidden = true;
    } else {
      resultLine.hidden = false;
      resultLine.dataset.tone = 'error';
      resultLine.textContent = generalError;
    }

    submitButton.disabled = block !== null || issues.size > 0 || submitting || submitted;
    submitButton.textContent = submitting ? strings.form.submitting : strings.form.submit;
  }

  /* Field wiring ---------------------------------------------------------- */

  speciesInput.addEventListener('input', () => {
    draft = { ...draft, species: speciesInput.value };
    clearFieldError('species');
    render();
  });

  function renderNoteCounter(): void {
    const stripped = stripUrls(noteInput.value);
    noteCounter.textContent = formatTemplate(strings.form.noteCounter, {
      count: countCharacters(stripped),
      max: NOTE_MAX_CHARS,
    });
  }

  function applyNoteStrip(): void {
    const stripped = stripUrls(noteInput.value);
    if (stripped === noteInput.value) {
      return;
    }
    noteInput.value = stripped;
    draft = { ...draft, note: stripped };
    noteStripped.hidden = false;
  }

  noteInput.addEventListener('input', (event) => {
    draft = { ...draft, note: noteInput.value };
    clearFieldError('note');
    // A pasted or dropped link is stripped at once. Typed text is only
    // flagged, because stripping mid-word would eat the characters as the
    // reporter types them; it is stripped on blur and again on submit.
    const inputType = (event as InputEvent).inputType;
    if (inputType === 'insertFromPaste' || inputType === 'insertFromDrop') {
      applyNoteStrip();
    } else {
      noteStripped.hidden = stripUrls(noteInput.value) === noteInput.value;
    }
    renderNoteCounter();
    render();
  });

  noteInput.addEventListener('blur', () => {
    applyNoteStrip();
    renderNoteCounter();
    render();
  });

  linkInput.addEventListener('input', () => {
    draft = { ...draft, link: linkInput.value };
    clearFieldError('link');
    // Only an accepted domain is named here. A rejected one is stated once,
    // by the field error slot, which render() fills from the draft issue or
    // from the server's answer.
    const feedback = linkFeedback(linkInput.value);
    if (feedback.kind === 'accepted') {
      linkDomain.hidden = false;
      linkDomain.dataset.tone = 'ok';
      linkDomain.textContent = formatTemplate(strings.form.linkDomainOk, {
        domain: feedback.domain,
      });
    } else {
      linkDomain.hidden = true;
    }
    render();
  });

  observedInput.addEventListener('change', () => {
    draft = { ...draft, observedAt: observedInput.value };
    clearFieldError('observed_at');
    render();
  });

  protectedInput.addEventListener('input', () => {
    draft = { ...draft, protectedTreeId: protectedInput.value };
    clearFieldError('protected_tree_id');
    render();
  });

  inventoryInput.addEventListener('input', () => {
    draft = { ...draft, inventoryTreeId: inventoryInput.value };
    clearFieldError('inventory_tree_id');
    render();
  });

  nearbyConfirm.addEventListener('click', () => {
    if (nearby === null) {
      return;
    }
    draft = { ...draft, protectedTreeId: nearby.item.id };
    protectedInput.value = nearby.item.id;
    if (draft.species === '' && nearby.item.species !== null) {
      draft = { ...draft, species: nearby.item.species };
      speciesInput.value = nearby.item.species;
    }
    render();
  });

  nearbyClear.addEventListener('click', () => {
    draft = { ...draft, protectedTreeId: '' };
    protectedInput.value = '';
    render();
  });

  modeButton.addEventListener('click', () => {
    setMode(mode === 'form' ? 'picking' : 'form');
    render();
  });

  function runLocate(): void {
    locateStatus.hidden = false;
    locateStatus.textContent = strings.form.locating;
    locateButton.disabled = true;
    options
      .locate()
      .then(() => {
        locateStatus.hidden = true;
      })
      .catch(() => {
        // A refusal is not an error worth stopping for: the reporter aims the
        // crosshair by hand, which is the accurate path anyway.
        locateStatus.textContent = strings.form.locateFailed;
      })
      .finally(() => {
        locateButton.disabled = false;
        render();
      });
  }

  locateButton.addEventListener('click', runLocate);

  againButton.addEventListener('click', () => {
    resetForm();
    setMode('picking');
    render();
  });

  function showSuccess(entry: PendingReport): void {
    successBody.replaceChildren(...reportRows(toReportRecord(entry)));
    successPanel.hidden = false;
    picker.hidden = true;
    form.hidden = true;
    // The sheet is the scrolling element, and the form it replaces was
    // taller than the screen.
    container.scrollTop = 0;
  }

  function hideSuccess(): void {
    successPanel.hidden = true;
    successBody.replaceChildren();
    picker.hidden = false;
  }

  function resetForm(): void {
    draft = emptyDraft();
    apiErrors = new Map();
    generalError = null;
    turnstileMessage = null;
    submitted = false;
    speciesInput.value = '';
    noteInput.value = '';
    linkInput.value = '';
    observedInput.value = '';
    protectedInput.value = '';
    inventoryInput.value = '';
    linkDomain.hidden = true;
    noteStripped.hidden = true;
    resultLine.hidden = true;
    hideSuccess();
    for (const input of causeBlock.inputs) {
      input.checked = false;
    }
    for (const input of dispositionBlock.inputs) {
      input.checked = false;
    }
    for (const input of evidenceInputs) {
      input.checked = Number(input.value) === draft.evidence;
    }
    widget?.reset();
    renderNoteCounter();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void send();
  });

  async function send(): Promise<void> {
    if (submitting || submitted) {
      return;
    }

    applyNoteStrip();
    renderNoteCounter();

    const view = options.getView();
    if (submitBlock(view, options.bbox) !== null) {
      render();
      return;
    }

    const token = widget?.getToken() ?? '';
    if (token === '') {
      turnstileMessage = strings.form.errors.turnstileMissing;
      render();
      return;
    }

    submitting = true;
    generalError = null;
    turnstileMessage = null;
    render();

    const body = buildRequestBody(draft, view, token);
    const outcome = await submitReport(body, options.fetchImpl);
    submitting = false;

    if (outcome.kind === 'created') {
      submitted = true;
      widget?.reset();
      const entry: PendingReport = {
        id: outcome.id,
        lat: body.lat as number,
        lng: body.lng as number,
        species: body.species as string | null,
        causes: body.causes as number[],
        dispositions: body.dispositions as number[],
        evidence: body.evidence as number,
        note: body.note as string | null,
        link: body.link as string | null,
        observedAt: body.observed_at as string | null,
        protectedTreeId: body.protected_tree_id as string | null,
        inventoryTreeId: body.inventory_tree_id as string | null,
        submittedAt: options.now().toISOString(),
      };
      options.onPendingReport(entry);
      showSuccess(entry);
      render();
      return;
    }

    if (outcome.kind === 'turnstile') {
      widget?.reset();
      turnstileMessage = strings.form.errors.turnstile_token;
      render();
      return;
    }

    if (outcome.kind === 'rejected') {
      apiErrors = outcome.errors.byField;
      generalError =
        outcome.errors.general.length > 0 ? strings.form.errors.general : null;
      if (apiErrors.has('turnstile_token')) {
        turnstileMessage = strings.form.errors.turnstile_token;
      }
      widget?.reset();
      render();
      return;
    }

    generalError = strings.form.errors.network;
    widget?.reset();
    render();
  }

  /* Initial state --------------------------------------------------------- */

  observedInput.max = taipeiDate(options.now());
  renderNoteCounter();
  setMode('picking');
  render();

  return {
    setTrees(next) {
      trees = next;
      render();
    },
    setReports(next) {
      knownReports = next;
      render();
    },
    update() {
      render();
    },
    setActive(active) {
      if (!active) {
        return;
      }
      observedInput.max = taipeiDate(options.now());
      setMode('picking');
      render();
    },
  };
}
