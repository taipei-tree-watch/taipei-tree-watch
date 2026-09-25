/**
 * The report form inside the bottom sheet, and the crosshair picker it sits on.
 *
 * Two modes share one point. In `picking` the sheet collapses to a bar so the
 * crosshair stays visible while the map is dragged, and the point is the map
 * centre, read live, so every move updates the coordinates, the submit gate,
 * the nearby protected tree question and the nearby report check. Moving on
 * to `form` locks the point where it is and shows the fields; going back to
 * `picking` releases it.
 *
 * The same form edits an existing report when an edit link is opened: the
 * fields are filled from the Worker's copy, the point starts on the stored
 * location, submitting sends a PUT, and a withdraw button appears. A new
 * report's confirmation hands over its edit link.
 *
 * Every rule enforced here is also enforced by the Worker. This layer exists
 * to show the reporter what is wrong before a request is made, never to
 * decide what is accepted.
 */
import { LINK_DOMAINS } from '../../../shared/domains.ts';
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
import type { EditLink } from '../permalink.ts';
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
import type { EditableReport } from '../report/edit.ts';
import { saveReport, withdrawReport } from '../report/edit.ts';
import type { FormField } from '../report/errors.ts';
import type { Coordinates } from '../report/coordinates.ts';
import { bboxCentre } from '../report/coordinates.ts';
import type { LookupOutcome } from '../report/lookup.ts';
import { LOOKUP_ZOOM, lookupPlace, parseLookupQuery } from '../report/lookup.ts';
import { readGuideOpen, writeGuideOpen } from '../report/guide.ts';
import type { PendingReport, StorageLike } from '../report/pending.ts';
import { toReportRecord } from '../report/pending.ts';
import { dismissSafety, isSafetyDismissed } from '../report/safety.ts';
import type { SameTreeCheck } from '../report/same-tree.ts';
import { prefillFromReport, sameTreeStage } from '../report/same-tree.ts';
import { reportRows } from './report-rows.ts';
import type { FetchLike } from '../report/submit.ts';
import { submitReport } from '../report/submit.ts';
import type { ShareOutcome } from '../share.ts';
import type { TurnstileWidget } from '../turnstile.ts';
import { renderTurnstile } from '../turnstile.ts';
import { Info, setIconOnly } from '../icons.ts';
import strings from '../ui-strings.json';

export type PickerMode = 'picking' | 'form';

export interface ReportFormOptions {
  readonly getView: () => PickedView;
  /** Accepted coordinate range, mirroring the Worker's BBOX var. */
  readonly bbox: Bbox;
  /** Move the map to the device location; rejects when it is unavailable. */
  readonly locate: () => Promise<void>;
  /** Move the camera to a looked-up place, never closer than `zoom`. */
  readonly moveTo: (point: Coordinates, zoom: number) => void;
  readonly onPendingReport: (report: PendingReport) => void;
  readonly onModeChange: (mode: PickerMode) => void;
  /** The reporter found their tree already reported as it is: close the sheet. */
  readonly onDismiss: () => void;
  readonly fetchImpl: FetchLike;
  readonly now: () => Date;
  /** Holds the safety acknowledgement and the instructions state, per browser. */
  readonly storage: StorageLike;
  /** Keep an edit link in this browser, with what the list shows for it. */
  readonly onEditLink: (link: EditLink, report: PendingReport) => void;
  /** The Worker no longer honours this report's link, or it was withdrawn. */
  readonly onEditLinkGone: (id: string) => void;
  /** Editing started or ended, so the sheet can retitle itself. */
  readonly onEditingChange: (editing: boolean) => void;
  readonly editLinkUrl: (link: EditLink) => string;
  readonly share: (url: string, title: string) => Promise<ShareOutcome>;
  /** window.confirm in the page; a test answers for the reader. */
  readonly confirm: (message: string) => boolean;
  readonly feedbackMs?: number;
  /**
   * Whether the aiming instructions start unfolded when this browser has no
   * remembered choice; defaults to true.
   */
  readonly guideOpen?: boolean;
}

