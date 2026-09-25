/**
 * Button icons from Lucide. Each icon is imported by name so the bundle only
 * carries the ones used; the SVG strokes with currentColor, so an icon takes
 * the button's text colour in either colour scheme.
 */
import { createElement, type IconNode } from 'lucide';

export { Funnel, Info, Layers, List, LocateFixed, MapPin, X } from 'lucide';

function icon(node: IconNode): SVGElement {
  const svg = createElement(node, { class: 'icon', 'stroke-width': 2 });
  // Decorative: the button's own text or aria-label names it.
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  return svg;
}

/** Icon followed by a visible label; call again to change the label. */
export function setIconLabel(button: HTMLElement, node: IconNode, label: string): void {
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
