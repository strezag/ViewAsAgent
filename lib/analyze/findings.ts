import type { AuditFacts, Finding, ScoreCategory } from '../types';

/**
 * The rules that turn measurements into things a person can act on.
 *
 * Two principles hold this together. Every deduction is a named finding with a
 * fix, so a score is never a number someone has to take on faith. And findings
 * that are good news are reported alongside the problems — an audit that only
 * lists faults reads as a complaint and tells nobody what not to break.
 */

const LEVEL_ORDER = { critical: 0, warning: 1, notice: 2, good: 3 } as const;

const CATEGORY_ORDER: ScoreCategory[] = [
  'reachability',
  'fidelity',
  'structured',
  'efficiency',
  'affordances',
];

/**
 * Which score categories this audit could actually measure.
 *
 * When the agent never received a document, its content, structured data, and
 * size are not "fine" — they are unknown. Reporting them as perfect would hand
 * a comfortable score to a page no agent can read. The origin-level affordances
 * are separate requests, so they survive a blocked page.
 */
export function evaluableCategories(facts: AuditFacts): ScoreCategory[] {
  if (facts.agent.shape === 'error' || facts.gaps.outcome === 'blocked') {
    return ['reachability', 'affordances'];
  }
  return CATEGORY_ORDER;
}

export function buildFindings(facts: AuditFacts): Finding[] {
  const findings = [
    ...reachabilityFindings(facts),
    ...fidelityFindings(facts),
    ...structuredFindings(facts),
    ...efficiencyFindings(facts),
    ...affordanceFindings(facts),
  ].filter((f): f is Finding => f !== null);

  return findings.sort((a, b) => {
    const byLevel = LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level];
    if (byLevel !== 0) return byLevel;
    const byPoints = b.points - a.points;
    if (byPoints !== 0) return byPoints;
    return CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
  });
}

// ---------------------------------------------------------------------------
// Reachability — can the agent get the page at all
// ---------------------------------------------------------------------------

