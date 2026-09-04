// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { extractDocument, headingsFromMarkdown, linksFromMarkdown } from './document';

const URL = 'https://example.com/article';

const ARTICLE = `<!doctype html>
<html lang="en"><head><title>The Kessel Run Was Twelve Parsecs</title></head>
<body>
  <nav><a href="/home">Home</a><a href="/about">About</a></nav>
  <main>
    <h1>The Kessel Run Was Twelve Parsecs</h1>
    <p>A parsec is a unit of distance, not a unit of time, which is the entire joke that
       generations of viewers have argued about at length without ever consulting a dictionary.</p>
    <h2>Why measurement matters</h2>
    <p>Route efficiency and speed are different claims. Conflating them produces the kind of
       confident, wrong answer that an assistant will happily repeat to a million people.</p>
    <ul><li>Server-rendered</li><li>Structured data present</li><li>No JavaScript required</li></ul>
  </main>
  <footer><p>Fixture footer.</p></footer>
</body></html>`;

const SHELL = `<!doctype html>
<html lang="en"><head><title>Client-rendered fixture</title></head>
<body><div id="root"></div><script>fetch('/api/article').then(r => r.json());</script></body></html>`;

const MARKDOWN = `# The Kessel Run Was Twelve Parsecs

A parsec is a unit of distance, not time.

## Why measurement matters

See the [full explanation](https://example.com/explanation).
`;

const base = { slot: 'rawBrowser' as const, label: 'Raw HTML', url: URL, status: 200 };

describe('extractDocument on HTML', () => {
  it('finds the article and drops the chrome around it', async () => {
    const doc = await extractDocument({ ...base, body: ARTICLE, contentType: 'text/html' });

    expect(doc.shape).toBe('article');
    expect(doc.title).toContain('Kessel Run');
    expect(doc.markdown).toContain('Why measurement matters');
    expect(doc.metrics.words).toBeGreaterThan(40);
    // Readability strips navigation, so the nav links should not survive.
    expect(doc.links.some((l) => l.href.includes('/about'))).toBe(false);
  });

  it('converts headings to ATX markdown', async () => {
    const doc = await extractDocument({ ...base, body: ARTICLE, contentType: 'text/html' });
    expect(doc.markdown).toMatch(/^## Why measurement matters$/m);
    expect(doc.headings.map((h) => h.text)).toContain('Why measurement matters');
  });

  it('reports a client-rendered shell as having no readable content', async () => {
    const doc = await extractDocument({ ...base, body: SHELL, contentType: 'text/html' });

    expect(doc.shape).toBe('empty');
    expect(doc.metrics.words).toBeLessThan(5);
    // The script is in the payload but must not be counted as content.
    expect(doc.metrics.scriptBytes).toBeGreaterThan(0);
    expect(doc.markdown).not.toContain('fetch(');
  });

  it('does not count inline script source as page content', async () => {
    // body.textContent includes <script> source. Counting it would credit a
    // client-rendered shell with the words of its own bundle, which is the
    // page where an accurate emptiness reading matters most.
    const bundle = Array.from({ length: 200 }, (_, i) => `var identifier${i} = ${i};`).join('\n');
    const shellWithBigScript = `<!doctype html><html><head><title>App</title></head>
      <body><div id="root"></div><script>${bundle}</script></body></html>`;

    const doc = await extractDocument({
      ...base,
      body: shellWithBigScript,
      contentType: 'text/html',
    });

    expect(doc.shape).toBe('empty');
    expect(doc.metrics.words).toBeLessThan(5);
    expect(doc.text).not.toContain('identifier7');
  });

  it('assumes HTML when the server sends no content-type', async () => {
    const doc = await extractDocument({ ...base, body: ARTICLE, contentType: null });
    expect(doc.shape).toBe('article');
  });

  it('renders tables as pipe tables instead of run-on text', async () => {
    const html = `<html><body><main><h1>Pricing that is long enough to be readable</h1>
      <p>The table below is the part an agent needs to answer a pricing question correctly,
         which is why flattening it into prose would be a misrepresentation of what it reads.</p>
      <table>
        <tr><th>Plan</th><th>Price</th></tr>
        <tr><td>Free</td><td>$0</td></tr>
        <tr><td>Pro</td><td>$20</td></tr>
      </table></main></body></html>`;
    const doc = await extractDocument({ ...base, body: html, contentType: 'text/html' });

    expect(doc.markdown).toContain('| Plan | Price |');
    expect(doc.markdown).toContain('| --- | --- |');
    expect(doc.markdown).toContain('| Pro | $20 |');
  });
});

describe('extractDocument on non-HTML', () => {
  it('takes markdown as-is rather than parsing it as HTML', async () => {
    const doc = await extractDocument({
      ...base,
      body: MARKDOWN,
      contentType: 'text/markdown; charset=utf-8',
    });

    expect(doc.shape).toBe('markdown');
    expect(doc.title).toBe('The Kessel Run Was Twelve Parsecs');
    expect(doc.markdown).toBe(MARKDOWN.trim());
    expect(doc.headings).toHaveLength(2);
    expect(doc.links[0]?.href).toBe('https://example.com/explanation');
  });

  it('treats a non-2xx response as an error, not as content', async () => {
    const doc = await extractDocument({
      ...base,
      status: 403,
      body: '<html><body><h1>403</h1><p>Automated access is not permitted.</p></body></html>',
      contentType: 'text/html',
    });

    expect(doc.shape).toBe('error');
    expect(doc.markdown).toBe('');
    expect(doc.metrics.words).toBe(0);
    expect(doc.error).toBe('HTTP 403');
  });

  it('surfaces a transport failure as an error document', async () => {
    const doc = await extractDocument({
      ...base,
      status: 0,
      body: '',
      contentType: null,
      error: 'net::ERR_CONNECTION_REFUSED',
    });
    expect(doc.shape).toBe('error');
    expect(doc.error).toBe('net::ERR_CONNECTION_REFUSED');
  });
});

describe('markdown parsing helpers', () => {
  it('reads headings without being fooled by fenced code', () => {
    const headings = headingsFromMarkdown('# Real\n\n```\n# Not a heading\n```\n\n## Also real');
    expect(headings).toEqual([
      { level: 1, text: 'Real' },
      { level: 2, text: 'Also real' },
    ]);
  });

  it('reads inline links with and without titles', () => {
    const links = linksFromMarkdown('[one](https://a.example) and [two](https://b.example "Title")');
    expect(links.map((l) => l.href)).toEqual(['https://a.example', 'https://b.example']);
  });
});