export interface ReportForm {
  /** Folds the aiming instructions; the caller places it in the sheet header. */
  readonly guideToggle: HTMLElement;
  /** Unfolds the position lookup; the caller places it in the sheet header. */
  readonly lookupToggle: HTMLElement;
  setTrees(trees: readonly ProtectedTree[]): void;
  /** Reports already on the map, used only for the nearby report check. */
  setReports(reports: readonly ReportRecord[]): void;
  /** Called on every camera move while the sheet is open. */
  update(): void;
  /** Sheet opened or closed. */
  setActive(active: boolean): void;
  /**
   * Link the report to this protected tree, as the nearby confirm button does,
   * whether or not the crosshair is on it yet.
   */
  linkTree(tree: ProtectedTree): void;
  /**
   * Fill the form from a report the link opened. The caller has already moved
   * the map so the crosshair sits on the stored point.
   */
  startEdit(link: EditLink, report: EditableReport): void;
  /**
   * Blank fields for a new report after an edit or a finished report. A draft
   * still being filled in is left as it is.
   */
  startCreate(): void;
  isEditing(): boolean;
}

/** How long a copied confirmation stays beside the edit link. */
export const EDIT_LINK_FEEDBACK_MS = 4000;

/** The form's draft for a report read back from the Worker. */
export function draftFromReport(report: EditableReport): ReportDraft {
  return {
    species: report.species ?? '',
    causes: [...report.causes],
    dispositions: [...report.dispositions],
    evidence: report.evidence,
    note: report.note ?? '',
    link: report.link ?? '',
    observedAt: report.observed_at ?? '',
    protectedTreeId: report.protected_tree_id ?? '',
    inventoryTreeId: report.inventory_tree_id ?? '',
  };
}

/** What this browser records locally after a request the Worker accepted. */
export function pendingFromBody(
  id: string,
  body: Record<string, unknown>,
  submittedAt: string,
  change: { readonly updatedAt: string; readonly withdrawn: boolean } | null,
): PendingReport {
  return {
    id,
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
    submittedAt,
    updatedAt: change?.updatedAt ?? null,
    withdrawn: change?.withdrawn ?? false,
  };
}

/** Coordinates are shown at the precision they are stored at. */
const COORD_DIGITS = 5;

function labelled(
  labelText: string,
  control: HTMLElement,
  hintText: string,
  optional: boolean,
): { row: HTMLElement; hint: HTMLElement; error: HTMLElement } {
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

  return { row, hint, error };
}

/** Live character count appended to the end of a field's hint line. */
function hintCounter(hint: HTMLElement): HTMLElement {
  const counter = document.createElement('span');
  counter.className = 'form-counter';
  hint.append(' ', counter);
  return counter;
}

/**
 * Info button for the link hint and the popover it opens, which lists every
 * accepted domain. The popover sits in the top layer, so the scrolling sheet
 * cannot clip it, and closes on Esc or a tap outside.
 */
