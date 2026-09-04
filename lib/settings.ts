/**
 * Panel preferences: text size and theme.
 *
 * Two stores, deliberately. chrome.storage.sync is the durable one, so a
 * preference follows the user between machines. localStorage mirrors the font
 * size because chrome.storage is async — without a synchronous read, every
 * panel open would paint at the default size and then jump. A flash is a poor
 * experience generally and a self-defeating one in an accessibility feature.
 *
 * The theme needs no mirror: CSS resolves `prefers-color-scheme` on first paint,
 * so the only thing JavaScript adds is an explicit override.
 */

export type ThemePreference = 'system' | 'light' | 'dark';

/** Root font sizes in px. Everything in the panel is rem, so this scales all of it. */
export const FONT_STEPS = [16, 18, 20, 22, 24] as const;

/** One notch above the original 16px, which was too small to read comfortably. */
export const DEFAULT_FONT_STEP = 1;

export interface Settings {
  theme: ThemePreference;
  /** Index into FONT_STEPS. */
  fontStep: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  fontStep: DEFAULT_FONT_STEP,
};

const SYNC_KEY = 'viewAsAgent:settings';
const LOCAL_FONT_KEY = 'viewAsAgent:fontStep';

const THEMES: ThemePreference[] = ['system', 'light', 'dark'];

export function clampFontStep(step: number): number {
  if (!Number.isFinite(step)) return DEFAULT_FONT_STEP;
  return Math.max(0, Math.min(FONT_STEPS.length - 1, Math.round(step)));
}

export function fontSizeFor(step: number): number {
  return FONT_STEPS[clampFontStep(step)] ?? FONT_STEPS[DEFAULT_FONT_STEP]!;
}

export function isFirstStep(step: number): boolean {
  return clampFontStep(step) === 0;
}

export function isLastStep(step: number): boolean {
  return clampFontStep(step) === FONT_STEPS.length - 1;
}

/** Anything unrecognised falls back to the default rather than throwing. */
export function normalizeSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS };
  const record = value as Partial<Record<keyof Settings, unknown>>;

  const theme =
    typeof record.theme === 'string' && THEMES.includes(record.theme as ThemePreference)
      ? (record.theme as ThemePreference)
      : DEFAULT_SETTINGS.theme;

  const fontStep =
    typeof record.fontStep === 'number' ? clampFontStep(record.fontStep) : DEFAULT_SETTINGS.fontStep;

  return { theme, fontStep };
}

/**
 * Applies settings to the document. Safe to call before React mounts.
 *
 * `data-theme` is set only for an explicit choice — its absence is what lets the
 * `prefers-color-scheme` rule in style.css take over.
 */
export function applySettings(settings: Settings, root: HTMLElement): void {
  if (settings.theme === 'system') {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = settings.theme;
  }
  root.style.fontSize = `${fontSizeFor(settings.fontStep)}px`;
}

/**
 * The synchronous half, for use before the first paint. Only the font size is
 * available this early; the theme is already correct from CSS.
 */
export function applyCachedFontStep(root: HTMLElement): void {
  let step: number = DEFAULT_FONT_STEP;
  try {
    // Storage is absent entirely in some environments and throws in others
    // (private modes, locked-down profiles). Either way we still want a size on
    // the element rather than none at all.
    const cached = globalThis.localStorage?.getItem(LOCAL_FONT_KEY);
    if (cached !== null && cached !== undefined) step = Number(cached);
  } catch {
    // Fall through to the default.
  }
  // fontSizeFor clamps, so a corrupt cache lands on the default.
  root.style.fontSize = `${fontSizeFor(step)}px`;
}

export async function loadSettings(): Promise<Settings> {
  try {
    const stored = await chrome.storage.sync.get(SYNC_KEY);
    return normalizeSettings(stored[SYNC_KEY]);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  try {
    globalThis.localStorage?.setItem(LOCAL_FONT_KEY, String(settings.fontStep));
  } catch {
    // The mirror is an optimisation; losing it only costs a flash.
  }
  try {
    await chrome.storage.sync.set({ [SYNC_KEY]: settings });
  } catch (err) {
    console.warn('[ViewAsAgent] could not save settings:', err);
  }
}
