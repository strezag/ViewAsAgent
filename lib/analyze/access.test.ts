import { describe, expect, it } from 'vitest';
import { buildAccessReport, looksLikeHtml } from './access';
import { markdownCompanionUrl } from '../fetch/probes';
import { EMPTY_STRUCTURED } from '../extract/structured';
import type { HeaderPair, PageMeta, ProbeBundle, ProbeId, ProbeResult } from '../types';

function probe(id: ProbeId, over: Partial<ProbeResult> = {}): ProbeResult {
  return {
    id,
    url: `https://example.com/${id}`,
    status: 404,
    ok: false,
    contentType: null,
    body: '',
    headers: [],
    elapsedMs: 5,
    ...over,
  };
}

function bundle(over: Partial<Record<ProbeId, Partial<ProbeResult>>> = {}): ProbeBundle {
  const ids: ProbeId[] = [
    'robots',
    'llms',
    'llmsFull',
    'sitemap',
    'markdownAccept',
    'dotMd',
    'jsonLdAccept',
  ];
  return Object.fromEntries(ids.map((id) => [id, probe(id, over[id] ?? {})])) as ProbeBundle;
}

const meta = (over: Partial<PageMeta> = {}): PageMeta => ({ ...EMPTY_STRUCTURED.meta, ...over });

const report = (over: {
  probes?: ProbeBundle;
  agentMeta?: PageMeta;
  browserHeaders?: HeaderPair[];
  agentHeaders?: HeaderPair[];
} = {}) =>
  buildAccessReport({
    url: 'https://example.com/docs/page',
    probes: over.probes ?? bundle(),
    agentMeta: over.agentMeta ?? meta(),
    browserHeaders: over.browserHeaders ?? [],
    agentHeaders: over.agentHeaders ?? [],
  });

const ok = (body: string, contentType: string): Partial<ProbeResult> => ({
  status: 200,
  ok: true,
  body,
  contentType,
});

describe('robots handling', () => {
  it('produces a verdict for every agent profile', () => {
    const result = report({
      probes: bundle({ robots: ok('User-agent: *\nDisallow: /docs\n', 'text/plain') }),
    });
    expect(result.verdicts.length).toBeGreaterThan(10);
    expect(result.verdicts.every((v) => v.verdict.allowed === false)).toBe(true);
  });

  it('ignores an SPA shell served in place of robots.txt', () => {
    // Servers that answer every path with 200 and their app shell would
    // otherwise have HTML parsed as directives, inventing rules.
    const result = report({
      probes: bundle({
        robots: ok('<!doctype html><html><head><title>App</title></head><body></body></html>', 'text/html'),
      }),
    });
    expect(result.robots).toBeNull();
    expect(result.verdicts.every((v) => v.verdict.allowed)).toBe(true);
  });

  it('treats a missing robots.txt as permission for everyone', () => {
    const result = report();
    expect(result.robots).toBeNull();
    expect(result.verdicts.every((v) => v.verdict.allowed)).toBe(true);
  });
});

describe('crawl directives', () => {
  it('reads AI opt-out tokens from the robots meta tag', () => {
    const result = report({ agentMeta: meta({ metaRobots: 'index, follow, noai, noimageai' }) });
    expect(result.directives.noai).toBe(true);
    expect(result.directives.noimageai).toBe(true);
    expect(result.directives.noindex).toBe(false);
  });

  it('reads directives from the X-Robots-Tag header', () => {
    const result = report({ agentHeaders: [{ name: 'X-Robots-Tag', value: 'noindex, nosnippet' }] });
    expect(result.directives.noindex).toBe(true);
    expect(result.directives.nosnippet).toBe(true);
  });

  it('strips a user-agent prefix from a scoped X-Robots-Tag', () => {
    const result = report({ agentHeaders: [{ name: 'x-robots-tag', value: 'googlebot: noindex' }] });
    expect(result.directives.xRobotsTag).toEqual(['noindex']);
    expect(result.directives.noindex).toBe(true);
  });

  it('reports nothing when neither source sets anything', () => {
    const result = report();
    expect(result.directives.metaRobots).toEqual([]);
    expect(result.directives.xRobotsTag).toEqual([]);
    expect(result.directives.noindex).toBe(false);
  });
});

