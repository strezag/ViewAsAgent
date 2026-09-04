import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Contrast is the whole reason the palettes are authored as hex in one file
 * rather than inherited from Tailwind's defaults: it makes them parseable, and
 * therefore checkable.
 *
 * This is the test that catches the bug that prompted the work — Tailwind's
 * slate-600 on slate-950 sits at roughly 3.2:1, and it carries real text.
 */

const CSS = readFileSync(join(process.cwd(), 'entrypoints/sidepanel/style.css'), 'utf8');

// ---------------------------------------------------------------------------
// WCAG 2.1 relative luminance and contrast, straight from the spec
// ---------------------------------------------------------------------------

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---------------------------------------------------------------------------
// Palette extraction
// ---------------------------------------------------------------------------

/** Dark values are declared directly as --color-*. */
function darkPalette(): Record<string, string> {
  const palette: Record<string, string> = {};
  const pattern = /--color-([a-z]+-\d+):\s*(#[0-9a-fA-F]{3,8});/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(CSS)) !== null) {
    palette[match[1]!] = match[2]!;
  }
  return palette;
}

/** Light values are declared as --l-* and aliased onto --color-* by selector. */
function lightPalette(): Record<string, string> {
  const palette: Record<string, string> = {};
  const pattern = /--l-([a-z]+-\d+):\s*(#[0-9a-fA-F]{3,8});/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(CSS)) !== null) {
    palette[match[1]!] = match[2]!;
  }
  return palette;
}

const DARK = darkPalette();
const LIGHT = lightPalette();

/**
 * Every token that carries text, paired with the surfaces it appears on.
 *
 * `slate-950` is the page and the code blocks; `slate-900` is the card. Text
 * has to clear AA on both.
 */
const SURFACES = ['slate-950', 'slate-900'];

const TEXT_TOKENS = [
  'slate-100',
  'slate-200',
  'slate-300',
  'slate-400',
  'slate-500',
  'slate-600',
  'sky-300',
  'sky-400',
  'emerald-300',
  'emerald-400',
  'amber-300',
  'amber-400',
  'amber-500',
  'orange-300',
  'orange-400',
  'rose-300',
  'rose-400',
];

const AA_NORMAL = 4.5;

describe('palette parsing', () => {
  it('finds both palettes in style.css', () => {
    expect(Object.keys(DARK).length).toBeGreaterThanOrEqual(28);
    expect(Object.keys(LIGHT).length).toBeGreaterThanOrEqual(28);
  });

  it('defines a light counterpart for every dark colour', () => {
    for (const token of Object.keys(DARK)) {
      expect(LIGHT[token], `light palette is missing ${token}`).toBeDefined();
    }
  });

  it('inverts the slate ramp, so surfaces and text swap ends', () => {
    // Dark: high numbers are dark surfaces. Light: high numbers are pale ones.
    expect(luminance(DARK['slate-950']!)).toBeLessThan(luminance(DARK['slate-100']!));
    expect(luminance(LIGHT['slate-950']!)).toBeGreaterThan(luminance(LIGHT['slate-100']!));
  });
});

describe.each([
  ['dark', DARK],
  ['light', LIGHT],
])('%s theme contrast', (themeName, palette) => {
  for (const token of TEXT_TOKENS) {
    for (const surface of SURFACES) {
      it(`${token} on ${surface} meets AA`, () => {
        const fg = palette[token];
        const bg = palette[surface];
        expect(fg, `${themeName} palette is missing ${token}`).toBeDefined();
        expect(bg, `${themeName} palette is missing ${surface}`).toBeDefined();

        const ratio = contrast(fg!, bg!);
        expect(
          Number(ratio.toFixed(2)),
          `${themeName}: ${token} (${fg}) on ${surface} (${bg}) is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_NORMAL);
      });
    }
  }
});

describe('interactive surfaces', () => {
  it('keeps white legible on the Run button in both themes', () => {
    // sky-600 is a filled button with white text, so it is the background here.
    expect(contrast('#ffffff', DARK['sky-600']!)).toBeGreaterThanOrEqual(AA_NORMAL);
    expect(contrast('#ffffff', LIGHT['sky-600']!)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('keeps borders distinguishable from the surfaces they separate', () => {
    // 3:1 is the non-text threshold; a border below it simply disappears.
    for (const [name, palette] of [
      ['dark', DARK],
      ['light', LIGHT],
    ] as const) {
      const ratio = contrast(palette['slate-800']!, palette['slate-950']!);
      expect(ratio, `${name}: slate-800 on slate-950 is ${ratio.toFixed(2)}:1`).toBeGreaterThan(1.2);
    }
  });
});
