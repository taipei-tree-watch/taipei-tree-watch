/**
 * Field builders shared by the report form and the correction panel, so a
 * field reads and behaves the same wherever it appears.
 */
import type { Tag } from '../../../shared/tags.ts';
import strings from '../ui-strings.json';

export function labelled(
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
export function hintCounter(hint: HTMLElement): HTMLElement {
  const counter = document.createElement('span');
  counter.className = 'form-counter';
  hint.append(' ', counter);
  return counter;
}

export function tagGroup(
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
