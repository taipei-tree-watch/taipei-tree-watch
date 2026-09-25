/**
 * The filter panel: a collapsible sheet on phones, a side column from 768px up.
 *
 * Options are generated from shared/tags.ts, so a new tag appears here without
 * any edit to this file. Filtering itself lives in filters.ts; the panel only
 * collects the selection and hands over a FilterState.
 */
import { causes, dispositions, evidence } from '../../../shared/tags.ts';
import type { Tag } from '../../../shared/tags.ts';
import type { FilterState } from '../filters.ts';
import { NO_CAUSE_CODE, emptyFilterState } from '../filters.ts';
import { formatTemplate } from '../format.ts';
import { bucketColorVar, bucketForCause } from '../map/colors.ts';
import { setIconOnly, X } from '../icons.ts';
import strings from '../ui-strings.json';

export interface FilterPanel {
  getState(): FilterState;
  setSummary(shown: number, total: number, trees: number): void;
  setOpen(open: boolean): void;
  isOpen(): boolean;
  /** Fires whoever opened or closed it, including its own close button. */
  onOpenChange(listener: (open: boolean) => void): () => void;
}

interface Selection {
  causes: Set<number>;
  dispositions: Set<number>;
  evidence: Set<number>;
  observedFrom: string | null;
  observedTo: string | null;
}

/**
 * Swatch colour for a cause option, so the legend and the map agree. A custom
 * property rather than a resolved colour: the swatch then follows the colour
 * scheme on its own, with no repaint from here.
 */
function swatchColor(code: number): string {
  if (code === NO_CAUSE_CODE) {
    return bucketColorVar('none');
  }
  return bucketColorVar(bucketForCause(code) ?? 'none');
}

function createCheckbox(
  name: string,
  code: number,
  label: string,
  color: string | null,
  onChange: () => void,
  selected: Set<number>,
): HTMLLabelElement {
  const wrapper = document.createElement('label');
  wrapper.className = 'filter-option';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.name = name;
  input.value = String(code);
  input.addEventListener('change', () => {
    if (input.checked) {
      selected.add(code);
    } else {
      selected.delete(code);
    }
    onChange();
  });
  wrapper.append(input);

  if (color !== null) {
    const swatch = document.createElement('span');
    swatch.className = 'filter-swatch';
    swatch.style.backgroundColor = color;
    wrapper.append(swatch);
  }

  const caption = document.createElement('span');
  caption.textContent = label;
  wrapper.append(caption);

  return wrapper;
}

function createGroup(
  title: string,
  name: string,
  options: readonly { code: number; label: string }[],
  selected: Set<number>,
  withSwatch: boolean,
  onChange: () => void,
): HTMLElement {
  const group = document.createElement('fieldset');
  group.className = 'filter-group';

  const legend = document.createElement('legend');
  legend.textContent = title;
  group.append(legend);

  const list = document.createElement('div');
  list.className = 'filter-options';
  for (const option of options) {
    list.append(
      createCheckbox(
        name,
        option.code,
        option.label,
        withSwatch ? swatchColor(option.code) : null,
        onChange,
        selected,
      ),
    );
  }
  group.append(list);
  return group;
}

function toOptions(tags: readonly Tag[]): { code: number; label: string }[] {
  return tags.map((tag) => ({ code: tag.code, label: tag.label }));
}

