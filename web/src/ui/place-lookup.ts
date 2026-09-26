/**
 * The place lookup behind the "find place" map button.
 *
 * A popover beside the floating map buttons takes a pasted position or a
 * protected tree number and flies the map there, the same way the locate
 * button does. It works whether or not a report is being aimed: the report
 * form reads the map centre live, so it follows along.
 */
import type { Bbox } from '../../../shared/validation.ts';
import type { ProtectedTree } from '../data/trees.ts';
import { Search, setIconOnly } from '../icons.ts';
import { formatTemplate } from '../format.ts';
import type { Coordinates } from '../report/coordinates.ts';
import { bboxCentre } from '../report/coordinates.ts';
import type { LookupOutcome } from '../report/lookup.ts';
import { LOOKUP_ZOOM, lookupPlace, parseLookupQuery } from '../report/lookup.ts';
import strings from '../ui-strings.json';

export interface PlaceLookupOptions {
  /** Accepted coordinate range, mirroring the Worker's BBOX var. */
  readonly bbox: Bbox;
  /** Protected trees loaded so far; empty until trees.json arrives. */
  readonly getTrees: () => readonly ProtectedTree[];
  /** Move the camera, never closer than `zoom`. */
  readonly moveTo: (point: Coordinates, zoom: number) => void;
}

export interface PlaceLookup {
  isOpen(): boolean;
  setOpen(open: boolean): void;
  /** Hide the button and fold the panel, for while the map must stay put. */
  setAvailable(available: boolean): void;
}

function message(outcome: LookupOutcome): string {
  switch (outcome.kind) {
    case 'point':
      return strings.lookup.point;
    case 'pointOutside':
      return strings.lookup.pointOutside;
    case 'tree':
      return formatTemplate(strings.lookup.tree, {
        id: outcome.tree.id,
        species: outcome.tree.species ?? strings.form.nearbyUnknownSpecies,
      });
    case 'treeMissing':
      return formatTemplate(strings.lookup.treeMissing, { id: outcome.id });
    case 'treesUnavailable':
      return strings.lookup.treesUnavailable;
    case 'unrecognised':
      return strings.lookup.unrecognised;
  }
}

export function createPlaceLookup(
  button: HTMLButtonElement,
  panel: HTMLElement,
  options: PlaceLookupOptions,
): PlaceLookup {
  const form = document.createElement('form');
  form.className = 'place-lookup-form';
  form.setAttribute('role', 'search');
  form.noValidate = true;

  const label = document.createElement('label');
  label.className = 'form-label';
  label.htmlFor = 'place-lookup-input';
  label.textContent = strings.lookup.label;

  const input = document.createElement('input');
  input.type = 'search';
  input.id = 'place-lookup-input';
  input.enterKeyHint = 'search';
  input.autocomplete = 'off';
  input.placeholder = strings.lookup.placeholder;

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'form-secondary';
  setIconOnly(submit, Search, strings.lookup.submit);

  const row = document.createElement('div');
  row.className = 'form-lookup-row';
  row.append(input, submit);

  const hint = document.createElement('p');
  hint.className = 'form-hint';
  hint.textContent = strings.lookup.hint;

  const status = document.createElement('p');
  status.className = 'form-hint';
  status.setAttribute('role', 'status');
  status.hidden = true;

  form.append(label, row, hint, status);
  panel.replaceChildren(form);

  button.setAttribute('aria-controls', panel.id);

  function setOpen(open: boolean): void {
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      input.focus();
    } else {
      status.hidden = true;
    }
  }

  setOpen(false);

  button.addEventListener('click', () => {
    setOpen(button.getAttribute('aria-expanded') !== 'true');
  });

  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
      button.focus();
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const query = parseLookupQuery(input.value, bboxCentre(options.bbox));
    if (query === null) {
      return;
    }
    const trees = options.getTrees();
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
    status.hidden = false;
    status.textContent = message(outcome);
  });

  return {
    isOpen: () => !panel.hidden,
    setOpen,
    setAvailable(available) {
      button.hidden = !available;
      if (!available) {
        setOpen(false);
      }
    },
  };
}
