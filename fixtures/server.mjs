#!/usr/bin/env node
/**
 * Deterministic test surface for ViewAsAgent.
 *
 * Every route is a deliberately different answer to the same question — "what
 * does this server hand a non-browser client?" — so each analysis path has a
 * known-good target. Crucially the server logs the inbound User-Agent and
 * Accept for every request: that log is the ground truth that the
 * declarativeNetRequest header rule actually applied. Nothing else in the
 * system can prove that.
 *
 *   npm run fixtures      # http://localhost:8787
 */

import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8787);

const BOT_PATTERN =
  /(gptbot|claudebot|oai-searchbot|chatgpt-user|claude-searchbot|claude-user|perplexity|bytespider|ccbot|googlebot|bingbot|amazonbot|applebot|meta-externalagent)/i;

/** Rolling request log, newest last. Readable at /__log for assertions. */
const log = [];
/** Results the extension posts back to /__result during verification. */
const results = [];

function isBot(userAgent = '') {
  return BOT_PATTERN.test(userAgent);
}

function wantsMarkdown(accept = '') {
  return /text\/markdown/i.test(accept);
}

function page(title, bodyHtml, extraHead = '') {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="description" content="ViewAsAgent fixture: ${title}">
${extraHead}
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

const JSON_LD = `<script type="application/ld+json">
${JSON.stringify(
  {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: 'Server-rendered fixture',
    author: { '@type': 'Organization', name: 'ViewAsAgent Fixtures' },
    datePublished: '2026-01-15',
    description: 'A fully server-rendered page with valid structured data.',
  },
  null,
  2,
)}
</script>`;

const ARTICLE_BODY = `
<header><h1>The Kessel Run Was Twelve Parsecs</h1></header>
<main>
  <p>This paragraph exists in the HTML the server sends. Every crawler can read it.</p>
  <h2>Why measurement matters</h2>
  <p>A parsec is a unit of distance, not time, which is the entire joke.</p>
  <ul><li>Server-rendered</li><li>Structured data present</li><li>No JavaScript required</li></ul>
</main>
<footer><p>Fixture footer.</p></footer>`;

const routes = {
  '/': () => ({
    status: 200,
    type: 'text/html; charset=utf-8',
    body: page(
      'ViewAsAgent fixtures',
      `<h1>ViewAsAgent fixtures</h1>
<ul>
  <li><a href="/ssr">/ssr</a> — fully server-rendered, no gap on either axis</li>
  <li><a href="/csr">/csr</a> — client-rendered, large JavaScript gap</li>
  <li><a href="/routed">/routed</a> — UA-sniffed, agents get optimized HTML</li>
  <li><a href="/negotiated">/negotiated</a> — answers Accept: text/markdown</li>
  <li><a href="/blocked">/blocked</a> — 403 to bot user agents</li>
  <li><a href="/redirected">/redirected</a> — redirects bots to a markdown file</li>
  <li><a href="/__log">/__log</a> — what this server actually received</li>
</ul>`,
    ),
  }),

  // Baseline: A, B and C should all agree.
  '/ssr': () => ({
    status: 200,
    type: 'text/html; charset=utf-8',
    body: page('Server-rendered fixture', ARTICLE_BODY, JSON_LD),
  }),

  // The JavaScript gap. The article text must not appear anywhere in this
  // response — not even inside a script string — or the shell is not a true
  // control. So the content arrives over a second request the crawler never
  // makes, which is also how most real client-rendered apps behave.
  '/csr': () => ({
    status: 200,
    type: 'text/html; charset=utf-8',
    body: page(
      'Client-rendered fixture',
      `<div id="root"></div>
<script>
  fetch('/api/article')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      document.getElementById('root').innerHTML = data.html;
      document.title = data.title;
      var ld = document.createElement('script');
      ld.type = 'application/ld+json';
      ld.textContent = JSON.stringify(data.jsonLd);
      document.head.appendChild(ld);
    });
</script>`,
    ),
  }),

  '/api/article': () => ({
    status: 200,
    type: 'application/json; charset=utf-8',
    body: JSON.stringify({
      title: 'The Kessel Run Was Twelve Parsecs',
      html: ARTICLE_BODY,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: 'Injected far too late for any crawler to see',
      },
    }),
  }),

  // The routing gap, positive: this is what working AXP-style middleware does.
  '/routed': (req) => {
    if (isBot(req.headers['user-agent'])) {
      return {
        status: 200,
        type: 'text/html; charset=utf-8',
        headers: { 'x-fixture-variant': 'agent', 'x-fixture-optimizer': 'demo-axp/1.0' },
        body: page(
          'Optimized for agents',
          `<h1>The Kessel Run Was Twelve Parsecs</h1>
<section id="summary"><h2>Summary</h2><p>A parsec measures distance. The claim is about route efficiency, not speed.</p></section>
${ARTICLE_BODY}`,
          JSON_LD,
        ),
      };
    }
    return {
      status: 200,
      type: 'text/html; charset=utf-8',
      headers: { 'x-fixture-variant': 'human' },
      body: page(
        'Routed fixture',
        `<div id="root"></div>
<script>
  fetch('/api/article')
    .then(function (r) { return r.json(); })
    .then(function (data) { document.getElementById('root').innerHTML = data.html; });
</script>`,
      ),
    };
  },

  // Content negotiation, as Cloudflare and Vercel now do it.
  '/negotiated': (req) => {
    if (wantsMarkdown(req.headers.accept)) {
      return {
        status: 200,
        type: 'text/markdown; charset=utf-8',
        headers: { vary: 'Accept', 'x-fixture-variant': 'markdown' },
        body: `# The Kessel Run Was Twelve Parsecs

This paragraph exists in the HTML the server sends. Every crawler can read it.

## Why measurement matters

A parsec is a unit of distance, not time, which is the entire joke.

- Server-rendered
- Structured data present
- No JavaScript required
`,
      };
    }
    return {
      status: 200,
      type: 'text/html; charset=utf-8',
      headers: { vary: 'Accept', 'x-fixture-variant': 'html' },
      body: page('Negotiated fixture', ARTICLE_BODY, JSON_LD),
    };
  },

  // The routing gap, negative: agents get nothing.
  '/blocked': (req) => {
    if (isBot(req.headers['user-agent'])) {
      return {
        status: 403,
        type: 'text/html; charset=utf-8',
        headers: { 'x-fixture-variant': 'blocked' },
        body: page('Forbidden', '<h1>403</h1><p>Automated access is not permitted.</p>'),
      };
    }
    return {
      status: 200,
      type: 'text/html; charset=utf-8',
      headers: { 'x-fixture-variant': 'human' },
      body: page('Blocked fixture', ARTICLE_BODY, JSON_LD),
    };
  },

  // UA-conditional redirect — only visible via the webRequest trace.
  '/redirected': (req) => {
    if (isBot(req.headers['user-agent'])) {
      return { status: 302, type: 'text/plain', headers: { location: '/llms/page.md' }, body: '' };
    }
    return { status: 200, type: 'text/html; charset=utf-8', body: page('Redirect fixture', ARTICLE_BODY) };
  },

  '/llms/page.md': () => ({
    status: 200,
    type: 'text/markdown; charset=utf-8',
    body: '# The Kessel Run Was Twelve Parsecs\n\nRedirect target served to agents only.\n',
  }),

  '/robots.txt': () => ({
    status: 200,
    type: 'text/plain; charset=utf-8',
    body: `User-agent: *
Allow: /

User-agent: GPTBot
Disallow: /blocked
Disallow: /private/

User-agent: ClaudeBot
Disallow: /

User-agent: CCBot
Disallow: /

Sitemap: http://localhost:${PORT}/sitemap.xml
`,
  }),

  '/llms.txt': () => ({
    status: 200,
    type: 'text/plain; charset=utf-8',
    body: `# ViewAsAgent fixtures

> A local server that answers differently depending on who is asking.

## Pages
- [Server rendered](http://localhost:${PORT}/ssr): the control case
- [Negotiated](http://localhost:${PORT}/negotiated): answers Accept: text/markdown
`,
  }),

  '/sitemap.xml': () => ({
    status: 200,
    type: 'application/xml; charset=utf-8',
    body: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>http://localhost:${PORT}/ssr</loc></url>
  <url><loc>http://localhost:${PORT}/negotiated</loc></url>
</urlset>`,
  }),

  '/__log': () => ({
    status: 200,
    type: 'application/json; charset=utf-8',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(log, null, 2),
  }),

  '/__log/reset': () => {
    log.length = 0;
    results.length = 0;
    return { status: 200, type: 'application/json', body: '{"ok":true}' };
  },

  /**
   * The verification harness closes the loop here: the extension posts what it
   * *thinks* happened, and the request log records what actually arrived. A
   * disagreement between the two is the failure we care most about catching.
   */
  '/__result': (req, body) => {
    if (req.method === 'POST') {
      try {
        results.push(JSON.parse(body));
      } catch {
        return { status: 400, type: 'application/json', body: '{"ok":false}' };
      }
      return {
        status: 200,
        type: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: '{"ok":true}',
      };
    }
    return {
      status: 200,
      type: 'application/json; charset=utf-8',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(results, null, 2),
    };
  },
};

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const route = routes[url.pathname];

  // The extension posts verification results cross-origin.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    res.end();
    return;
  }

  const entry = {
    at: new Date().toISOString(),
    method: req.method,
    path: url.pathname,
    userAgent: req.headers['user-agent'] ?? null,
    accept: req.headers.accept ?? null,
    acceptLanguage: req.headers['accept-language'] ?? null,
    secChUa: req.headers['sec-ch-ua'] ?? null,
    secFetchMode: req.headers['sec-fetch-mode'] ?? null,
    referer: req.headers.referer ?? null,
    hasCookie: Boolean(req.headers.cookie),
    classifiedAsBot: isBot(req.headers['user-agent']),
  };

  // Harness endpoints are plumbing, not traffic under test.
  if (!url.pathname.startsWith('/__')) {
    log.push(entry);
    if (log.length > 500) log.shift();
    const tell = entry.classifiedAsBot ? 'BOT ' : 'human';
    console.log(`${tell} ${req.method} ${url.pathname}  ua=${entry.userAgent}  accept=${entry.accept}`);
  }

  if (!route) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const body = req.method === 'POST' ? await readBody(req) : '';
  const result = route(req, body);
  res.writeHead(result.status, {
    'content-type': result.type,
    'cache-control': 'no-store',
    'x-fixture-server': 'viewasagent',
    ...(result.headers ?? {}),
  });
  res.end(result.body);
});

server.listen(PORT, () => {
  console.log(`ViewAsAgent fixtures on http://localhost:${PORT}`);
  console.log('Request log at /__log — this is the ground truth for header spoofing.\n');
});