function reachabilityFindings(facts: AuditFacts): (Finding | null)[] {
  const { agent, access, profileName, profileCategory } = facts;
  const out: (Finding | null)[] = [];

  if (facts.gaps.outcome === 'blocked') {
    out.push({
      id: 'agent-blocked',
      level: 'critical',
      category: 'reachability',
      title: `${profileName} cannot fetch this page`,
      evidence: agent.error ?? `The request returned HTTP ${agent.status}.`,
      fix: 'Check WAF rules, rate limiting, and bot management for this user agent. Everything else on this page is moot until the fetch succeeds.',
      points: 60,
    });
  }

  const own = access.verdicts.find((v) => v.name === profileName);
  if (own && !own.verdict.allowed) {
    // A blocked training crawler is often a deliberate licensing decision. A
    // blocked retrieval crawler removes you from answers people see today.
    const deliberate = profileCategory === 'training';
    out.push({
      id: 'robots-blocked',
      level: deliberate ? 'notice' : 'critical',
      category: 'reachability',
      title: `robots.txt blocks ${profileName}`,
      evidence: own.verdict.reason,
      fix: deliberate
        ? 'If opting out of training was the intent, this is working. Confirm it does not also cover the retrieval crawlers that produce citations.'
        : 'This crawler feeds answers users see now. Allow it unless the block is deliberate.',
      points: deliberate ? 0 : 40,
    });
  }

  const blockedRetrieval = access.verdicts.filter(
    (v) => v.category === 'retrieval' && !v.verdict.allowed,
  );
  if (blockedRetrieval.length >= 3) {
    out.push({
      id: 'retrieval-blocked-broadly',
      level: 'critical',
      category: 'reachability',
      title: `${blockedRetrieval.length} retrieval crawlers are blocked`,
      evidence: `Blocked: ${blockedRetrieval.map((v) => v.name).join(', ')}.`,
      fix: 'Retrieval crawlers decide whether assistants can cite you at all. Blocking them is a much bigger decision than blocking training crawlers.',
      points: 25,
    });
  }

  if (access.directives.noindex) {
    out.push({
      id: 'noindex',
      level: 'warning',
      category: 'reachability',
      title: 'This page asks not to be indexed',
      evidence: `noindex is set via ${access.directives.metaRobots.includes('noindex') ? 'the robots meta tag' : 'the X-Robots-Tag header'}.`,
      fix: 'Remove noindex if this page should appear in search or AI answers.',
      points: 30,
    });
  }

  if (access.directives.noai || access.directives.noimageai) {
    out.push({
      id: 'noai',
      level: 'notice',
      category: 'reachability',
      title: 'An AI opt-out directive is set',
      evidence: [access.directives.noai && 'noai', access.directives.noimageai && 'noimageai']
        .filter(Boolean)
        .join(', '),
      fix: 'Nothing to fix if this is deliberate. Note that support for these tokens is inconsistent — robots.txt is the directive crawlers actually honour.',
      points: 0,
    });
  }

  if (facts.redirectedOnlyForAgent) {
    out.push({
      id: 'agent-redirect',
      level: 'notice',
      category: 'reachability',
      title: `${profileName} is redirected somewhere a browser is not`,
      evidence: `The agent request ended at ${agent.url}.`,
      fix: 'Confirm the destination stays in sync with the page humans see. Divergence here becomes a wrong answer in an assistant.',
      points: 0,
    });
  }

  if (out.length === 0) {
    out.push({
      id: 'reachable',
      level: 'good',
      category: 'reachability',
      title: `${profileName} can reach this page`,
      evidence: `HTTP ${agent.status}, allowed by robots.txt, no blocking directives.`,
      fix: '',
      points: 0,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Fidelity — does the agent get the content
// ---------------------------------------------------------------------------

function fidelityFindings(facts: AuditFacts): (Finding | null)[] {
  const { gaps, agent, raw, rendered, profileName, profileRendersJavaScript } = facts;
  const out: (Finding | null)[] = [];

  const js = gaps.javascript;
  if (js && js.severity !== 'none' && !profileRendersJavaScript) {
    const critical = js.severity === 'critical';
    out.push({
      id: 'javascript-gap',
      level: critical ? 'critical' : js.severity === 'major' ? 'warning' : 'notice',
      category: 'fidelity',
      title: js.headline,
      evidence: js.detail,
      fix: 'Server-render or pre-render this content. It fixes every non-rendering crawler at once, which is all of them except Googlebot and bingbot.',
      points: critical ? 55 : js.severity === 'major' ? 35 : 12,
    });

    if (js.missingHeadings.length > 0) {
      out.push({
        id: 'headings-lost-to-js',
        level: 'notice',
        category: 'fidelity',
        title: `${js.missingHeadings.length} heading${js.missingHeadings.length === 1 ? ' exists' : 's exist'} only after JavaScript`,
        evidence: js.missingHeadings.slice(0, 5).join(' · '),
        fix: 'Headings are how an agent decides what a page is about. These are invisible to it.',
        points: 0,
      });
    }
  }

  if (gaps.outcome === 'degraded') {
    out.push({
      id: 'routing-degraded',
      level: gaps.routing.severity === 'critical' ? 'critical' : 'warning',
      category: 'fidelity',
      title: gaps.routing.headline,
      evidence: gaps.routing.detail,
      fix: 'Content that disappears only for agents is usually a bot rule or a cache variant keyed on User-Agent. Check Vary headers and CDN cache keys.',
      points: gaps.routing.severity === 'critical' ? 40 : 25,
    });
  }

  if (gaps.outcome === 'optimized') {
    out.push({
      id: 'routing-optimized',
      level: 'good',
      category: 'fidelity',
      title: gaps.routing.headline,
      evidence: gaps.routing.detail,
      fix: '',
      points: 0,
    });
  }

  if (agent.shape !== 'error' && agent.metrics.headingCount === 0 && agent.metrics.words > 50) {
    out.push({
      id: 'no-headings',
      level: 'notice',
      category: 'fidelity',
      title: 'The agent sees no headings',
      evidence: `${agent.metrics.words.toLocaleString('en-US')} words with no heading structure.`,
      fix: 'Headings give an agent the outline it uses to decide which passage answers a question.',
      points: 8,
    });
  }

  if (agent.shape === 'fallback' && agent.metrics.words > 50) {
    out.push({
      id: 'no-article',
      level: 'notice',
      category: 'fidelity',
      title: 'No main article could be identified',
      evidence: 'Content extraction fell back to the whole body, so navigation and boilerplate are mixed in with the content.',
      fix: 'Wrap the main content in `<main>` or `<article>`. Agents use the same extraction heuristics this tool does.',
      points: 8,
    });
  }

  if (
    js &&
    js.severity === 'none' &&
    gaps.outcome !== 'degraded' &&
    gaps.outcome !== 'blocked' &&
    raw.metrics.words > 0
  ) {
    const wordCount = `${agent.metrics.words.toLocaleString('en-US')} words reach ${profileName}`;
    out.push({
      id: 'content-intact',
      level: 'good',
      category: 'fidelity',
      title: 'The agent gets the whole page',
      evidence:
        agent.metrics.words === raw.metrics.words
          ? `${wordCount}, matching what a browser is sent.`
          : `${wordCount}. JavaScript is not hiding content from crawlers on this page.`,
      fix: '',
      points: 0,
    });
  }

  if (!rendered) {
    out.push({
      id: 'rendered-unknown',
      level: 'notice',
      category: 'fidelity',
      title: 'The rendered page could not be read',
      evidence: 'Without it, the JavaScript gap is unknown and this score covers only the routing half.',
      fix: 'Reload the tab and run again.',
      points: 0,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Structured data
// ---------------------------------------------------------------------------

function structuredFindings(facts: AuditFacts): (Finding | null)[] {
  const { structured, agent, profileName } = facts;
  const out: (Finding | null)[] = [];
  const alreadyLean = leanOptimizedDelivery(facts);

  const agentBlocks = structured.agent.jsonLd;
  const renderedBlocks = structured.rendered?.jsonLd ?? [];

  const invalid = agentBlocks.filter((b) => b.error);
  if (invalid.length > 0) {
    out.push({
      id: 'jsonld-invalid',
      level: 'warning',
      category: 'structured',
      title: `${invalid.length} JSON-LD block${invalid.length === 1 ? '' : 's'} will not parse`,
      evidence: invalid[0]?.error ?? 'Invalid JSON.',
      fix: 'Broken structured data is silently ignored, so this markup is doing nothing at all right now.',
      points: 30,
    });
  }

  const lost = renderedBlocks.length - agentBlocks.length;
  if (lost > 0) {
    out.push({
      id: 'jsonld-after-js',
      level: alreadyLean ? 'notice' : 'warning',
      category: 'structured',
      title: `${lost} JSON-LD block${lost === 1 ? ' exists' : 's exist'} only after JavaScript`,
      evidence: alreadyLean
        ? `The rendered page has ${renderedBlocks.length}; ${profileName} receives ${agentBlocks.length}. Expected when the edge serves simplified HTML — not scored.`
        : `The rendered page has ${renderedBlocks.length}; ${profileName} receives ${agentBlocks.length}.`,
      fix: alreadyLean
        ? 'Optional on a condensed agent document. Title and description in that HTML are the identity layer; JSON-LD is extra.'
        : 'Structured data injected by a tag manager or client-side framework never reaches a non-rendering crawler. Emit it server-side.',
      points: alreadyLean ? 0 : 35,
    });
  }

  if (agentBlocks.length === 0 && renderedBlocks.length === 0 && agent.shape !== 'error') {
    out.push({
      id: 'no-jsonld',
      level: 'notice',
      category: 'structured',
      title: 'No structured data on this page',
      evidence: alreadyLean
        ? 'No JSON-LD in either document. Not scored — the agent already received condensed HTML with a title and headings.'
        : 'No JSON-LD blocks were found in either document.',
      fix: alreadyLean
        ? 'Optional. Schema.org markup helps some parsers; retrieval crawlers can use the prose and title instead.'
        : 'Schema.org markup tells an agent what a page is without making it infer from prose. Start with the type that fits: Article, Product, FAQPage, Organization.',
      points: alreadyLean ? 0 : 25,
    });
  }

  const meta = structured.agent.meta;
  if (agent.shape !== 'error' && agent.shape !== 'markdown') {
    if (!meta.description) {
      out.push({
        id: 'no-description',
        level: 'notice',
        category: 'structured',
        title: 'No meta description',
        evidence: 'The agent has no summary to fall back on.',
        fix: 'A description is often what gets quoted when an assistant summarises the page.',
        points: 12,
      });
    }
    if (!meta.canonical) {
      out.push({
        id: 'no-canonical',
        level: 'notice',
        category: 'structured',
        title: 'No canonical URL',
        evidence: alreadyLean
          ? 'Nothing tells an agent which URL is authoritative for this content. Not scored against simplified agent HTML.'
          : 'Nothing tells an agent which URL is authoritative for this content.',
        fix: 'Add `<link rel="canonical">`. Without it, duplicate URLs split whatever authority this page has.',
        points: alreadyLean ? 0 : 10,
      });
    }
    if (!meta.title) {
      out.push({
        id: 'no-title',
        level: 'warning',
        category: 'structured',
        title: 'No title for the agent',
        evidence: 'The document the agent received has no `<title>` element.',
        fix: 'The title is the single strongest signal of what a page is about.',
        points: 20,
      });
    }
  }

  if (agentBlocks.length > 0 && invalid.length === 0 && lost <= 0) {
    const types = Array.from(new Set(agentBlocks.flatMap((b) => b.types)));
    out.push({
      id: 'jsonld-intact',
      level: 'good',
      category: 'structured',
      title: 'Structured data reaches the agent',
      evidence: types.length > 0 ? `Types: ${types.join(', ')}.` : `${agentBlocks.length} valid block(s).`,
      fix: '',
      points: 0,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Efficiency — what the page costs to read
// ---------------------------------------------------------------------------

const HEAVY_PAYLOAD_TOKENS = 30_000;
const LOW_CONTENT_RATIO = 0.08;

function payloadIsExpensive(facts: AuditFacts): boolean {
  const { agent } = facts;
  if (agent.shape === 'error') return false;
  if (agent.metrics.payloadTokens > HEAVY_PAYLOAD_TOKENS) return true;
  return (
    agent.metrics.contentRatio > 0 &&
    agent.metrics.contentRatio < LOW_CONTENT_RATIO &&
    agent.metrics.payloadBytes > 20_000
  );
}

/**
 * Condensed or fuller agent HTML that is already cheap to read. Markdown and
 * a sitemap are optional extras then, not missing standards — retrieval
 * crawlers got what they came for.
 */
function leanOptimizedDelivery(facts: AuditFacts): boolean {
  return facts.gaps.outcome === 'optimized' && !payloadIsExpensive(facts);
}

function efficiencyFindings(facts: AuditFacts): (Finding | null)[] {
  const { agent, raw, profileName } = facts;
  const out: (Finding | null)[] = [];

  if (agent.shape === 'error') return out;

  if (agent.metrics.payloadTokens > HEAVY_PAYLOAD_TOKENS) {
    out.push({
      id: 'heavy-payload',
      level: 'warning',
      category: 'efficiency',
      title: 'The page is expensive to read',
      evidence: `${agent.metrics.payloadTokens.toLocaleString('en-US')} tokens of payload for ${agent.metrics.tokens.toLocaleString('en-US')} tokens of actual content.`,
      fix: 'Agents work inside a context budget. A page this heavy competes with everything else the model is holding, and may be truncated before the part that answers the question.',
      points: 30,
    });
  }

  if (
    agent.metrics.contentRatio > 0 &&
    agent.metrics.contentRatio < LOW_CONTENT_RATIO &&
    agent.metrics.payloadBytes > 20_000
  ) {
    out.push({
      id: 'markup-heavy',
      level: 'notice',
      category: 'efficiency',
      title: 'Markup dwarfs the content',
      evidence: `Readable text is ${(agent.metrics.contentRatio * 100).toFixed(1)}% of the payload.`,
      fix: 'Most of what this agent downloads is markup it has to read past. Serving markdown to agents is the direct fix.',
      points: 15,
    });
  }

  if (agent.shape === 'markdown') {
    const saved = raw.metrics.payloadTokens - agent.metrics.payloadTokens;
    out.push({
      id: 'markdown-served',
      level: 'good',
      category: 'efficiency',
      title: `${profileName} is served markdown`,
      evidence:
        saved > 0
          ? `${saved.toLocaleString('en-US')} fewer tokens than the HTML a browser receives.`
          : 'The agent receives markdown rather than HTML.',
      fix: '',
      points: 0,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Affordances — what the site offers agents beyond the page
// ---------------------------------------------------------------------------

function affordanceFindings(facts: AuditFacts): (Finding | null)[] {
  const { affordances } = facts.access;
  const out: (Finding | null)[] = [];
  const alreadyLean = leanOptimizedDelivery(facts);

  if (affordances.markdownNegotiation) {
    out.push({
      id: 'markdown-negotiation',
      level: 'good',
      category: 'affordances',
      title: 'The site answers Accept: text/markdown',
      evidence: 'Agents that ask for markdown get markdown.',
      fix: '',
      points: 0,
    });
  } else {
    out.push({
      id: 'no-markdown-negotiation',
      level: 'notice',
      category: 'affordances',
      title: 'No markdown content negotiation',
      evidence: alreadyLean
        ? 'Requesting text/markdown returned HTML. The agent already received a lean HTML variant, so this is not scored.'
        : 'Requesting text/markdown returned HTML.',
      fix: alreadyLean
        ? 'Optional for coding agents. Retrieval crawlers do not need markdown when the HTML is already condensed.'
        : 'Cloudflare and Vercel both do this at the edge with no application change. It is the highest-leverage agent affordance available right now.',
      points: alreadyLean ? 0 : 30,
    });
  }

  if (!affordances.sitemapReachable) {
    out.push({
      id: 'no-sitemap',
      level: 'notice',
      category: 'affordances',
      title: 'No reachable sitemap',
      evidence: alreadyLean
        ? 'Nothing was found at /sitemap.xml and robots.txt declares none. Not scored against this page — the agent already received a lean HTML variant.'
        : 'Nothing was found at /sitemap.xml and robots.txt declares none.',
      fix: 'A sitemap is how a crawler discovers pages nothing links to prominently.',
      points: alreadyLean ? 0 : 25,
    });
  } else if (affordances.sitemapsDeclared.length === 0) {
    out.push({
      id: 'sitemap-undeclared',
      level: 'notice',
      category: 'affordances',
      title: 'The sitemap is not declared in robots.txt',
      evidence: alreadyLean
        ? 'A sitemap exists at /sitemap.xml but robots.txt does not point to it. Not scored against this page — the agent already received a lean HTML variant.'
        : 'A sitemap exists at /sitemap.xml but robots.txt does not point to it.',
      fix: 'Add a Sitemap: line to robots.txt so crawlers do not have to guess the location.',
      points: alreadyLean ? 0 : 10,
    });
  }

  if (affordances.dotMd) {
    out.push({
      id: 'dot-md',
      level: 'good',
      category: 'affordances',
      title: 'A markdown companion exists for this page',
      evidence: 'The <url>.md convention is supported.',
      fix: '',
      points: 0,
    });
  }

  if (affordances.llmsTxt) {
    out.push({
      id: 'llms-txt',
      level: 'good',
      category: 'affordances',
      title: 'llms.txt is published',
      evidence: 'An agent-facing index of the site exists.',
      fix: '',
      points: 0,
    });
  }

  const routingSignal = facts.access.edge.signals.find(
    (s) => s.agentSpecific && s.label.includes('without Vary'),
  );
  if (routingSignal) {
    out.push({
      id: 'vary-missing',
      level: 'warning',
      category: 'affordances',
      title: 'Agent routing without Vary: User-Agent',
      evidence: routingSignal.detail,
      fix: 'Add Vary: User-Agent, or key the CDN cache on the same signal you route on. Without it a shared cache can hand the agent copy to a human.',
      points: 20,
    });
  }

  return out;
}
