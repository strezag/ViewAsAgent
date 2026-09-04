import { send } from '@/lib/messaging';
import { computeGaps } from '@/lib/analyze/gaps';
import { buildAccessReport } from '@/lib/analyze/access';
import { buildFindings, evaluableCategories } from '@/lib/analyze/findings';
import { scoreAudit } from '@/lib/analyze/score';
import { isAllowed, parseRobots, robotsPath } from '@/lib/analyze/robots';
export { mostInterestingAgent } from '@/lib/analyze/divergence';
import { looksLikeHtml } from '@/lib/analyze/access';
import { extractDocument } from '@/lib/extract/document';
import { extractStructuredData, EMPTY_STRUCTURED } from '@/lib/extract/structured';
import { parseHtml } from '@/lib/extract/html';
import { type RenderedCapture } from '@/lib/capture/renderedDom';
import { AGENT_PROFILES, getProfile } from '@/lib/profiles';
import type {
  AccessReport,
  AgentMatrixRow,
  AgentProfile,
  AgentResponse,
  AuditFacts,
  ExtractedDoc,
  Finding,
  GapReport,
  ProbeBundle,
  ReadinessScore,
  RobotsFile,
  StructuredData,
} from '@/lib/types';

/**
 * Retrieval crawlers decide what assistants say about you today, so they are
 * fetched first and their rows stream in while the rest are still running. A
 * sweep is unavoidably serial — agentFetch serialises same-URL requests because
 * the header rule and the trace recorder are both keyed by URL — so ordering is
 * what keeps it from feeling slow.
 */
export const SWEEP_ORDER: AgentProfile[] = [
  ...AGENT_PROFILES.filter((p) => p.category === 'retrieval'),
  ...AGENT_PROFILES.filter((p) => p.category === 'coding'),
  ...AGENT_PROFILES.filter((p) => p.category === 'training'),
];

/** The profile used for the one-off origin probes (robots, llms.txt, sitemap). */
const PROBE_PROFILE_ID = 'oai-searchbot';

/** Everything the sweep establishes once and every focused audit reuses. */
export interface SweepContext {
  url: string;
  capture: RenderedCapture | null;
  renderedError?: string;
  /** Document A. */
  rendered: ExtractedDoc | null;
  /** Document B. */
  raw: ExtractedDoc;
  browserResponse: AgentResponse;
  probes: ProbeBundle;
  robots: RobotsFile | null;
}

export interface Sweep {
  context: SweepContext;
  rows: AgentMatrixRow[];
  /** Full responses kept so focusing an agent needs no second fetch. */
  responses: Record<string, AgentResponse>;
  docs: Record<string, ExtractedDoc>;
}

export interface Audit {
  url: string;
  profile: AgentProfile;
  at: number;
  rendered: ExtractedDoc | null;
  renderedError?: string;
  raw: ExtractedDoc;
  /** Document C. */
  agent: ExtractedDoc;
  responses: { browser: AgentResponse; agent: AgentResponse };
  gaps: GapReport;
  probes: ProbeBundle;
  access: AccessReport;
  structured: { rendered: StructuredData | null; agent: StructuredData };
  facts: AuditFacts;
  findings: Finding[];
  score: ReadinessScore;
}

export interface SweepOptions {
  tabId: number;
  url: string;
  onStep?: (step: string) => void;
  /** Called as each agent's result lands, so the matrix can fill in live. */
  onRow?: (row: AgentMatrixRow, done: number, total: number) => void;
}

/**
 * Fetch the page as every agent and report what each one received.
 *
 * This is the product's primary question. Comparable tools audit what a site
 * declares about itself; none of them fetch as each crawler and diff the
 * results, which is the only way to discover that one vendor is blocked while
 * the rest sail through.
 */
