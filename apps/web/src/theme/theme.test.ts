import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { THEME_IDS } from '@clinic/shared';

/**
 * WCAG 2.1 AA guard for every theme (SPEC §10). Recomputes the derived tokens
 * in tokens.css from palettes.css; keep FORMULAS in sync with tokens.css.
 */

const read = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

type Vars = Record<string, string>;

/** `selector { --a: b; }` blocks → per-theme variables, with :root as the base. */
function parseThemes(css: string): { base: Vars; themes: Record<string, Vars> } {
  const base: Vars = {};
  const themes: Record<string, Vars> = {};
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, selector, body] of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const vars: Vars = {};
    for (const [, name, value] of body!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      vars[name!] = value!.trim();
    }
    if (/:root/.test(selector!)) Object.assign(base, vars);
    for (const [, id] of selector!.matchAll(/data-theme='([\w-]+)'/g)) {
      themes[id!] = { ...themes[id!], ...vars };
    }
  }
  return { base, themes };
}

type Rgb = [number, number, number];
const hex = (h: string): Rgb => {
  const m = /^#([0-9a-f]{6})$/i.exec(h);
  if (!m) throw new Error(`Expected #rrggbb, got ${h}`);
  return [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16)) as Rgb;
};
const pct = (p: string) => Number(p.replace('%', '')) / 100;
/** color-mix(in srgb, a p, b). */
const mix = (a: Rgb, p: number, b: Rgb): Rgb => a.map((v, i) => v * p + b[i]! * (1 - p)) as Rgb;
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

const luminance = (c: Rgb) => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const palettes = parseThemes(read('./palettes.css'));
const tokens = parseThemes(read('./tokens.css'));

/** The derived tokens for one theme, mirroring tokens.css. */
function derive(themeId: string) {
  const p = { ...palettes.base, ...palettes.themes[themeId] };
  const k = { ...tokens.base, ...tokens.themes[themeId] };
  const [primary, secondary, accent, bg, text] = [
    '--color-primary',
    '--color-secondary',
    '--color-accent',
    '--color-bg',
    '--color-text',
  ].map((name) => hex(p[name]!)) as [Rgb, Rgb, Rgb, Rgb, Rgb];
  const brand = mix(primary, pct(k['--mix-brand']!), BLACK);
  return {
    brand,
    brandHover: mix(brand, 0.85, BLACK),
    onBrand: hex(k['--on-brand']!),
    heading: mix(primary, pct(k['--mix-heading']!), text),
    link: mix(secondary, pct(k['--mix-link']!), text),
    accentSoft: mix(accent, 0.3, WHITE),
    page: bg,
    card: mix(bg, 0.25, WHITE),
    ink: text,
    inkMuted: mix(text, 0.8, WHITE),
    lineStrong: mix(text, 0.6, WHITE),
  };
}

const TEXT = 4.5; // normal text
const UI = 3; // form control borders and focus indicators (WCAG 1.4.11)

describe('themes', () => {
  it('match the theme list the app offers', () => {
    expect(Object.keys(palettes.themes).sort()).toEqual([...THEME_IDS].sort());
  });

  it('keeps the formulas this test mirrors', () => {
    const css = read('./tokens.css').replace(/\s+/g, ' ');
    for (const formula of [
      '--brand: color-mix(in srgb, var(--color-primary) var(--mix-brand), black)',
      '--brand-hover: color-mix(in srgb, var(--brand) 85%, black)',
      '--heading: color-mix(in srgb, var(--color-primary) var(--mix-heading), var(--color-text))',
      '--link: color-mix(in srgb, var(--color-secondary) var(--mix-link), var(--color-text))',
      '--accent-soft: color-mix(in srgb, var(--color-accent) 30%, white)',
      '--card: color-mix(in srgb, var(--color-bg) 25%, white)',
      '--ink-muted: color-mix(in srgb, var(--color-text) 80%, white)',
      '--line-strong: color-mix(in srgb, var(--color-text) 60%, white)',
    ]) {
      expect(css).toContain(formula);
    }
  });

  describe.each(THEME_IDS)('%s meets WCAG AA', (themeId) => {
    const t = derive(themeId);
    it.each([
      ['button text on primary', t.onBrand, t.brand, TEXT],
      ['button text on primary hover', t.onBrand, t.brandHover, TEXT],
      ['headings on the page', t.heading, t.page, TEXT],
      ['headings on cards', t.heading, t.card, TEXT],
      ['links on the page', t.link, t.page, TEXT],
      ['links on cards', t.link, t.card, TEXT],
      ['body text on the page', t.ink, t.page, TEXT],
      ['body text on cards', t.ink, t.card, TEXT],
      ['muted text on the page', t.inkMuted, t.page, TEXT],
      ['muted text on cards', t.inkMuted, t.card, TEXT],
      ['badge text on accent', t.ink, t.accentSoft, TEXT],
      ['input borders on cards', t.lineStrong, t.card, UI],
      ['focus ring on the page', t.link, t.page, UI],
      ['focus ring on the brand bar', t.onBrand, t.brand, UI],
    ] as const)('%s', (_label, fg, bg, min) => {
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(min);
    });
  });
});
