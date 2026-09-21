/**
 * Keeps the top bar on screen when the browser is pinched.
 *
 * A fixed element is fixed to the layout viewport. Once a phone browser
 * zooms, the visual viewport pans inside the layout one and fixed chrome
 * slides out of sight, with no way to bring it back: the body does not
 * scroll, so there is nothing for the reader to scroll. Safari also restores
 * the scale on the next load of the same address, so the bar can be missing
 * from the first paint and stay missing.
 *
 * The bar is therefore re-anchored to the visual viewport: moved by its
 * offset and scaled by the inverse of its scale, which leaves it the same
 * size on the glass at any zoom.
 */

/** The parts of VisualViewport this module reads. */
export interface ViewportMetrics {
  readonly offsetLeft: number;
  readonly offsetTop: number;
  readonly scale: number;
}

/**
 * The transform that puts a top-anchored element back in view, or an empty
 * string when the viewport is untransformed and the element should be left
 * exactly as the stylesheet placed it.
 */
export function chromeTransform(metrics: ViewportMetrics): string {
  const { offsetLeft, offsetTop, scale } = metrics;
  if (!Number.isFinite(scale) || scale <= 0) {
    return '';
  }
  const settled = scale === 1 && offsetLeft === 0 && offsetTop === 0;
  if (settled) {
    return '';
  }
  return `translate(${offsetLeft}px, ${offsetTop}px) scale(${1 / scale})`;
}

/**
 * Follow the visual viewport for as long as the page lives. A browser
 * without the API keeps the plain fixed position, which is correct there:
 * without zoom the two viewports are the same.
 */
export function pinToVisualViewport(element: HTMLElement): void {
  const viewport = window.visualViewport;
  if (viewport === null || viewport === undefined) {
    return;
  }

  element.style.transformOrigin = 'top left';
  const sync = (): void => {
    element.style.transform = chromeTransform(viewport);
  };

  viewport.addEventListener('resize', sync);
  viewport.addEventListener('scroll', sync);
  sync();
}
