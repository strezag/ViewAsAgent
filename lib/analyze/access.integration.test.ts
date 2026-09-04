import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { buildAccessReport } from './access';
import { MARKDOWN_ACCEPT, getProfile } from '../profiles';
import { EMPTY_STRUCTURED } from '../extract/structured';
import type { HeaderPair, ProbeBundle, ProbeId, ProbeResult } from '../types';

/**
 * Exercises robots parsing and affordance detection against the real fixture
 * server rather than hand-written strings, so a change to either side shows up
 * as a wrong verdict.
 *
 * `runProbes` itself needs chrome.storage and declarativeNetRequest, so the
 * probe bundle is assembled here with plain fetches. What is under test is the
 * analysis, not the transport.
 */

const PORT = 8798;
const BASE = `http://localhost:${PORT}`;
const GPTBOT = getProfile('gptbot')!;

let server: ChildProcess;

beforeAll(async () => {
  server = spawn(process.execPath, ['fixtures/server.mjs'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/ssr`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Fixture server never came up on ${BASE}`);
}, 30_000);

afterAll(() => {
  server?.kill();
});

async function probe(id: ProbeId, path: string, accept: string): Promise<ProbeResult> {
  const response = await fetch(BASE + path, {
    headers: { 'user-agent': GPTBOT.userAgent, accept },
  });
  const headers: HeaderPair[] = [];
  response.headers.forEach((value, name) => headers.push({ name, value }));

  return {
    id,
    url: BASE + path,
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get('content-type'),
    body: await response.text(),
    headers,
    elapsedMs: 0,
  };
}

async function bundleFor(pagePath: string): Promise<ProbeBundle> {
  const [robots, llms, llmsFull, sitemap, markdownAccept, dotMd, jsonLdAccept] = await Promise.all([
    probe('robots', '/robots.txt', 'text/plain'),
    probe('llms', '/llms.txt', 'text/plain'),
    probe('llmsFull', '/llms-full.txt', 'text/plain'),
    probe('sitemap', '/sitemap.xml', 'application/xml'),
    probe('markdownAccept', pagePath, MARKDOWN_ACCEPT),
    probe('dotMd', `${pagePath}.md`, '*/*'),
    probe('jsonLdAccept', pagePath, 'application/ld+json'),
  ]);
  return { robots, llms, llmsFull, sitemap, markdownAccept, dotMd, jsonLdAccept };
}

async function reportFor(pagePath: string) {
  return buildAccessReport({
    url: BASE + pagePath,
    probes: await bundleFor(pagePath),
    agentMeta: EMPTY_STRUCTURED.meta,
    browserHeaders: [],
    agentHeaders: [],
  });
}

function verdict(report: Awaited<ReturnType<typeof reportFor>>, profileId: string) {
  return report.verdicts.find((v) => v.profileId === profileId)?.verdict;
}

describe('access report against the fixture server', () => {
  it('applies per-crawler robots rules to the page being audited', async () => {
    const report = await reportFor('/blocked');

    // The fixture disallows /blocked for GPTBot specifically.
    expect(verdict(report, 'gptbot')?.allowed).toBe(false);
    expect(verdict(report, 'gptbot')?.reason).toContain('/blocked');

    // ClaudeBot and CCBot share a group that disallows everything.
    expect(verdict(report, 'claudebot')?.allowed).toBe(false);
    expect(verdict(report, 'ccbot')?.allowed).toBe(false);

    // Perplexity has no group, so it falls back to the wildcard Allow.
    expect(verdict(report, 'perplexitybot')?.allowed).toBe(true);
    expect(verdict(report, 'perplexitybot')?.matchedAgent).toBe('*');
  });

  it('lets a blocked crawler through on a path its rules do not cover', async () => {
    const report = await reportFor('/ssr');
    expect(verdict(report, 'gptbot')?.allowed).toBe(true);
    expect(verdict(report, 'claudebot')?.allowed).toBe(false);
  });

  it('finds the agent affordances the fixture publishes', async () => {
    const report = await reportFor('/negotiated');

    expect(report.affordances.markdownNegotiation).toBe(true);
    expect(report.affordances.llmsTxt).toBe(true);
    expect(report.affordances.sitemapReachable).toBe(true);
    expect(report.affordances.sitemapsDeclared).toHaveLength(1);
  });

  it('does not claim affordances the fixture does not have', async () => {
    const report = await reportFor('/ssr');

    // /ssr answers HTML regardless of Accept, and there is no /ssr.md.
    expect(report.affordances.markdownNegotiation).toBe(false);
    expect(report.affordances.dotMd).toBe(false);
    expect(report.affordances.llmsFullTxt).toBe(false);
    expect(report.affordances.jsonLdNegotiation).toBe(false);
  });

  it('reads the sitemap declaration out of robots.txt', async () => {
    const report = await reportFor('/ssr');
    expect(report.robots?.sitemaps[0]).toContain('/sitemap.xml');
    expect(report.robots?.warnings).toEqual([]);
  });
});
