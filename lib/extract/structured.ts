import type { HrefLang, JsonLdBlock, PageMeta, StructuredData } from '../types';
import { normalizeWhitespace } from './html';

/**
 * Structured data is the part of a page written for machines, so it is the part
 * most worth checking against what a machine actually receives.
 *
 * The common and expensive failure is JSON-LD injected by a tag manager or a
 * framework after hydration: perfect in the rendered DOM, absent from the HTML
 * every non-rendering crawler reads. Running this over both documents makes
 * that visible.
 */

export function extractStructuredData(doc: Document): StructuredData {
  return { jsonLd: extractJsonLd(doc), meta: extractMeta(doc) };
}

export function extractJsonLd(doc: Document): JsonLdBlock[] {
  const blocks: JsonLdBlock[] = [];

  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    const raw = (script.textContent ?? '').trim();
    if (!raw) continue;

    try {
      const parsed: unknown = JSON.parse(raw);
      blocks.push({ types: collectTypes(parsed), parsed, raw });
    } catch (err) {
      // Malformed JSON-LD is worth reporting rather than skipping: the site
      // owner believes it is working.
      blocks.push({
        types: [],
        parsed: null,
        raw,
        error: err instanceof Error ? err.message : 'Invalid JSON',
      });
    }
  }
  return blocks;
}

/** Flattens @type across arrays and @graph, which is how real pages nest it. */
function collectTypes(value: unknown, depth = 0): string[] {
  if (depth > 6 || value === null || typeof value !== 'object') return [];

  if (Array.isArray(value)) {
    return unique(value.flatMap((entry) => collectTypes(entry, depth + 1)));
  }

  const record = value as Record<string, unknown>;
  const types: string[] = [];

  const typeValue = record['@type'];
  if (typeof typeValue === 'string') types.push(typeValue);
  else if (Array.isArray(typeValue)) {
    for (const t of typeValue) if (typeof t === 'string') types.push(t);
  }

  const graph = record['@graph'];
  if (graph) types.push(...collectTypes(graph, depth + 1));

  return unique(types);
}

export function extractMeta(doc: Document): PageMeta {
  const content = (selector: string): string | null => {
    const el = doc.querySelector(selector);
    const value = el?.getAttribute('content') ?? null;
    return value ? normalizeWhitespace(value) : null;
  };

  const hreflang: HrefLang[] = [];
  for (const link of Array.from(doc.querySelectorAll('link[rel="alternate"][hreflang]'))) {
    const lang = link.getAttribute('hreflang');
    const href = link.getAttribute('href');
    if (lang && href) hreflang.push({ lang, href });
  }

  return {
    title: normalizeWhitespace(doc.title ?? '') || null,
    description: content('meta[name="description" i]'),
    canonical: doc.querySelector('link[rel="canonical" i]')?.getAttribute('href') ?? null,
    metaRobots: content('meta[name="robots" i]'),
    ogTitle: content('meta[property="og:title" i]'),
    ogDescription: content('meta[property="og:description" i]'),
    ogImage: content('meta[property="og:image" i]'),
    ogType: content('meta[property="og:type" i]'),
    twitterCard: content('meta[name="twitter:card" i]'),
    hreflang,
  };
}

/**
 * Agent-specific robots meta tags too. A site can address `GPTBot` or the
 * generic `AI` token directly, and those override the general `robots` tag for
 * that crawler.
 */
export function agentRobotsMeta(doc: Document, robotsToken: string): string | null {
  const el = doc.querySelector(`meta[name="${cssEscape(robotsToken)}" i]`);
  const value = el?.getAttribute('content');
  return value ? normalizeWhitespace(value) : null;
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export const EMPTY_STRUCTURED: StructuredData = {
  jsonLd: [],
  meta: {
    title: null,
    description: null,
    canonical: null,
    metaRobots: null,
    ogTitle: null,
    ogDescription: null,
    ogImage: null,
    ogType: null,
    twitterCard: null,
    hreflang: [],
  },
};