function linkDomainsInfo(): { button: HTMLButtonElement; popover: HTMLElement } {
  const popover = document.createElement('div');
  popover.id = 'form-link-domains';
  popover.className = 'form-popover';
  popover.popover = 'auto';

  const title = document.createElement('p');
  title.className = 'form-popover-title';
  title.textContent = strings.form.linkDomainsTitle;

  const list = document.createElement('ul');
  list.className = 'form-popover-list';
  for (const domain of LINK_DOMAINS) {
    const item = document.createElement('li');
    item.textContent = domain;
    list.append(item);
  }

  const note = document.createElement('p');
  note.className = 'form-hint';
  note.textContent = strings.form.linkDomainsNote;

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'chip';
  close.textContent = strings.form.linkDomainsClose;
  close.popoverTargetElement = popover;
  close.popoverTargetAction = 'hide';

  popover.append(title, list, note, close);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'form-info';
  setIconOnly(button, Info, strings.form.linkDomainsInfo);
  button.popoverTargetElement = popover;

  return { button, popover };
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
  /**
   * The point taken when the reporter moved on to the fields. From then on the
   * form reads this rather than the live map centre, so nothing that moves
   * the map can move the report; only going back to aiming releases it.
   */
  let lockedView: PickedView | null = null;
  let trees: readonly ProtectedTree[] = [];
  let knownReports: readonly ReportRecord[] = [];
  let nearby: Nearby<ProtectedTree> | null = null;
  let nearbyReportFound: Nearby<ReportRecord> | null = null;
  let sameTree: SameTreeCheck | null = null;
  /** The report whose rows are in the box, so a camera move does not rebuild them. */
  let shownReportId: string | null = null;
  let widget: TurnstileWidget | null = null;
  let widgetPending = false;
  let submitting = false;
  let submitted = false;
  /** The link being edited; null while writing a new report. */
  let editing: EditLink | null = null;
  let withdrawing = false;
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

  /**
   * The instructions fold away behind a toggle that the caller mounts in the
   * sheet header. Folded, the sheet stays short and the map around the
   * crosshair stays large; the gate line below still says when the view is
   * not good enough. The last choice is remembered per browser.
   */
  const pickerGuide = document.createElement('div');
  pickerGuide.className = 'form-picker-guide';
  pickerGuide.id = 'form-picker-guide';

  const guideToggle = document.createElement('button');
  guideToggle.type = 'button';
  guideToggle.className = 'chip';
  guideToggle.textContent = strings.form.guideToggle;
  guideToggle.setAttribute('aria-controls', pickerGuide.id);

  function setGuideOpen(open: boolean): void {
    pickerGuide.hidden = !open;
    guideToggle.setAttribute('aria-expanded', String(open));
  }

  setGuideOpen(readGuideOpen(options.storage) ?? options.guideOpen ?? true);

  guideToggle.addEventListener('click', () => {
    const open = guideToggle.getAttribute('aria-expanded') !== 'true';
    setGuideOpen(open);
    writeGuideOpen(options.storage, open);
  });

  const pickerHint = document.createElement('p');
  pickerHint.className = 'form-hint';
  pickerHint.textContent = strings.form.positionHint;

  const lookupForm = document.createElement('form');
  lookupForm.className = 'form-lookup';
  lookupForm.id = 'form-lookup';
  lookupForm.setAttribute('role', 'search');
  lookupForm.noValidate = true;

  const lookupLabel = document.createElement('label');
  lookupLabel.className = 'form-label';
  lookupLabel.htmlFor = 'report-lookup';
  lookupLabel.textContent = strings.form.lookupLabel;

  const lookupInput = document.createElement('input');
  lookupInput.type = 'search';
  lookupInput.id = 'report-lookup';
  lookupInput.enterKeyHint = 'search';
  lookupInput.autocomplete = 'off';
  lookupInput.placeholder = strings.form.lookupPlaceholder;

  const lookupButton = document.createElement('button');
  lookupButton.type = 'submit';
  lookupButton.className = 'form-secondary';
  lookupButton.textContent = strings.form.lookupSubmit;

  const lookupRow = document.createElement('div');
  lookupRow.className = 'form-lookup-row';
  lookupRow.append(lookupInput, lookupButton);

  const lookupHint = document.createElement('p');
  lookupHint.className = 'form-hint';
  lookupHint.textContent = strings.form.lookupHint;

  const lookupStatus = document.createElement('p');
  lookupStatus.className = 'form-hint';
  lookupStatus.setAttribute('role', 'status');
  lookupStatus.hidden = true;

  lookupForm.append(lookupLabel, lookupRow, lookupHint, lookupStatus);

  const lookupToggle = document.createElement('button');
  lookupToggle.type = 'button';
  lookupToggle.className = 'chip';
  lookupToggle.textContent = strings.form.lookupToggle;
  lookupToggle.setAttribute('aria-controls', lookupForm.id);

  /**
   * The lookup is a detour most reporters never take, so it starts folded
   * every time the sheet opens rather than remembering the last choice.
   */
  function setLookupOpen(open: boolean): void {
    lookupForm.hidden = !open;
    lookupToggle.setAttribute('aria-expanded', String(open));
    if (open) {
      lookupInput.focus();
    } else {
      lookupStatus.hidden = true;
    }
  }

  setLookupOpen(false);

  lookupToggle.addEventListener('click', () => {
    setLookupOpen(lookupToggle.getAttribute('aria-expanded') !== 'true');
  });

  const coordLine = document.createElement('p');
  coordLine.className = 'form-coords';

  const zoomLine = document.createElement('p');
  zoomLine.className = 'form-hint';

  pickerGuide.append(pickerHint, zoomLine);

  const gateLine = document.createElement('p');
  gateLine.className = 'form-gate';

  const locateButton = document.createElement('button');
  locateButton.type = 'button';
  locateButton.className = 'form-secondary';
  locateButton.textContent = strings.map.locate;

  const modeButton = document.createElement('button');
  modeButton.type = 'button';
  modeButton.className = 'form-secondary';

  const pickerActions = document.createElement('div');
  pickerActions.className = 'form-picker-actions';
  pickerActions.append(locateButton, modeButton);

  const locateStatus = document.createElement('p');
  locateStatus.className = 'form-hint';
  locateStatus.hidden = true;

  /**
   * While aiming, what is nearby is only named in this line: the boxes below
   * carry rows and buttons that would cover much of the map. They open once
   * the point is locked, which is when their questions can be answered.
   */
  const nearbyHint = document.createElement('p');
  nearbyHint.className = 'form-hint form-nearby-hint';
  nearbyHint.hidden = true;

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
   * Shows the report already filed near the crosshair and asks whether it is
   * the same tree. Several reports of one tree stay separate reports, so a
   * yes only decides whether this reporter has anything new to add.
   */
  const nearbyReport = document.createElement('div');
  nearbyReport.className = 'form-nearby';
  nearbyReport.hidden = true;
  const nearbyReportTitle = document.createElement('p');
  nearbyReportTitle.className = 'form-nearby-question';
  const nearbyReportDistance = document.createElement('p');
  nearbyReportDistance.className = 'form-hint';
  const nearbyReportRows = document.createElement('div');
  nearbyReportRows.className = 'form-nearby-rows';
  const nearbyReportQuestion = document.createElement('p');
  nearbyReportQuestion.className = 'form-nearby-question';

  function secondaryButton(label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'form-secondary';
    button.textContent = label;
    return button;
  }

  const sameButton = secondaryButton(strings.form.nearbyReportSame);
  const differentButton = secondaryButton(strings.form.nearbyReportDifferent);
  const updateButton = secondaryButton(strings.form.nearbyReportUpdate);
  const unchangedButton = secondaryButton(strings.form.nearbyReportUnchanged);
  const recheckButton = secondaryButton(strings.form.nearbyReportRecheck);
  const nearbyReportActions = document.createElement('div');
  nearbyReportActions.className = 'form-picker-actions';
  nearbyReportActions.append(
    sameButton,
    differentButton,
    updateButton,
    unchangedButton,
    recheckButton,
  );
  nearbyReport.append(
    nearbyReportTitle,
    nearbyReportDistance,
    nearbyReportRows,
    nearbyReportQuestion,
    nearbyReportActions,
  );

  picker.append(
    pickerGuide,
    lookupForm,
    coordLine,
    gateLine,
    nearbyHint,
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
  const speciesCounter = hintCounter(speciesRow.hint);
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
  const noteCounter = hintCounter(noteRow.hint);
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
  const linkDomainsPopover = linkDomainsInfo();
  linkRow.hint.append(' ', linkDomainsPopover.button);
  linkRow.row.append(linkDomainsPopover.popover);
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

  // Only in edit mode. Kept apart from the submit button and styled as a
  // warning, because it cannot be undone from the link.
  const withdrawButton = document.createElement('button');
  withdrawButton.type = 'button';
  withdrawButton.className = 'form-secondary form-withdraw';
  withdrawButton.hidden = true;
  form.append(withdrawButton);

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

  /**
   * The edit link of a report just created. This is the only moment the
   * token exists anywhere but in this browser's storage, so it is shown with
   * what it grants and where it is kept.
   */
  const editLinkBox = document.createElement('section');
  editLinkBox.className = 'form-edit-link';
  editLinkBox.hidden = true;

  const editLinkTitle = document.createElement('h3');
  editLinkTitle.textContent = strings.form.editLinkTitle;
  const editLinkHint = document.createElement('p');
  editLinkHint.className = 'form-hint';
  editLinkHint.textContent = strings.form.editLinkHint;
  const editLinkCopy = document.createElement('button');
  editLinkCopy.type = 'button';
  editLinkCopy.className = 'form-secondary';
  editLinkCopy.textContent = strings.form.editLinkCopy;
  const editLinkFeedback = document.createElement('p');
  editLinkFeedback.className = 'card-share-feedback';
  editLinkFeedback.hidden = true;
  const editLinkUrl = document.createElement('p');
  editLinkUrl.className = 'card-share-url';
  editLinkUrl.hidden = true;
  editLinkBox.append(editLinkTitle, editLinkHint, editLinkCopy, editLinkFeedback, editLinkUrl);

  successPanel.append(successMessage, successBody, editLinkBox, againButton);

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
    causeBlock.group.hidden = !allowed;
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

  function currentView(): PickedView {
    return lockedView ?? options.getView();
  }

  function setMode(next: PickerMode): void {
    mode = next;
    // A point already locked (an edit's stored location) survives re-entry.
    lockedView = next === 'form' ? (lockedView ?? options.getView()) : null;
    locateButton.hidden = next === 'form';
    // The lookup moves the map, which the locked point does not allow.
    lookupToggle.hidden = next === 'form';
    if (next === 'form') {
      setLookupOpen(false);
    }
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
    // The report being edited sits under the crosshair; it is not a
    // neighbour to compare against.
    const others =
      editing === null ? knownReports : knownReports.filter((report) => report.id !== editing?.id);
    nearbyReportFound = nearestWithin(others, view, NEARBY_REPORT_RADIUS_M);
    const found = nearbyReportFound;
    const stage = sameTreeStage(found?.item.id ?? null, sameTree);
    if (found === null || stage === 'none') {
      nearbyReport.hidden = true;
      shownReportId = null;
      return;
    }
    nearbyReport.hidden = false;

    const distance = found.distanceM.toFixed(0);
    const settled = stage === 'different' || stage === 'update';
    if (stage === 'different') {
      nearbyReportTitle.textContent = strings.form.nearbyReportDifferentNote;
    } else if (stage === 'update') {
      nearbyReportTitle.textContent = strings.form.nearbyReportUpdateNote;
    } else {
      nearbyReportTitle.textContent = strings.form.nearbyReportTitle;
    }
    nearbyReportDistance.hidden = settled;
    nearbyReportDistance.textContent = formatTemplate(strings.form.nearbyReport, { distance });

    // Once answered the rows fold away; the question is what they were for.
    nearbyReportRows.hidden = settled;
    if (!settled && shownReportId !== found.item.id) {
      nearbyReportRows.replaceChildren(...reportRows(found.item));
      shownReportId = found.item.id;
    }

    nearbyReportQuestion.hidden = settled;
    nearbyReportQuestion.textContent =
      stage === 'same' ? strings.form.nearbyReportChanged : strings.form.nearbyReportAsk;

    sameButton.hidden = stage !== 'ask';
    differentButton.hidden = stage !== 'ask';
    updateButton.hidden = stage !== 'same';
    unchangedButton.hidden = stage !== 'same';
    recheckButton.hidden = !settled && stage !== 'same';
  }

  function renderNearby(view: PickedView): void {
    renderNearbyBoxes(view);

    const picking = mode === 'picking';
    const parts: string[] = [];
    if (draft.protectedTreeId !== '') {
      parts.push(formatTemplate(strings.form.nearbyHintLinked, { id: draft.protectedTreeId }));
    } else if (nearby !== null) {
      parts.push(
        formatTemplate(strings.form.nearbyHintTree, {
          id: nearby.item.id,
          distance: nearby.distanceM.toFixed(0),
        }),
      );
    }
    if (nearbyReportFound !== null) {
      parts.push(
        formatTemplate(strings.form.nearbyHintReport, {
          distance: nearbyReportFound.distanceM.toFixed(0),
        }),
      );
    }
    nearbyHint.textContent = parts.join(strings.form.nearbyHintSeparator);
    nearbyHint.hidden = !picking || parts.length === 0;
    if (picking) {
      nearbyBox.hidden = true;
      nearbyReport.hidden = true;
    }
  }

  function renderNearbyBoxes(view: PickedView): void {
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
    const view = currentView();

    coordLine.textContent = formatTemplate(strings.form.coords, {
      lat: view.lat.toFixed(COORD_DIGITS),
      lng: view.lng.toFixed(COORD_DIGITS),
    });
    zoomLine.textContent = formatTemplate(strings.form.zoomLevel, {
      zoom: view.zoom.toFixed(1),
      min: MIN_SUBMIT_ZOOM,
    });

    const block = submitBlock(view, options.bbox);
    // Only a problem is worth a line; a usable point needs no confirmation.
    gateLine.hidden = block === null;
    if (block === 'zoom') {
      gateLine.textContent = strings.form.blockedZoom;
    } else if (block === 'bbox') {
      gateLine.textContent = strings.form.blockedBbox;
    }
    // The point locks on the way to the fields, so a view that could never be
    // submitted is not allowed to become the locked one.
    modeButton.disabled = mode === 'picking' && block !== null;

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

    const busy = submitting || withdrawing;
    submitButton.disabled = block !== null || issues.size > 0 || busy || submitted;
    if (editing === null) {
      submitButton.textContent = submitting ? strings.form.submitting : strings.form.submit;
    } else {
      submitButton.textContent = submitting
        ? strings.form.submittingEdit
        : strings.form.submitEdit;
    }
    withdrawButton.hidden = editing === null;
    withdrawButton.disabled = busy || submitted;
    withdrawButton.textContent = withdrawing ? strings.form.withdrawing : strings.form.withdraw;
  }

  /* Field wiring ---------------------------------------------------------- */

  speciesInput.addEventListener('input', () => {
    draft = { ...draft, species: speciesInput.value };
    clearFieldError('species');
    renderCounters();
    render();
  });

  function renderCounters(): void {
    speciesCounter.textContent = formatTemplate(strings.form.charCounter, {
      count: countCharacters(speciesInput.value),
      max: SPECIES_MAX_CHARS,
    });
    noteCounter.textContent = formatTemplate(strings.form.charCounter, {
      count: countCharacters(stripUrls(noteInput.value)),
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
    renderCounters();
    render();
  });

  noteInput.addEventListener('blur', () => {
    applyNoteStrip();
    renderCounters();
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

  /** Link a protected tree and borrow its species when none is typed yet. */
  function linkTree(tree: ProtectedTree): void {
    draft = { ...draft, protectedTreeId: tree.id };
    protectedInput.value = tree.id;
    if (draft.species === '' && tree.species !== null) {
      draft = { ...draft, species: tree.species };
      speciesInput.value = tree.species;
      renderCounters();
    }
    render();
  }

  nearbyConfirm.addEventListener('click', () => {
    if (nearby !== null) {
      linkTree(nearby.item);
    }
  });

  function answerSameTree(answer: SameTreeCheck['answer']): void {
    if (nearbyReportFound === null) {
      return;
    }
    sameTree = { reportId: nearbyReportFound.item.id, answer };
  }

  sameButton.addEventListener('click', () => {
    answerSameTree('same');
    render();
  });

  differentButton.addEventListener('click', () => {
    answerSameTree('different');
    render();
  });

  recheckButton.addEventListener('click', () => {
    sameTree = null;
    render();
  });

  updateButton.addEventListener('click', () => {
    if (nearbyReportFound === null) {
      return;
    }
    answerSameTree('update');
    draft = prefillFromReport(draft, nearbyReportFound.item);
    speciesInput.value = draft.species;
    protectedInput.value = draft.protectedTreeId;
    inventoryInput.value = draft.inventoryTreeId;
    renderCounters();
    setMode('form');
    render();
  });

  // Nothing is being reported, so nothing typed or carried over is kept.
  unchangedButton.addEventListener('click', () => {
    resetForm();
    options.onDismiss();
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
    locateStatus.textContent = strings.map.locating;
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

  function lookupMessage(outcome: LookupOutcome): string {
    switch (outcome.kind) {
      case 'point':
        return strings.form.lookupPoint;
      case 'pointOutside':
        return strings.form.lookupPointOutside;
      case 'tree':
        return formatTemplate(strings.form.lookupTree, {
          id: outcome.tree.id,
          species: outcome.tree.species ?? strings.form.nearbyUnknownSpecies,
        });
      case 'treeMissing':
        return formatTemplate(strings.form.lookupTreeMissing, { id: outcome.id });
      case 'treesUnavailable':
        return strings.form.lookupTreesUnavailable;
      case 'unrecognised':
        return strings.form.lookupUnrecognised;
    }
  }

  function runLookup(): void {
    const query = parseLookupQuery(lookupInput.value, bboxCentre(options.bbox));
    if (query === null) {
      return;
    }
    const outcome = lookupPlace(query, {
      bbox: options.bbox,
      findTree: (id) => trees.find((tree) => tree.id === id),
      treesLoaded: trees.length > 0,
    });
    if (outcome.kind === 'point') {
      options.moveTo(outcome, LOOKUP_ZOOM);
    } else if (outcome.kind === 'tree') {
      options.moveTo(outcome.tree, LOOKUP_ZOOM);
    }
    lookupStatus.hidden = false;
    lookupStatus.textContent = lookupMessage(outcome);
    render();
  }

  lookupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runLookup();
  });

  againButton.addEventListener('click', () => {
    resetForm();
    setMode('picking');
    render();
  });

  let shownEditLink: string | null = null;
  let editLinkTimer: ReturnType<typeof setTimeout> | null = null;

  function clearEditLinkFeedback(): void {
    if (editLinkTimer !== null) {
      clearTimeout(editLinkTimer);
      editLinkTimer = null;
    }
    editLinkFeedback.hidden = true;
    editLinkUrl.hidden = true;
    editLinkUrl.textContent = '';
  }

  editLinkCopy.addEventListener('click', () => {
    const url = shownEditLink;
    if (url === null) {
      return;
    }
    clearEditLinkFeedback();
    void options.share(url, strings.app.title).then((outcome) => {
      if (outcome === 'copied') {
        editLinkFeedback.hidden = false;
        editLinkFeedback.textContent = strings.form.editLinkCopied;
        editLinkTimer = setTimeout(
          clearEditLinkFeedback,
          options.feedbackMs ?? EDIT_LINK_FEEDBACK_MS,
        );
      } else if (outcome === 'manual') {
        editLinkFeedback.hidden = false;
        editLinkFeedback.textContent = strings.form.editLinkManual;
        editLinkUrl.hidden = false;
        editLinkUrl.textContent = url;
      }
    });
  });

  type SuccessKind = 'created' | 'edited' | 'withdrawn';

  function showSuccess(entry: PendingReport, kind: SuccessKind, link: EditLink | null): void {
    successMessage.textContent =
      kind === 'created'
        ? strings.form.success
        : kind === 'edited'
          ? strings.form.editSuccess
          : strings.form.withdrawn;
    successBody.replaceChildren(
      ...(kind === 'withdrawn' ? [] : reportRows(toReportRecord(entry))),
    );
    clearEditLinkFeedback();
    shownEditLink = kind === 'created' && link !== null ? options.editLinkUrl(link) : null;
    editLinkBox.hidden = shownEditLink === null;
    successPanel.hidden = false;
    picker.hidden = true;
    guideToggle.hidden = true;
    lookupToggle.hidden = true;
    form.hidden = true;
    // The sheet is the scrolling element, and the form it replaces was
    // taller than the screen.
    container.scrollTop = 0;
  }

  function hideSuccess(): void {
    successPanel.hidden = true;
    successBody.replaceChildren();
    shownEditLink = null;
    editLinkBox.hidden = true;
    clearEditLinkFeedback();
    picker.hidden = false;
    guideToggle.hidden = false;
    lookupToggle.hidden = mode === 'form';
  }

  function setEditing(next: EditLink | null): void {
    const changed = (editing === null) !== (next === null);
    editing = next;
    if (changed) {
      options.onEditingChange(next !== null);
    }
  }

  /** Put a draft's values into every control, as if the reader had typed them. */
  function fillControls(): void {
    speciesInput.value = draft.species;
    noteInput.value = draft.note;
    linkInput.value = draft.link;
    observedInput.value = draft.observedAt;
    protectedInput.value = draft.protectedTreeId;
    inventoryInput.value = draft.inventoryTreeId;
    for (const input of causeBlock.inputs) {
      input.checked = draft.causes.includes(Number(input.value));
    }
    for (const input of dispositionBlock.inputs) {
      input.checked = draft.dispositions.includes(Number(input.value));
    }
    for (const input of evidenceInputs) {
      input.checked = Number(input.value) === draft.evidence;
    }
    const feedback = linkFeedback(draft.link);
    linkDomain.hidden = feedback.kind !== 'accepted';
    if (feedback.kind === 'accepted') {
      linkDomain.dataset.tone = 'ok';
      linkDomain.textContent = formatTemplate(strings.form.linkDomainOk, {
        domain: feedback.domain,
      });
    }
    noteStripped.hidden = true;
    renderCounters();
  }

  function resetForm(): void {
    setEditing(null);
    withdrawing = false;
    draft = emptyDraft();
    sameTree = null;
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
    lookupInput.value = '';
    lookupStatus.hidden = true;
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
    renderCounters();
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
    renderCounters();

    const view = currentView();
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
    const target = editing;
    const outcome =
      target === null
        ? await submitReport(body, options.fetchImpl)
        : await saveReport(target, body, options.fetchImpl);
    submitting = false;

    if (outcome.kind === 'created') {
      submitted = true;
      widget?.reset();
      const entry = pendingFromBody(outcome.id, body, options.now().toISOString(), null);
      const link = { id: outcome.id, token: outcome.editToken };
      options.onPendingReport(entry);
      options.onEditLink(link, entry);
      showSuccess(entry, 'created', link);
      render();
      return;
    }

    if (outcome.kind === 'saved' && target !== null) {
      submitted = true;
      widget?.reset();
      const entry = pendingFromBody(target.id, body, options.now().toISOString(), {
        updatedAt: outcome.updatedAt,
        withdrawn: false,
      });
      options.onPendingReport(entry);
      options.onEditLink(target, entry);
      showSuccess(entry, 'edited', null);
      render();
      return;
    }

    if (outcome.kind === 'missing' && target !== null) {
      options.onEditLinkGone(target.id);
      generalError = strings.form.errors.missing;
      widget?.reset();
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

  async function withdraw(): Promise<void> {
    const target = editing;
    if (target === null || withdrawing || submitting || submitted) {
      return;
    }
    if (!options.confirm(strings.form.withdrawConfirm)) {
      return;
    }
    withdrawing = true;
    generalError = null;
    render();

    const outcome = await withdrawReport(target, options.fetchImpl);
    withdrawing = false;

    if (outcome.kind === 'withdrawn') {
      submitted = true;
      const body = buildRequestBody(draft, options.getView(), '');
      const entry = pendingFromBody(target.id, body, options.now().toISOString(), {
        updatedAt: outcome.updatedAt,
        withdrawn: true,
      });
      options.onPendingReport(entry);
      options.onEditLinkGone(target.id);
      showSuccess(entry, 'withdrawn', null);
      render();
      return;
    }

    if (outcome.kind === 'missing') {
      options.onEditLinkGone(target.id);
      generalError = strings.form.errors.missing;
    } else {
      generalError = strings.form.errors.withdraw;
    }
    render();
  }

  withdrawButton.addEventListener('click', () => {
    void withdraw();
  });

  /* Initial state --------------------------------------------------------- */

  observedInput.max = taipeiDate(options.now());
  renderCounters();
  setMode('picking');
  render();

  return {
    guideToggle,
    lookupToggle,
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
      sameTree = null;
      setLookupOpen(false);
      // An edit starts on its fields; the reader moves the point on purpose.
      setMode(editing === null ? 'picking' : 'form');
      render();
    },
    startEdit(link, report) {
      resetForm();
      setEditing(link);
      draft = draftFromReport(report);
      fillControls();
      observedInput.max = taipeiDate(options.now());
      // The map may still be flying to the stored point, so the lock takes
      // the point itself rather than wherever the camera is right now.
      lockedView = {
        lat: report.lat,
        lng: report.lng,
        zoom: Math.max(options.getView().zoom, MIN_SUBMIT_ZOOM),
      };
      setMode('form');
      render();
    },
    startCreate() {
      // A draft in progress is kept across closing the sheet; an edit or a
      // finished report is not, so the next report starts from empty fields.
      if (editing === null && successPanel.hidden) {
        return;
      }
      resetForm();
      setMode('picking');
      render();
    },
    isEditing() {
      return editing !== null;
    },
    linkTree,
  };
}
