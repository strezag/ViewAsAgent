import { Readability } from '@mozilla/readability';
import type { DocMetrics, DocumentShape, DocumentSlot, ExtractedDoc, Heading, LinkRef } from '../types';
import { countTokens } from './tokens';
import { htmlToMarkdown } from './markdown';
import {
  countWords,
  extractHeadings,
  extractLinks,
  normalizeWhitespace,
  parseHtml,
  readableText,
  scriptBytes,
} from './html';

export interface ExtractInput {
  slot: DocumentSlot;
  label: string;
  url: string;
  /** The payload as delivered: HTML, markdown, or whatever came back. */
  body: string;
  contentType: string | null;
  status: number;
  /** Set when the fetch itself failed. */
  error?: string;
  /** Supply jsdom's parser in tests. */
  parser?: DOMParser;
}

function isMarkdown(contentType: string | null): boolean {
  return /text\/(markdown|x-markdown)/i.test(contentType ?? '');
}

function isHtml(contentType: string | null): boolean {
  // A missing content-type is far more often HTML than anything else, and the
  // parser degrades gracefully when it is wrong.
  if (!contentType) return true;
  return /text\/html|application\/xhtml/i.test(contentType);
}

/**
 * Turn one fetched payload into the shape the gap analysis compares.
 *
 * The three documents in an audit go through exactly the same pipeline, so any
 * difference the UI reports is a difference in the source, never an artifact of
 * measuring them differently.
 */
export async function extractDocument(input: ExtractInput): Promise<ExtractedDoc> {
  const base = {
    slot: input.slot,
    label: input.label,
    url: input.url,
    status: input.status,
    contentType: input.contentType,
  };

  if (input.error || input.status === 0 || input.status >= 400) {
    return {
      ...base,
      shape: 'error' as DocumentShape,
      title: null,
      byline: null,
      excerpt: null,
      markdown: '',
      text: '',
      headings: [],
      links: [],
      metrics: await measure('', '', input.body, 0, 0, 0),
      error: input.error ?? `HTTP ${input.status}`,
    };
  }

  if (isMarkdown(input.contentType)) return extractFromMarkdown(base, input.body);
  if (!isHtml(input.contentType)) return extractFromPlainText(base, input.body);
  return extractFromHtml(base, input);
}

type Base = Pick<ExtractedDoc, 'slot' | 'label' | 'url' | 'status' | 'contentType'>;