export async function runSweep({ tabId, url, onStep, onRow }: SweepOptions): Promise<Sweep> {
  onStep?.('Reading the rendered page…');
  let capture: RenderedCapture | null = null;
  let renderedError: string | undefined;
  try {
    capture = await send<RenderedCapture>({ type: 'CAPTURE_RENDERED', tabId });
  } catch (err) {
    renderedError = err instanceof Error ? err.message : String(err);
  }

  onStep?.('Fetching as your browser…');
  const browserResponse = await send<AgentResponse>({
    type: 'FETCH_AS',
    profileId: 'browser',
    url,
  });

  onStep?.('Checking robots, llms.txt, and markdown negotiation…');
  const probes = await send<ProbeBundle>({
    type: 'RUN_PROBES',
    url,
    profileId: PROBE_PROFILE_ID,
  });
  const robots = readRobots(probes);

  const [rendered, raw] = await Promise.all([
    capture
      ? extractDocument({
          slot: 'rendered',
          label: 'What you see',
          url: capture.url,
          body: capture.html,
          contentType: 'text/html',
          status: 200,
        })
      : Promise.resolve(null),
    extractDocument({
      slot: 'rawBrowser',
      label: 'Raw HTML',
      url: browserResponse.finalUrl,
      body: browserResponse.body,
      contentType: browserResponse.contentType,
      status: browserResponse.status,
      error: browserResponse.error,
    }),
  ]);

  const context: SweepContext = {
    url,
    capture,
    renderedError,
    rendered,
    raw,
    browserResponse,
    probes,
    robots,
  };

  const path = robotsPath(url);
  const rows: AgentMatrixRow[] = [];
  const responses: Record<string, AgentResponse> = {};
  const docs: Record<string, ExtractedDoc> = {};
  const total = SWEEP_ORDER.length;

  for (const [index, profile] of SWEEP_ORDER.entries()) {
    onStep?.(`Fetching as ${profile.name}…`);
    const robotsAllowed = isAllowed(robots, profile.robotsToken, path).allowed;

    try {
      const response = await send<AgentResponse>({
        type: 'FETCH_AS',
        profileId: profile.id,
        url,
      });
      const doc = await extractDocument({
        slot: 'rawAgent',
        label: profile.name,
        url: response.finalUrl,
        body: response.body,
        contentType: response.contentType,
        status: response.status,
        error: response.error,
      });

      responses[profile.id] = response;
      docs[profile.id] = doc;

      const row: AgentMatrixRow = {
        profileId: profile.id,
        name: profile.name,
        vendor: profile.vendor,
        category: profile.category,
        status: doc.status,
        words: doc.metrics.words,
        tokens: doc.metrics.tokens,
        shape: doc.shape,
        contentType: doc.contentType,
        outcome: computeGaps(null, raw, doc).outcome,
        robotsAllowed,
        ...(doc.error ? { error: doc.error } : {}),
      };
      rows.push(row);
      onRow?.(row, index + 1, total);
    } catch (err) {
      const row: AgentMatrixRow = {
        profileId: profile.id,
        name: profile.name,
        vendor: profile.vendor,
        category: profile.category,
        status: 0,
        words: 0,
        tokens: 0,
        shape: 'error',
        contentType: null,
        outcome: 'blocked',
        robotsAllowed,
        error: err instanceof Error ? err.message : String(err),
      };
      rows.push(row);
      onRow?.(row, index + 1, total);
    }
  }

  return { context, rows, responses, docs };
}

/**
 * The deep audit for one agent, built from what the sweep already fetched — no
 * second request to the origin.
 */
export async function focusAgent(sweep: Sweep, profileId: string): Promise<Audit> {
  const profile = getProfile(profileId);
  if (!profile) throw new Error(`Unknown agent profile: ${profileId}`);

  const { context } = sweep;
  const agentResponse = sweep.responses[profileId];
  const agent = sweep.docs[profileId];
  if (!agentResponse || !agent) {
    throw new Error(`${profile.name} was not part of the sweep.`);
  }

  const structured = {
    rendered: context.capture
      ? structuredFrom(context.capture.html, context.capture.url)
      : null,
    agent: structuredFrom(agentResponse.body, agentResponse.finalUrl),
  };

  const access = buildAccessReport({
    url: context.url,
    probes: context.probes,
    agentMeta: structured.agent.meta,
    browserHeaders: context.browserResponse.trace.responseHeaders,
    agentHeaders: agentResponse.trace.responseHeaders,
  });

  const gaps = computeGaps(context.rendered, context.raw, agent);

  const facts: AuditFacts = {
    url: context.url,
    profileName: profile.name,
    profileCategory: profile.category,
    profileRendersJavaScript: profile.rendersJavaScript,
    rendered: context.rendered,
    raw: context.raw,
    agent,
    gaps,
    access,
    structured,
    redirectedOnlyForAgent:
      agentResponse.trace.hops.length > 0 && context.browserResponse.trace.hops.length === 0,
  };

  const findings = buildFindings(facts);

  return {
    url: context.url,
    profile,
    at: Date.now(),
    rendered: context.rendered,
    renderedError: context.renderedError,
    raw: context.raw,
    agent,
    responses: { browser: context.browserResponse, agent: agentResponse },
    gaps,
    probes: context.probes,
    access,
    structured,
    facts,
    findings,
    score: scoreAudit(findings, evaluableCategories(facts)),
  };
}

/** robots.txt, guarded against servers that answer every path with their shell. */
function readRobots(probes: ProbeBundle): RobotsFile | null {
  const probe = probes.robots;
  if (!probe.ok || !probe.body.trim() || looksLikeHtml(probe.body)) return null;
  const parsed = parseRobots(probe.body);
  return parsed.empty && parsed.sitemaps.length === 0 ? null : parsed;
}

/** Markdown and error responses have no markup to read structured data from. */
function structuredFrom(body: string, url: string): StructuredData {
  if (!body.trim()) return EMPTY_STRUCTURED;
  try {
    return extractStructuredData(parseHtml(body, { baseUrl: url }));
  } catch {
    return EMPTY_STRUCTURED;
  }
}
