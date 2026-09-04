// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_FONT_STEP,
  DEFAULT_SETTINGS,
  FONT_STEPS,
  applyCachedFontStep,
  applySettings,
  clampFontStep,
  fontSizeFor,
  isFirstStep,
  isLastStep,
  normalizeSettings,
} from './settings';

describe('font steps', () => {
  it('defaults one notch above the original size', () => {
    expect(FONT_STEPS[0]).toBe(16);
    expect(fontSizeFor(DEFAULT_FONT_STEP)).toBe(18);
  });

  it('keeps every step legible — no step shrinks the smallest text below 10px', () => {
    // The smallest class in the panel is text-[0.5625rem] — 9/16 of the root.
    for (const size of FONT_STEPS) {
      expect(size * (9 / 16)).toBeGreaterThanOrEqual(9);
    }
  });

  it('clamps rather than running off either end', () => {
    expect(clampFontStep(-5)).toBe(0);
    expect(clampFontStep(99)).toBe(FONT_STEPS.length - 1);
    expect(clampFontStep(2)).toBe(2);
  });

  it('survives values that are not numbers at all', () => {
    expect(clampFontStep(Number.NaN)).toBe(DEFAULT_FONT_STEP);
    expect(clampFontStep(Number.POSITIVE_INFINITY)).toBe(DEFAULT_FONT_STEP);
  });

  it('knows when the controls should be disabled', () => {
    expect(isFirstStep(0)).toBe(true);
    expect(isFirstStep(1)).toBe(false);
    expect(isLastStep(FONT_STEPS.length - 1)).toBe(true);
    expect(isLastStep(0)).toBe(false);
  });
});

describe('normalizeSettings', () => {
  it('accepts a well-formed record', () => {
    expect(normalizeSettings({ theme: 'light', fontStep: 3 })).toEqual({
      theme: 'light',
      fontStep: 3,
    });
  });

  it('falls back rather than throwing on junk', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ theme: 'chartreuse', fontStep: 'big' })).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps a stored step that is out of range', () => {
    // A step written by a future build with more steps must not break this one.
    expect(normalizeSettings({ theme: 'dark', fontStep: 42 }).fontStep).toBe(FONT_STEPS.length - 1);
  });
});

describe('applySettings', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('html');
  });

  it('leaves data-theme off for "system", which is what lets CSS decide', () => {
    applySettings({ theme: 'system', fontStep: 1 }, root);
    expect(root.dataset.theme).toBeUndefined();
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('sets data-theme for an explicit choice', () => {
    applySettings({ theme: 'light', fontStep: 1 }, root);
    expect(root.dataset.theme).toBe('light');
    applySettings({ theme: 'dark', fontStep: 1 }, root);
    expect(root.dataset.theme).toBe('dark');
  });

  it('removes the override when switching back to system', () => {
    applySettings({ theme: 'dark', fontStep: 1 }, root);
    applySettings({ theme: 'system', fontStep: 1 }, root);
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('writes the root font size, which everything else scales from', () => {
    applySettings({ theme: 'system', fontStep: 4 }, root);
    expect(root.style.fontSize).toBe('24px');
  });
});

/**
 * jsdom here exposes no localStorage at all, which is itself worth handling —
 * the extension must still size the panel when storage is missing. These tests
 * install an in-memory shim so the caching logic can be exercised, and the
 * "storage is absent" case is covered separately below.
 */
function installStorageShim(): Storage {
  const map = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => Array.from(map.keys())[index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: shim,
    configurable: true,
    writable: true,
  });
  return shim;
}

describe('applyCachedFontStep', () => {
  let root: HTMLElement;

  beforeEach(() => {
    installStorageShim();
    root = document.createElement('html');
  });

  it('applies the default when nothing is cached', () => {
    applyCachedFontStep(root);
    expect(root.style.fontSize).toBe('18px');
  });

  it('applies a cached step synchronously', () => {
    window.localStorage.setItem('viewAsAgent:fontStep', '4');
    applyCachedFontStep(root);
    expect(root.style.fontSize).toBe('24px');
  });

  it('ignores a corrupt cache rather than leaving the panel unstyled', () => {
    window.localStorage.setItem('viewAsAgent:fontStep', 'enormous');
    applyCachedFontStep(root);
    expect(root.style.fontSize).toBe('18px');
  });

  it('still sizes the panel when storage does not exist', () => {
    // Some contexts expose no localStorage at all. Swallowing the error and
    // setting nothing would leave the element with no size of its own.
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    applyCachedFontStep(root);
    expect(root.style.fontSize).toBe('18px');
  });

  it('still sizes the panel when storage throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new Error('access denied');
      },
      configurable: true,
    });
    applyCachedFontStep(root);
    expect(root.style.fontSize).toBe('18px');
  });
});
