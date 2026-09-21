import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MAP_PALETTES } from '../src/map/colors.ts';
import type { ColorScheme } from '../src/theme.ts';
import { contrastRatio, minColorDistance } from './helpers/contrast.ts';

const STYLESHEET = readFileSync(fileURLToPath(new URL('../src/style.css', import.meta.url)), 'utf8');

/** Custom properties of one `:root` block, in source order. */
function tokensOf(block: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const [, name, value] of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    if (name === undefined || value === undefined) {
      continue;
    }
    tokens.set(`--${name}`, value.trim());
  }
  return tokens;
}

function rootBlocks(): { light: Map<string, string>; dark: Map<string, string> } {
  const [lightBlock, darkBlock] = [...STYLESHEET.matchAll(/:root\s*\{([^}]*)\}/g)].map(
    (match) => match[1] ?? '',
  );
  if (lightBlock === undefined || darkBlock === undefined) {
    throw new Error('expected a light :root block and a dark one');
  }
  return { light: tokensOf(lightBlock), dark: tokensOf(darkBlock) };
}

const { light, dark } = rootBlocks();

function colorTokens(tokens: Map<string, string>): Map<string, string> {
  return new Map([...tokens].filter(([, value]) => /^(#|rgb)/.test(value)));
}

function token(scheme: ColorScheme, name: string): string {
  const value = (scheme === 'light' ? light : dark).get(name);
  if (value === undefined) {
    throw new Error(`missing token ${name} in the ${scheme} scheme`);
  }
  return value;
}

/** Text over background pairs the layout actually produces. */
const TEXT_PAIRS: readonly (readonly [string, string, string])[] = [
  ['--ink', '--surface', 'body text on a panel'],
  ['--ink', '--surface-muted', 'body text on a muted strip'],
  ['--ink-muted', '--surface', 'labels and hints on a panel'],
  ['--ink-muted', '--surface-muted', 'the filter summary strip'],
  ['--accent', '--surface', 'links in the information panel'],
  ['--accent-ink', '--accent', 'the report button label'],
  ['--danger', '--surface', 'an error line on a panel'],
  ['--danger', '--surface-muted', 'a blocked gate notice'],
  ['--accent-ink', '--ink', 'a pressed chip'],
];

describe('colour tokens', () => {
  it('defines every colour of the light scheme in the dark scheme too', () => {
    const missing = [...colorTokens(light).keys()].filter((name) => !dark.has(name));

    expect(missing).toEqual([]);
  });

  it('keeps every colour in the token blocks rather than in the rules', () => {
    const rules = STYLESHEET.replace(/:root\s*\{[^}]*\}/g, '');
    const literals = [...rules.matchAll(/#[0-9a-f]{3,8}\b|\brgba?\([^)]*\)/gi)].map(
      (match) => match[0],
    );

    expect(literals).toEqual([]);
  });

  it.each(['light', 'dark'] as const)('clears WCAG AA body text contrast in %s', (scheme) => {
    const measured = TEXT_PAIRS.map(([ink, background, what]) => {
      const ratio = contrastRatio(token(scheme, ink), token(scheme, background));
      return { what, ratio: Number(ratio.toFixed(2)) };
    });

    expect(measured.filter((entry) => entry.ratio < 4.5)).toEqual([]);
  });

  it('mirrors the map bucket palette, so swatches and points agree', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const palette = MAP_PALETTES[scheme].buckets;
      for (const [bucket, color] of Object.entries(palette)) {
        expect(token(scheme, `--bucket-${bucket}`)).toBe(color);
      }
    }
  });

  it('keeps the dark point colours apart from each other and off the dark basemap', () => {
    const palette = MAP_PALETTES.dark;
    const points = [...Object.values(palette.buckets), palette.protectedTree];

    // The inverted basemap is near black wherever it carries no label.
    const faint = points.filter((color) => contrastRatio(color, '#000000') < 3);
    expect(faint).toEqual([]);

    // CIE76 distance rather than luminance: the buckets differ by hue, and a
    // pair this close would read as the same colour at point size. The light
    // palette's own closest pair sits at 20.9, so dark is held to the same bar.
    expect(minColorDistance(points)).toBeGreaterThan(18);
  });
});