export function createFilterPanel(
  element: HTMLElement,
  onChange: (state: FilterState) => void,
): FilterPanel {
  const selection: Selection = {
    causes: new Set(),
    dispositions: new Set(),
    evidence: new Set(),
    observedFrom: null,
    observedTo: null,
  };

  const readState = (): FilterState => ({
    causes: new Set(selection.causes),
    dispositions: new Set(selection.dispositions),
    evidence: new Set(selection.evidence),
    observedFrom: selection.observedFrom,
    observedTo: selection.observedTo,
  });

  const notify = (): void => {
    onChange(readState());
  };

  const header = document.createElement('div');
  header.className = 'panel-header';

  const title = document.createElement('h2');
  title.textContent = strings.filters.title;
  header.append(title);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'panel-close';
  setIconOnly(close, X, strings.filters.close);
  header.append(close);

  const summary = document.createElement('p');
  summary.className = 'filter-summary';

  const body = document.createElement('div');
  body.className = 'panel-body';

  // "No cause recorded" leads the cause group: those reports are a signal of
  // their own, not leftovers, so they must be selectable on their own.
  const causeOptions = [
    { code: NO_CAUSE_CODE, label: strings.filters.noCause },
    ...toOptions(causes),
  ];

  body.append(
    createGroup(strings.filters.causes, 'cause', causeOptions, selection.causes, true, notify),
    createGroup(
      strings.filters.dispositions,
      'disposition',
      toOptions(dispositions),
      selection.dispositions,
      false,
      notify,
    ),
    createGroup(
      strings.filters.evidence,
      'evidence',
      toOptions(evidence),
      selection.evidence,
      false,
      notify,
    ),
  );

  const dateGroup = document.createElement('fieldset');
  dateGroup.className = 'filter-group';
  const dateLegend = document.createElement('legend');
  dateLegend.textContent = strings.filters.observed;
  dateGroup.append(dateLegend);

  const dateRow = document.createElement('div');
  dateRow.className = 'filter-dates';

  const fromInput = document.createElement('input');
  fromInput.type = 'date';
  const fromLabel = document.createElement('label');
  fromLabel.className = 'filter-date';
  const fromCaption = document.createElement('span');
  fromCaption.textContent = strings.filters.observedFrom;
  fromLabel.append(fromCaption, fromInput);

  const toInput = document.createElement('input');
  toInput.type = 'date';
  const toLabel = document.createElement('label');
  toLabel.className = 'filter-date';
  const toCaption = document.createElement('span');
  toCaption.textContent = strings.filters.observedTo;
  toLabel.append(toCaption, toInput);

  fromInput.addEventListener('change', () => {
    selection.observedFrom = fromInput.value === '' ? null : fromInput.value;
    notify();
  });
  toInput.addEventListener('change', () => {
    selection.observedTo = toInput.value === '' ? null : toInput.value;
    notify();
  });

  dateRow.append(fromLabel, toLabel);
  dateGroup.append(dateRow);

  const dateHint = document.createElement('p');
  dateHint.className = 'filter-hint';
  dateHint.textContent = strings.filters.observedHint;
  dateGroup.append(dateHint);
  body.append(dateGroup);

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'filter-reset';
  reset.textContent = strings.filters.reset;
  reset.addEventListener('click', () => {
    const cleared = emptyFilterState();
    selection.causes = new Set(cleared.causes);
    selection.dispositions = new Set(cleared.dispositions);
    selection.evidence = new Set(cleared.evidence);
    selection.observedFrom = null;
    selection.observedTo = null;
    fromInput.value = '';
    toInput.value = '';
    for (const input of element.querySelectorAll('input[type=checkbox]')) {
      (input as HTMLInputElement).checked = false;
    }
    notify();
  });
  body.append(reset);

  element.replaceChildren(header, summary, body);

  const listeners = new Set<(open: boolean) => void>();
  const setOpen = (open: boolean): void => {
    element.hidden = !open;
    for (const listener of listeners) {
      listener(open);
    }
  };

  // The panel's own close button goes through the same path as the top bar
  // toggle, so the toggle cannot be left looking pressed over a shut panel.
  close.addEventListener('click', () => {
    setOpen(false);
  });

  return {
    getState: readState,
    setSummary(shown, total, trees) {
      const reportLine = document.createElement('span');
      reportLine.textContent = formatTemplate(strings.filters.reportSummary, { shown, total });
      const treeLine = document.createElement('span');
      treeLine.textContent = formatTemplate(strings.filters.treeSummary, { count: trees });
      summary.replaceChildren(reportLine, treeLine);
    },
    setOpen(open) {
      setOpen(open);
    },
    onOpenChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isOpen() {
      return !element.hidden;
    },
  };
}
