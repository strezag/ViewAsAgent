import type { Heading, LinkRef } from '../types';

/**
 * DOM work happens wherever a real `DOMParser` exists. MV3 service workers have
 * no DOM, so the service worker stays purely a network layer and everything
 * here runs in the side panel (or, in tests, jsdom).
 */

export interface ParseOptions {
  /** Injected as <base> so Readability and link extraction resolve relative URLs. */
  baseUrl: string;
  /** Supply jsdom's parser in tests. */
  parser?: DOMParser;
}

export function parseHtml(html: string, options: ParseOptions): Document {
  const parser = options.parser ?? new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Without a base, every relative href resolves against the extension origin,
  // which makes the link inventory useless and confuses Readability.
  if (!doc.querySelector('base') && doc.head) {
    const base = doc.createElement('base');
    base.setAttribute('href', options.baseUrl);
    doc.head.insertBefore(base, doc.head.firstChild);
  }
  return doc;
}

export function extractHeadings(root: ParentNode): Heading[] {
  const headings: Heading[] = [];
  for (const el of Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'))) {
    const text = normalizeWhitespace(el.textContent ?? '');
    if (!text) continue;
    headings.push({ level: Number(el.tagName.slice(1)), text });
  }
  return headings;
}

export function extractLinks(root: ParentNode): LinkRef[] {
  const links: LinkRef[] = [];
  const seen = new Set<string>();
  for (const el of Array.from(root.querySelectorAll('a[href]'))) {
    const href = el.getAttribute('href') ?? '';
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
    const text = normalizeWhitespace(el.textContent ?? '');
    // NUL cannot appear in an attribute href or in already-normalized text, so
    // the pair is unambiguous. Written as an escape so Git treats this file as
    // text rather than binary.
    const key = `${href}\u0000${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ href, text });
  }
  return links;
}

/** Elements whose text content is code or metadata, never prose. */
const NON_PROSE = 'script, style, noscript, template, svg';

/**
 * Text a reader would actually see.
 *
 * `textContent` on <body> includes the source of every inline <script>, so a
 * client-rendered shell would otherwise be credited with the words of its own
 * bundle — inflating exactly the pages whose emptiness matters most.
 */
export function readableText(root: Document | Element): string {
  const source = 'body' in root ? root.body : root;
  if (!source) return '';
  const clone = source.cloneNode(true) as Element;
  for (const el of Array.from(clone.querySelectorAll(NON_PROSE))) el.remove();
  return normalizeWhitespace(clone.textContent ?? '');
}

/**
 * How much of the payload is JavaScript. A high ratio next to a low content
 * ratio is the signature of a page assembled in the browser.
 */
export function scriptBytes(doc: Document): number {
  let total = 0;
  for (const el of Array.from(doc.querySelectorAll('script'))) {
    total += (el.textContent ?? '').length;
  }
  return total;
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
