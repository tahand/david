import { z } from 'zod';

/**
 * Colour themes. Each ID matches a `[data-theme]` block in
 * apps/web/src/theme/palettes.css.
 */
export const THEMES = [
  { id: 'trust-and-calm', label: 'Trust & Calm' },
  { id: 'warm-and-compassionate', label: 'Warm & Compassionate' },
  { id: 'natural-and-healing', label: 'Natural & Healing' },
  { id: 'uplifting-and-welcoming', label: 'Uplifting & Welcoming' },
  { id: 'serene-and-professional', label: 'Serene & Professional' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];
export const THEME_IDS = THEMES.map((t) => t.id) as [ThemeId, ...ThemeId[]];
export const DEFAULT_THEME: ThemeId = 'trust-and-calm';
export const themeIdSchema = z.enum(THEME_IDS);

export const isThemeId = (value: unknown): value is ThemeId =>
  themeIdSchema.safeParse(value).success;
