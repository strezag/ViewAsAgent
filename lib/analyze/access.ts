import type {
  AccessReport,
  AgentAffordances,
  CrawlDirectives,
  HeaderPair,
  PageMeta,
  ProbeBundle,
  ProbeResult,
  RobotsFile,
  RobotsVerdictRow,
} from '../types';
import { AGENT_PROFILES } from '../profiles';
import { buildEdgeReport } from './edge';
import { isAllowed, parseRobots, robotsPath } from './robots';

export interface AccessInput {
  url: string;
  probes: ProbeBundle;
  /** Meta tags as the agent received them, not as the rendered page has them. */
  agentMeta: PageMeta;
  browserHeaders: HeaderPair[];
  agentHeaders: HeaderPair[];
}

export function buildAccessReport(input: AccessInput): AccessReport {
  const robotsProbe = input.probes.robots;
  const robots = readRobots(robotsProbe);
  const path = robotsPath(input.url);

  const verdicts: RobotsVerdictRow[] = AGENT_PROFILES.map((profile) => ({
    profileId: profile.id,
    name: profile.name,
    vendor: profile.vendor,
    category: profile.category,
    verdict: isAllowed(robots, profile.robotsToken, path),
  }));

  return {
    robots,
    robotsStatus: robotsProbe.status,
    verdicts,
    directives: readDirectives(input.agentMeta, input.agentHeaders),
    affordances: readAffordances(input.probes, robots),
    edge: buildEdgeReport(input.browserHeaders, input.agentHeaders),
  };
}

/**
 * A missing robots.txt means "everything is allowed", but a server that answers
 * every path with an HTML page means we never actually saw one — treating that
 * markup as directives would invent rules that do not exist.
 */
function readRobots(probe: ProbeResult): RobotsFile | null {
  if (!probe.ok || !probe.body.trim()) return null;
  if (looksLikeHtml(probe.body)) return null;
  const parsed = parseRobots(probe.body);
  return parsed.empty && parsed.sitemaps.length === 0 ? null : parsed;
}

function readDirectives(meta: PageMeta, headers: HeaderPair[]): CrawlDirectives {
  const metaRobots = tokenize(meta.metaRobots);

  const xRobotsTag = headers
    .filter((h) => h.name.toLowerCase() === 'x-robots-tag')
    .flatMap((h) => tokenize(stripAgentPrefix(h.value)));

  const all = new Set([...metaRobots, ...xRobotsTag]);

  return {
    metaRobots,
    xRobotsTag,
    noindex: all.has('noindex'),
    nosnippet: all.has('nosnippet'),
    noai: all.has('noai'),
    noimageai: all.has('noimageai'),
  };
}

/** `X-Robots-Tag: googlebot: noindex` scopes the directive to one crawler. */
function stripAgentPrefix(value: string): string {
  const separator = value.indexOf(':');
  if (separator === -1) return value;
  const head = value.slice(0, separator).trim();
  // A directive never contains a space; a user-agent prefix usually does not
  // either, so only treat it as a prefix when the tail has real content.
  const tail = value.slice(separator + 1).trim();
  return tail && !head.includes(',') ? tail : value;
}

function tokenize(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

function readAffordances(probes: ProbeBundle, robots: RobotsFile | null): AgentAffordances {
  return {
    llmsTxt: servedAsText(probes.llms),
    llmsFullTxt: servedAsText(probes.llmsFull),
    markdownNegotiation: servedAsMarkdown(probes.markdownAccept),
    dotMd: servedAsMarkdown(probes.dotMd) || servedAsText(probes.dotMd),
    jsonLdNegotiation: servedAsJson(probes.jsonLdAccept),
    sitemapsDeclared: robots?.sitemaps ?? [],
    sitemapReachable: servedAsSitemap(probes.sitemap),
  };
}

/**
 * Single-page apps commonly answer every unknown path with 200 and their shell,
 * so a 200 alone proves nothing. Each of these checks the body as well.
 */
function servedAsText(probe: ProbeResult): boolean {
  if (!probe.ok || !probe.body.trim()) return false;
  if (looksLikeHtml(probe.body)) return false;
  return !/text\/html/i.test(probe.contentType ?? '');
}

function servedAsMarkdown(probe: ProbeResult): boolean {
  if (!probe.ok || !probe.body.trim()) return false;
  if (looksLikeHtml(probe.body)) return false;
  if (/text\/(markdown|x-markdown)/i.test(probe.contentType ?? '')) return true;
  // Some servers send markdown as text/plain. Require real markdown structure
  // rather than accepting any plain text.
  if (!/text\/plain/i.test(probe.contentType ?? '')) return false;
  return /^#{1,6}\s/m.test(probe.body) || /^\s*[-*]\s+\S/m.test(probe.body);
}

function servedAsJson(probe: ProbeResult): boolean {
  if (!probe.ok || !probe.body.trim()) return false;
  if (!/application\/(ld\+json|json)/i.test(probe.contentType ?? '')) return false;
  try {
    JSON.parse(probe.body);
    return true;
  } catch {
    return false;
  }
}

function servedAsSitemap(probe: ProbeResult): boolean {
  if (!probe.ok || !probe.body.trim()) return false;
  return /<urlset|<sitemapindex/i.test(probe.body);
}

export function looksLikeHtml(body: string): boolean {
  const head = body.slice(0, 500).trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.includes('<head>');
}
