/**
 * The fixed crosshair the reporter aims with.
 *
 * It sits at the geometric centre of the map element, which is the point the
 * map controller reports as the centre. Any other position would show one
 * place and submit another.
 */

export interface Crosshair {
  setVisible(visible: boolean): void;
}

export function createCrosshair(parent: HTMLElement): Crosshair {
  const element = document.createElement('div');
  element.className = 'crosshair';
  element.setAttribute('aria-hidden', 'true');
  element.hidden = true;

  const ring = document.createElement('span');
  ring.className = 'crosshair-ring';
  const dot = document.createElement('span');
  dot.className = 'crosshair-dot';
  element.append(ring, dot);

  parent.append(element);

  return {
    setVisible(visible) {
      element.hidden = !visible;
    },
  };
}
