// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { computeGaps } from './gaps';
import { extractDocument } from '../extract/document';
import { getProfile } from '../profiles';
import type { ExtractedDoc, RoutingOutcome } from '../types';

/**
 * The unit tests above check the analysis against hand-built documents. This
 * one runs the same pipeline over real HTTP against the fixture server, so a
 * regression in extraction, content-type handling, or classification shows up
 * as a wrong verdict rather than as a passing test on synthetic input.
 *
 * The JavaScript gap needs a browser to render document A, so it is covered by
 * the unit tests and by `npm run verify`. What is exercised here is the routing
 * gap: browser identity versus agent identity, over the wire.
 */

const PORT = 8799;
const BASE = `http://localhost:${PORT}`;

let server: ChildProcess;

async function waitForServer(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/ssr`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Fixture server never came up on ${BASE}`);
}

beforeAll(async () => {
  server = spawn(process.execPath, ['fixtures/server.mjs'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await waitForServer();
}, 30_000);

afterAll(() => {
  server?.kill();
});

/**
 * Node lets us set User-Agent directly, so this stands in for the extension's
 * declarativeNetRequest layer. What it cannot stand in for is whether that
 * layer works in Chrome — that is what `npm run verify` is for.
 */
async function fetchAs(profileId: string, path: string): Promise<ExtractedDoc> {
  const profile = getProfile(profileId);
  if (!profile) throw new Error(`Unknown profile ${profileId}`);

  const headers: Record<string, string> = { accept: profile.accept };
  if (profile.userAgent) headers['user-agent'] = profile.userAgent;

  const response = await fetch(BASE + path, { headers, redirect: 'follow' });
  const body = await response.text();

  return extractDocument({
    slot: profile.id === 'browser' ? 'rawBrowser' : 'rawAgent',
    label: profile.name,
    url: BASE + path,
    body,
    contentType: response.headers.get('content-type'),
    status: response.status,
  });
}

async function outcomeFor(path: string, agentProfile: string): Promise<RoutingOutcome> {
  const [raw, agent] = await Promise.all([fetchAs('browser', path), fetchAs(agentProfile, path)]);
  return computeGaps(null, raw, agent).outcome;
}

describe('routing gap over real HTTP', () => {
  it('sees no routing on a plain server-rendered page', async () => {
    expect(await outcomeFor('/ssr', 'gptbot')).toBe('identical');
  });

  it('detects an edge serving agents a fuller page', async () => {
    const [raw, agent] = await Promise.all([fetchAs('browser', '/routed'), fetchAs('gptbot', '/routed')]);
    const report = computeGaps(null, raw, agent);

    expect(report.outcome).toBe('optimized');
    // The browser gets a shell; the agent gets real content.
    expect(raw.metrics.words).toBeLessThan(agent.metrics.words);
    expect(agent.headings.map((h) => h.text)).toContain('Summary');
  });

  it('detects markdown content negotiation', async () => {
    const [raw, agent] = await Promise.all([
      fetchAs('browser', '/negotiated'),
      fetchAs('coding-agent-markdown', '/negotiated'),
    ]);
    const report = computeGaps(null, raw, agent);

    expect(agent.shape).toBe('markdown');
    expect(report.outcome).toBe('optimized');
    // The whole argument for markdown is that it costs the agent far less.
    expect(agent.metrics.payloadTokens).toBeLessThan(raw.metrics.payloadTokens);
  });

  it('reports a bot-blocking edge as blocked, not as empty content', async () => {
    const [raw, agent] = await Promise.all([fetchAs('browser', '/blocked'), fetchAs('claudebot', '/blocked')]);
    const report = computeGaps(null, raw, agent);

    expect(agent.status).toBe(403);
    expect(report.outcome).toBe('blocked');
    expect(report.routing.severity).toBe('critical');
    expect(raw.status).toBe(200);
  });

  it('follows an agent-only redirect to the markdown it lands on', async () => {
    const agent = await fetchAs('gptbot', '/redirected');
    expect(agent.shape).toBe('markdown');
    expect(agent.markdown).toContain('Redirect target served to agents only');
  });

  it('treats a client-rendered page as empty for every agent', async () => {
    const agent = await fetchAs('gptbot', '/csr');
    expect(agent.shape).toBe('empty');
    expect(agent.metrics.words).toBeLessThan(5);
  });
});
