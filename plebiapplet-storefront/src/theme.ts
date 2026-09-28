/**
 * Whole-surface theming (SPEC 9).
 *
 * NAP-THEME is optional. When present its colours are applied to `:root`, `html`,
 * `body` and the app root so the host never shows a browser-white canvas around
 * the UI; when absent an explicit dark palette is used instead. Surface, border
 * and muted tokens are derived from the two colours the payload guarantees.
 */
import { themeGet, themeOnChanged } from '@napplet/sdk';
import type { Subscription } from '@napplet/sdk';
import { hasDomain } from './nap';

/** The three colours every NAP-THEME payload carries. */
export interface ThemeColors {
  background: string;
  text: string;
  primary: string;
}

/** Explicit dark palette used when no runtime theme is available. */
export const FALLBACK_THEME: ThemeColors = {
  background: '#111418',
  text: '#e8eaed',
  primary: '#f7931a',
};

function parseHex(color: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return null;
  const hex = match[1];
  const full = hex.length === 3 ? [...hex].map((char) => char + char).join('') : hex;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function mix(base: string, towards: string, ratio: number): string | null {
  const from = parseHex(base);
  const to = parseHex(towards);
  if (!from || !to) return null;
  const channels = from.map((value, index) => Math.round(value + (to[index] - value) * ratio));
  return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
}

/** Derive the surface/border/muted tokens the UI needs from a theme payload. */
function deriveTokens(colors: ThemeColors): Record<string, string> {
  const { background, text, primary } = colors;
  return {
    '--pm-bg': background,
    '--pm-fg': text,
    '--pm-primary': primary,
    '--pm-surface': mix(background, text, 0.07) ?? 'rgba(127, 127, 127, 0.12)',
    '--pm-border': mix(background, text, 0.2) ?? 'rgba(127, 127, 127, 0.32)',
    '--pm-muted': mix(background, text, 0.55) ?? 'rgba(127, 127, 127, 0.85)',
  };
}

/** Paint a theme across the document root, body, and app root. */
export function applyTheme(colors: ThemeColors): void {
  const root = document.documentElement;
  for (const [token, value] of Object.entries(deriveTokens(colors))) {
    root.style.setProperty(token, value);
  }
  root.style.backgroundColor = colors.background;
  root.style.color = colors.text;
  if (document.body) {
    document.body.style.backgroundColor = colors.background;
    document.body.style.color = colors.text;
  }
  const app = document.getElementById('app');
  if (app) app.style.backgroundColor = colors.background;
}

function readColors(payload: { colors?: Partial<ThemeColors> } | null): ThemeColors {
  const colors = payload?.colors;
  return {
    background: colors?.background || FALLBACK_THEME.background,
    text: colors?.text || FALLBACK_THEME.text,
    primary: colors?.primary || FALLBACK_THEME.primary,
  };
}

/**
 * Apply the runtime theme and keep following it.
 * Returns the change subscription, or null when NAP-THEME is unavailable.
 */
export function startTheme(): Subscription | null {
  applyTheme(FALLBACK_THEME);
  if (!hasDomain('theme')) return null;
  // A domain can be present on the injected namespace without implementing every
  // helper, so these calls are guarded rather than trusted to the presence check.
  try {
    themeGet()
      .then((theme) => applyTheme(readColors(theme)))
      .catch(() => applyTheme(FALLBACK_THEME));
  } catch {
    applyTheme(FALLBACK_THEME);
  }
  try {
    return themeOnChanged((theme) => applyTheme(readColors(theme)));
  } catch {
    return null;
  }
}
