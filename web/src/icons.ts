/**
 * Button icons from Lucide. Each icon is imported by name so the bundle only
 * carries the ones used; the SVG strokes with currentColor, so an icon takes
 * the button's text colour in either colour scheme.
 */
import { createElement, type IconNode } from 'lucide';

export type { IconNode };

export {
  Check,
  CirclePlus,
  CircleQuestionMark,
  Copy,
  Crosshair,
  Equal,
  Funnel,
  Info,
  Layers,
  Link,
  List,
  LocateFixed,
  MapPin,
  MapPinPlus,
  Pencil,
  RotateCcw,
  Save,
  Search,
  Send,
  Trash,
  Unlink,
  X,
} from 'lucide';

function icon(node: IconNode): SVGElement {
  const svg = createElement(node, { class: 'icon', 'stroke-width': 2 });
  // Decorative: the button's own text or aria-label names it.
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  return svg;
}

/** What each button last showed, so a repeated render leaves the DOM alone. */
const shown = new WeakMap<HTMLElement, { node: IconNode; label: string }>();

/** Icon followed by a visible label; call again to change either. */
export function setIconLabel(button: HTMLElement, node: IconNode, label: string): void {
  const last = shown.get(button);
  if (last?.node === node && last.label === label) {
    return;
  }
  shown.set(button, { node, label });
  const text = document.createElement('span');
  text.textContent = label;
  button.replaceChildren(icon(node), text);
}

/** Icon alone; the label becomes the accessible name and the hover tooltip. */
export function setIconOnly(button: HTMLElement, node: IconNode, label: string): void {
  button.replaceChildren(icon(node));
  button.setAttribute('aria-label', label);
  button.title = label;
}
