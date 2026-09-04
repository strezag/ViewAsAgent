#!/usr/bin/env node
/**
 * The Phase 1 gate.
 *
 * Everything ViewAsAgent shows rests on one assumption: that a
 * declarativeNetRequest session rule can put a crawler's User-Agent on an
 * extension-initiated fetch. If that silently fails, the tool reports the human
 * page and calls it the agent's view — the worst possible failure mode, because
 * it looks like a working answer.
 *
 * Chrome will not let CDP attach to extension service workers on a normal
 * desktop build, so one step here is manual: you paste a snippet into the
 * worker's console. Everything on either side of that is automatic, including
 * the assertions, which compare two independent witnesses:
 *
 *   1. what the extension believes it sent  (posted to /__result)
 *   2. what the fixture server actually received  (/__log)
 *
 * A disagreement between those two is exactly the failure worth catching.
 *
 *   npm run verify
 */

import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const FIXTURES = process.env.FIXTURE_BASE ?? 'http://localhost:8787';
const EXTENSION_DIR =
  [
    join(process.cwd(), '.output', 'chrome-mv3-dev'),
    join(process.cwd(), '.output', 'chrome-mv3'),
  ].find((dir) => existsSync(join(dir, 'manifest.json'))) ?? null;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, condition, detail = '') {
  if (!condition) failures++;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

/** Pasted into the service worker console. Drives the real fetch path. */
const SNIPPET = `(async () => {
  const { fetchAs, getProfile, listSessionRules } = globalThis.__viewAsAgent;
  const B = ${JSON.stringify(FIXTURES)};
  const plan = [['gptbot','/ssr'],['gptbot','/routed'],['gptbot','/redirected'],['coding-agent-markdown','/negotiated'],['claudebot','/blocked'],['browser','/routed']];
  const runs = [];
  for (const [profileId, path] of plan) {
    const r = await fetchAs(getProfile(profileId), B + path);
    const h = (list, name) => (list.find(x => x.name.toLowerCase() === name) || {}).value ?? null;
    runs.push({ profileId, path, status: r.status, error: r.error ?? null, bodyLength: r.body.length,
      hops: r.trace.hops, sentUserAgent: h(r.trace.sentHeaders, 'user-agent'),
      sentAccept: h(r.trace.sentHeaders, 'accept'),
      variant: h(r.trace.responseHeaders, 'x-fixture-variant') });
  }
  const leftoverRules = (await listSessionRules()).length;
  await fetch(B + '/__result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runs, leftoverRules }) });
  console.log('ViewAsAgent: results posted. Return to the terminal.');
})()`;

function findChrome() {
  return CHROME_CANDIDATES.find((p) => existsSync(p)) ?? null;
}

async function waitForResults(timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  let lastDot = 0;
  while (Date.now() < deadline) {
    try {
      const results = await (await fetch(`${FIXTURES}/__result`)).json();
      if (results.length > 0) return results[results.length - 1];
    } catch {
      // fixture server restarting
    }
    if (Date.now() - lastDot > 5000) {
      process.stdout.write('.');
      lastDot = Date.now();
    }
    await sleep(500);
  }
  return null;
}

function assertResults(report, log) {
  const byKey = new Map(report.runs.map((r) => [`${r.profileId}${r.path}`, r]));
  const get = (profileId, path) => byKey.get(`${profileId}${path}`) ?? {};

  console.log('\n--- What the extension believes it sent ---');
  const ssr = get('gptbot', '/ssr');
  check('GPTBot fetch succeeded', ssr.status === 200, ssr.error ?? `status ${ssr.status}`);
  check(
    'the spoofed User-Agent went on the wire',
    typeof ssr.sentUserAgent === 'string' && ssr.sentUserAgent.includes('GPTBot/1.2'),
    ssr.sentUserAgent ?? 'no trace captured',
  );

  const routed = get('gptbot', '/routed');
  check('UA-routed content was served to the agent', routed.variant === 'agent', `variant=${routed.variant}`);

  const baseline = get('browser', '/routed');
  check('the browser baseline was NOT treated as a bot', baseline.variant === 'human', `variant=${baseline.variant}`);

  const md = get('coding-agent-markdown', '/negotiated');
  check(
    'Accept: text/markdown went on the wire',
    typeof md.sentAccept === 'string' && md.sentAccept.includes('text/markdown'),
    md.sentAccept ?? 'no trace captured',
  );
  check('the markdown variant came back', md.variant === 'markdown', `variant=${md.variant}`);

  const blocked = get('claudebot', '/blocked');
  check('a bot-blocking edge is reported, not hidden', blocked.status === 403, `status ${blocked.status}`);

  const redirected = get('gptbot', '/redirected');
  check(
    'the agent-conditional redirect chain was captured',
    Array.isArray(redirected.hops) && redirected.hops.length === 1 && redirected.hops[0].statusCode === 302,
    JSON.stringify(redirected.hops ?? null),
  );

  check('no session rules leaked', report.leftoverRules === 0, `${report.leftoverRules} still installed`);

  console.log('\n--- What the server actually received ---');
  const gptbotHits = log.filter((e) => (e.userAgent ?? '').includes('GPTBot/1.2'));
  check('server logged the GPTBot identity', gptbotHits.length >= 3, `${gptbotHits.length} request(s)`);
  check(
    'client-hint headers were stripped',
    gptbotHits.length > 0 && gptbotHits.every((e) => e.secChUa === null),
    gptbotHits.map((e) => e.secChUa).join(',') || 'all null',
  );
  check('no Referer was sent', gptbotHits.every((e) => e.referer === null));
  check('no cookies were sent', log.every((e) => e.hasCookie === false));
  check(
    'server saw the markdown Accept header',
    log.some((e) => (e.accept ?? '').includes('text/markdown')),
  );
  check(
    'server classified the baseline request as human',
    log.some((e) => e.path === '/routed' && !e.classifiedAsBot),
  );
}

const main = async () => {
  if (!EXTENSION_DIR) {
    throw new Error('No build found. Run: npx wxt build --mode development');
  }
  let fixtures = null;
  const fixturesUp = async () => {
    try {
      return (await fetch(`${FIXTURES}/__log`)).ok;
    } catch {
      return false;
    }
  };

  if (!(await fixturesUp())) {
    console.log('Fixture server is not running — starting one.');
    fixtures = spawn(process.execPath, ['fixtures/server.mjs'], { stdio: 'ignore' });
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !(await fixturesUp())) await sleep(200);
    if (!(await fixturesUp())) {
      fixtures.kill();
      throw new Error(`Could not start the fixture server at ${FIXTURES}.`);
    }
  }
  await fetch(`${FIXTURES}/__log/reset`);

  const chromePath = findChrome();
  let chrome = null;
  if (chromePath) {
    const profileDir = await mkdtemp(join(tmpdir(), 'viewasagent-'));
    chrome = spawn(
      chromePath,
      [
        `--user-data-dir=${profileDir}`,
        `--load-extension=${EXTENSION_DIR}`,
        `--disable-extensions-except=${EXTENSION_DIR}`,
        '--no-first-run',
        '--no-default-browser-check',
        'chrome://extensions',
      ],
      { stdio: 'ignore', detached: false },
    );
    console.log(`Launched Chrome with a throwaway profile and the extension loaded.`);
  } else {
    console.log('No Chrome found automatically — load the extension yourself.');
  }

  console.log(`
Extension: ${EXTENSION_DIR}

  1. In the Chrome window that just opened, turn on Developer mode
     (top right of chrome://extensions) if it is not already on.
  2. On the ViewAsAgent card, click "service worker" to open its console.
     If the link is missing, click the reload icon on the card first.
  3. Paste this into that console and press Enter:

${SNIPPET}

Waiting for results`);

  const report = await waitForResults();
  console.log('');

  if (!report) {
    throw new Error('Timed out waiting for results. Nothing was posted to /__result.');
  }

  const log = await (await fetch(`${FIXTURES}/__log`)).json();
  assertResults(report, log);

  console.log(
    failures === 0
      ? '\nHeader spoofing verified end to end. Both witnesses agree.'
      : `\n${failures} check(s) failed — do not trust agent output until these pass.`,
  );
  process.exitCode = failures === 0 ? 0 : 1;

  chrome?.kill();
  fixtures?.kill();
};

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exitCode = 1;
});