describe('agent affordances', () => {
  it('detects markdown negotiation from the content type', () => {
    const result = report({
      probes: bundle({ markdownAccept: ok('# Title\n\nBody.', 'text/markdown; charset=utf-8') }),
    });
    expect(result.affordances.markdownNegotiation).toBe(true);
  });

  it('accepts markdown sent as text/plain only when it looks like markdown', () => {
    const structured = report({
      probes: bundle({ markdownAccept: ok('# Title\n\n- one\n- two', 'text/plain') }),
    });
    expect(structured.affordances.markdownNegotiation).toBe(true);

    const prose = report({
      probes: bundle({ markdownAccept: ok('Just a sentence with no structure.', 'text/plain') }),
    });
    expect(prose.affordances.markdownNegotiation).toBe(false);
  });

  it('rejects an HTML page returned for a markdown request', () => {
    const result = report({
      probes: bundle({ markdownAccept: ok('<!doctype html><html><body>Hi</body></html>', 'text/html') }),
    });
    expect(result.affordances.markdownNegotiation).toBe(false);
  });

  it('rejects an HTML 200 standing in for a missing llms.txt', () => {
    const result = report({
      probes: bundle({ llms: ok('<!doctype html><html><body>Not found</body></html>', 'text/html') }),
    });
    expect(result.affordances.llmsTxt).toBe(false);
  });

  it('accepts a real llms.txt', () => {
    const result = report({
      probes: bundle({ llms: ok('# Example\n\n> Summary\n', 'text/plain; charset=utf-8') }),
    });
    expect(result.affordances.llmsTxt).toBe(true);
  });

  it('requires a sitemap to actually contain sitemap markup', () => {
    expect(report({ probes: bundle({ sitemap: ok('<urlset><url><loc>/a</loc></url></urlset>', 'application/xml') }) }).affordances.sitemapReachable).toBe(true);
    expect(report({ probes: bundle({ sitemap: ok('not xml', 'text/plain') }) }).affordances.sitemapReachable).toBe(false);
  });

  it('requires JSON-LD negotiation to return parseable JSON', () => {
    expect(report({ probes: bundle({ jsonLdAccept: ok('{"@type":"Article"}', 'application/ld+json') }) }).affordances.jsonLdNegotiation).toBe(true);
    expect(report({ probes: bundle({ jsonLdAccept: ok('{broken', 'application/ld+json') }) }).affordances.jsonLdNegotiation).toBe(false);
  });

  it('surfaces sitemaps declared in robots.txt', () => {
    const result = report({
      probes: bundle({
        robots: ok('User-agent: *\nAllow: /\nSitemap: https://example.com/sitemap.xml\n', 'text/plain'),
      }),
    });
    expect(result.affordances.sitemapsDeclared).toEqual(['https://example.com/sitemap.xml']);
  });
});

describe('looksLikeHtml', () => {
  it('recognises the shapes servers actually return', () => {
    expect(looksLikeHtml('<!DOCTYPE html><html>')).toBe(true);
    expect(looksLikeHtml('\n  <html lang="en">')).toBe(true);
    expect(looksLikeHtml('<html><head></head>')).toBe(true);
    expect(looksLikeHtml('# A markdown heading')).toBe(false);
    expect(looksLikeHtml('User-agent: *')).toBe(false);
  });
});

describe('markdownCompanionUrl', () => {
  it('appends .md to a normal path', () => {
    expect(markdownCompanionUrl('https://example.com/docs/page')).toBe('https://example.com/docs/page.md');
  });

  it('uses index.md for a directory path', () => {
    expect(markdownCompanionUrl('https://example.com/docs/')).toBe('https://example.com/docs/index.md');
  });

  it('drops the query, since the companion is per path', () => {
    expect(markdownCompanionUrl('https://example.com/docs/page?v=2#top')).toBe(
      'https://example.com/docs/page.md',
    );
  });

  it('leaves a path that is already markdown alone', () => {
    expect(markdownCompanionUrl('https://example.com/docs/page.md')).toBe('https://example.com/docs/page.md');
  });
});
