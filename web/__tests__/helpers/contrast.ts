/**
 * WCAG 2.1 relative luminance and contrast ratio, for the token tests.
 *
 * Only opaque six digit hex colours are supported, which is every colour the
 * token tests compare: the translucent tokens are halos and shadows, not text.
 */

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const digits = /^#([0-9a-f]{6})$/i.exec(hex.trim())?.[1];
  if (digits === undefined) {
    throw new Error(`not an opaque hex colour: ${hex}`);
  }
  const value = Number.parseInt(digits, 16);
  return (
    0.2126 * channel((value >> 16) & 0xff) +
    0.7152 * channel((value >> 8) & 0xff) +
    0.0722 * channel(value & 0xff)
  );
}

export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** CIE L*a*b* coordinates under D65, the space the distance below is measured in. */
function lab(hex: string): readonly [number, number, number] {
  const digits = /^#([0-9a-f]{6})$/i.exec(hex.trim())?.[1];
  if (digits === undefined) {
    throw new Error(`not an opaque hex colour: ${hex}`);
  }
  const value = Number.parseInt(digits, 16);
  const red = channel((value >> 16) & 0xff);
  const green = channel((value >> 8) & 0xff);
  const blue = channel(value & 0xff);

  const x = (red * 0.4124 + green * 0.3576 + blue * 0.1805) / 0.95047;
  const y = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const z = (red * 0.0193 + green * 0.1192 + blue * 0.9505) / 1.08883;

  const f = (t: number): number => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference. Roughly: below 10 is a shade, above 20 reads as another colour. */
export function colorDistance(a: string, b: string): number {
  const first = lab(a);
  const second = lab(b);
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
}

/** Closest pair among the colours, by CIE76 distance. */
export function minColorDistance(colors: readonly string[]): number {
  let smallest = Number.POSITIVE_INFINITY;
  for (const [index, first] of colors.entries()) {
    for (const second of colors.slice(index + 1)) {
      smallest = Math.min(smallest, colorDistance(first, second));
    }
  }
  return smallest;
}