async function extractFromHtml(base: Base, input: ExtractInput): Promise<ExtractedDoc> {
  let doc: Document;
  try {
    doc = parseHtml(input.body, { baseUrl: input.url, parser: input.parser });
  } catch (err) {
    return {
      ...base,
      shape: 'error',
      title: null,
      byline: null,
      excerpt: null,
      markdown: '',
      text: '',
      headings: [],
      links: [],
      metrics: await measure('', '', input.body, 0, 0, 0),
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const documentTitle = normalizeWhitespace(doc.title ?? '') || null;
  const scripts = scriptBytes(doc);

  // Readability mutates the document it is handed, so the inventory comes off
  // the pristine parse and Readability gets a clone.
  const pristineHeadings = extractHeadings(doc);
  const pristineLinks = extractLinks(doc);

  const article = runReadability(doc);

  let shape: DocumentShape;
  let contentHtml: string;
  let title: string | null = documentTitle;
  let byline: string | null = null;
  let excerpt: string | null = null;

  if (article && article.content && countWords(article.textContent ?? '') > 25) {
    shape = 'article';
    contentHtml = article.content;
    title = normalizeWhitespace(article.title ?? '') || documentTitle;
    byline = normalizeWhitespace(article.byline ?? '') || null;
    excerpt = normalizeWhitespace(article.excerpt ?? '') || null;
  } else {
    // No article. That is itself the finding on a client-rendered page, so fall
    // back to <body> and let the word count tell the story.
    shape = 'fallback';
    contentHtml = doc.body?.innerHTML ?? '';
  }

  const markdown = htmlToMarkdown(contentHtml);
  const text =
    article && shape === 'article'
      ? normalizeWhitespace(article.textContent ?? '')
      : readableText(doc);

  // A shell with a title and nothing else is empty for an agent's purposes.
  if (countWords(text) < 5) shape = 'empty';

  const headings = shape === 'article' ? headingsFromHtml(contentHtml, input) : pristineHeadings;
  const links = shape === 'article' ? linksFromHtml(contentHtml, input) : pristineLinks;

  return {
    ...base,
    shape,
    title,
    byline,
    excerpt,
    markdown,
    text,
    headings,
    links,
    metrics: await measure(markdown, text, input.body, scripts, headings.length, links.length),
  };
}

function runReadability(doc: Document): ReturnType<Readability['parse']> {
  try {
    if (!doc.body) return null;
    const clone = doc.cloneNode(true) as Document;
    return new Readability(clone).parse();
  } catch (err) {
    console.warn('[ViewAsAgent] Readability failed, using the body instead:', err);
    return null;
  }
}

function headingsFromHtml(html: string, input: ExtractInput): Heading[] {
  try {
    return extractHeadings(parseHtml(html, { baseUrl: input.url, parser: input.parser }));
  } catch {
    return [];
  }
}

function linksFromHtml(html: string, input: ExtractInput): LinkRef[] {
  try {
    return extractLinks(parseHtml(html, { baseUrl: input.url, parser: input.parser }));
  } catch {
    return [];
  }
}

/**
 * The server already did the conversion. This is the best case for an agent and
 * needs no extraction at all — only measuring.
 */
async function extractFromMarkdown(base: Base, body: string): Promise<ExtractedDoc> {
  const headings = headingsFromMarkdown(body);
  const links = linksFromMarkdown(body);
  const text = normalizeWhitespace(stripMarkdown(body));
  return {
    ...base,
    shape: body.trim() ? 'markdown' : 'empty',
    title: headings.find((h) => h.level === 1)?.text ?? null,
    byline: null,
    excerpt: null,
    markdown: body.trim(),
    text,
    headings,
    links,
    metrics: await measure(body, text, body, 0, headings.length, links.length),
  };
}

async function extractFromPlainText(base: Base, body: string): Promise<ExtractedDoc> {
  const text = normalizeWhitespace(body);
  return {
    ...base,
    shape: text ? 'fallback' : 'empty',
    title: null,
    byline: null,
    excerpt: null,
    markdown: body.trim(),
    text,
    headings: [],
    links: [],
    metrics: await measure(body, text, body, 0, 0, 0),
  };
}

export function headingsFromMarkdown(markdown: string): Heading[] {
  const headings: Heading[] = [];
  let inFence = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (match?.[1] && match[2]) {
      headings.push({ level: match[1].length, text: normalizeWhitespace(match[2]) });
    }
  }
  return headings;
}

export function linksFromMarkdown(markdown: string): LinkRef[] {
  const links: LinkRef[] = [];
  const pattern = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    links.push({ text: normalizeWhitespace(match[1] ?? ''), href: match[2] ?? '' });
  }
  return links;
}

/** Enough markdown syntax removal to make word counts comparable with HTML text. */
function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[#>\-*+]+\s*/gm, '')
    .replace(/[*_~]/g, '');
}

async function measure(
  markdown: string,
  text: string,
  payload: string,
  scripts: number,
  headingCount: number,
  linkCount: number,
): Promise<DocMetrics> {
  const [tokens, payloadTokens] = await Promise.all([
    countTokens(markdown),
    countTokens(payload),
  ]);
  return {
    payloadBytes: payload.length,
    scriptBytes: scripts,
    textChars: text.length,
    words: countWords(text),
    tokens,
    payloadTokens,
    headingCount,
    linkCount,
    contentRatio: payload.length ? text.length / payload.length : 0,
  };
}
