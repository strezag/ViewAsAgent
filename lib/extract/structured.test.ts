// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { extractStructuredData } from './structured';
import { parseHtml } from './html';

const parse = (body: string) => parseHtml(body, { baseUrl: 'https://example.com/page' });

describe('extractJsonLd', () => {
  it('reads @type from a plain block', () => {
    const doc = parse(`<html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Article","headline":"Hi"}
    </script></head><body></body></html>`);

    const { jsonLd } = extractStructuredData(doc);
    expect(jsonLd).toHaveLength(1);
    expect(jsonLd[0]?.types).toEqual(['Article']);
  });

  it('flattens types across @graph, which is how most CMSs emit it', () => {
    const doc = parse(`<html><head><script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"Organization","name":"Acme"},
        {"@type":"WebSite","name":"Acme site"},
        {"@type":["Article","NewsArticle"],"headline":"Hi"}
      ]}
    </script></head><body></body></html>`);

    expect(extractStructuredData(doc).jsonLd[0]?.types).toEqual([
      'Organization',
      'WebSite',
      'Article',
      'NewsArticle',
    ]);
  });

  it('handles a top-level array of entities', () => {
    const doc = parse(`<html><head><script type="application/ld+json">
      [{"@type":"Product"},{"@type":"Offer"}]
    </script></head><body></body></html>`);
    expect(extractStructuredData(doc).jsonLd[0]?.types).toEqual(['Product', 'Offer']);
  });

  it('reports malformed JSON-LD rather than silently skipping it', () => {
    // The site owner believes this is working, so silence would be the wrong
    // kind of helpful.
    const doc = parse(`<html><head><script type="application/ld+json">
      {"@type":"Article", headline: "unquoted key"}
    </script></head><body></body></html>`);

    const block = extractStructuredData(doc).jsonLd[0];
    expect(block?.error).toBeTruthy();
    expect(block?.types).toEqual([]);
    expect(block?.raw).toContain('unquoted key');
  });

  it('ignores scripts that are not ld+json', () => {
    const doc = parse(`<html><head>
      <script type="application/json">{"@type":"NotStructuredData"}</script>
      <script>var x = 1;</script>
    </head><body></body></html>`);
    expect(extractStructuredData(doc).jsonLd).toHaveLength(0);
  });
});

describe('extractMeta', () => {
  it('reads the tags an agent uses to classify a page', () => {
    const doc = parse(`<html><head>
      <title>  The   Title </title>
      <meta name="description" content="A description.">
      <link rel="canonical" href="https://example.com/canonical">
      <meta name="robots" content="index, follow, noai">
      <meta property="og:title" content="OG Title">
      <meta property="og:type" content="article">
      <meta name="twitter:card" content="summary_large_image">
      <link rel="alternate" hreflang="fr" href="https://example.com/fr">
      <link rel="alternate" hreflang="de" href="https://example.com/de">
    </head><body></body></html>`);

    const { meta } = extractStructuredData(doc);
    expect(meta.title).toBe('The Title');
    expect(meta.description).toBe('A description.');
    expect(meta.canonical).toBe('https://example.com/canonical');
    expect(meta.metaRobots).toBe('index, follow, noai');
    expect(meta.ogTitle).toBe('OG Title');
    expect(meta.ogType).toBe('article');
    expect(meta.twitterCard).toBe('summary_large_image');
    expect(meta.hreflang).toEqual([
      { lang: 'fr', href: 'https://example.com/fr' },
      { lang: 'de', href: 'https://example.com/de' },
    ]);
  });

  it('returns nulls rather than empty strings for absent tags', () => {
    const { meta } = extractStructuredData(parse('<html><head></head><body></body></html>'));
    expect(meta.description).toBeNull();
    expect(meta.canonical).toBeNull();
    expect(meta.hreflang).toEqual([]);
  });

  it('matches tag names case-insensitively, as browsers do', () => {
    const doc = parse('<html><head><meta name="Description" content="Mixed case."></head><body></body></html>');
    expect(extractStructuredData(doc).meta.description).toBe('Mixed case.');
  });
});
