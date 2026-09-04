#!/usr/bin/env node
/**
 * Asserts the fixture server actually behaves the way the extension's tests
 * assume. If this drifts, every downstream result is measuring the wrong thing.
 *
 *   node fixtures/server.mjs &   # then:
 *   node fixtures/selfcheck.mjs
 */

const BASE = process.env.FIXTURE_BASE ?? 'http://localhost:8787';

const BOT =
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot';
const HUMAN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MD = 'text/markdown,text/plain;q=0.9,text/html;q=0.8';

let failures = 0;

function check(name, condition, detail = '') {
  if (!condition) failures++;
  const mark = condition ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${name}${detail ? `  (${detail})` : ''}`);
}

function get(path, ua, accept = 'text/html', redirect = 'follow') {
  return fetch(BASE + path, { headers: { 'user-agent': ua, accept }, redirect });
}

const run = async () => {
  const ssr = await (await get('/ssr', HUMAN)).text();
  check('/ssr serves article HTML with JSON-LD', ssr.includes('Kessel Run') && ssr.includes('application/ld+json'));

  const csr = await (await get('/csr', HUMAN)).text();
  check('/csr raw HTML is an empty shell', csr.includes('id="root"') && !csr.includes('Kessel Run') && !csr.includes('<main>'));

  const routedBotRes = await get('/routed', BOT);
  const routedBot = await routedBotRes.text();
  const routedHuman = await (await get('/routed', HUMAN)).text();
  check(
    '/routed gives bots the optimized variant',
    routedBot.includes('id="summary"') && !routedHuman.includes('id="summary"'),
  );
  check(
    '/routed marks the variant in response headers',
    routedBotRes.headers.get('x-fixture-variant') === 'agent',
    routedBotRes.headers.get('x-fixture-optimizer') ?? '',
  );

  const negMd = await get('/negotiated', BOT, MD);
  const negHtml = await get('/negotiated', BOT, 'text/html');
  check('/negotiated answers Accept: text/markdown', (negMd.headers.get('content-type') ?? '').includes('text/markdown'));
  check('/negotiated still serves HTML otherwise', (negHtml.headers.get('content-type') ?? '').includes('text/html'));
  check('/negotiated sets Vary: Accept', negMd.headers.get('vary') === 'Accept');

  const blockedBot = await get('/blocked', BOT);
  const blockedHuman = await get('/blocked', HUMAN);
  check(
    '/blocked 403s bots only',
    blockedBot.status === 403 && blockedHuman.status === 200,
    `${blockedBot.status} vs ${blockedHuman.status}`,
  );

  const redirBot = await get('/redirected', BOT, 'text/html', 'manual');
  const redirHuman = await get('/redirected', HUMAN, 'text/html', 'manual');
  check(
    '/redirected 302s bots to markdown',
    redirBot.status === 302 && redirBot.headers.get('location') === '/llms/page.md',
  );
  check('/redirected leaves humans alone', redirHuman.status === 200);

  const robots = await (await get('/robots.txt', HUMAN)).text();
  check(
    '/robots.txt has per-bot groups',
    robots.includes('User-agent: GPTBot') && robots.includes('User-agent: ClaudeBot'),
  );

  const llms = await (await get('/llms.txt', HUMAN)).text();
  check('/llms.txt present', llms.startsWith('# ViewAsAgent fixtures'));

  const log = await (await fetch(`${BASE}/__log`)).json();
  const botEntries = log.filter((e) => e.classifiedAsBot);
  check(
    'request log captured UA and Accept',
    log.length > 0 && botEntries.length > 0 && botEntries[0].accept !== null,
    `${log.length} entries, ${botEntries.length} classified as bot`,
  );

  console.log(failures === 0 ? '\nAll fixture checks passed.' : `\n${failures} fixture check(s) failed.`);
  process.exitCode = failures === 0 ? 0 : 1;
};

run().catch((err) => {
  console.error('Self-check could not run:', err.message);
  console.error(`Is the fixture server running at ${BASE}?`);
  process.exitCode = 1;
});
