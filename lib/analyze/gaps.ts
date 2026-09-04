import { diffWords } from 'diff';
import type {
  DiffSegment,
  ExtractedDoc,
  Gap,
  GapReport,
  GapSeverity,
  RoutingOutcome,
} from '../types';

/**
 * The two gaps that make the tool diagnostic rather than descriptive.
 *
 *   rendered vs rawBrowser  = the JavaScript gap. Content that only exists
 *                             after hydration, invisible to every AI crawler.
 *   rawBrowser vs rawAgent  = the routing gap. The edge deliberately treating
 *                             an agent differently — well or badly.
 *
 * A single human-versus-agent diff conflates the two and cannot say which one
 * is responsible for missing content, which is the only actionable question.
 *
 * Everything here is pure: it takes extracted documents and returns a report.
 */

/** Below this many words, ratios are noise rather than signal. */
const MIN_MEANINGFUL_WORDS = 40;

/** Words of context kept around each change when condensing a diff. */
const DIFF_CONTEXT_WORDS = 8;

/** Hard ceiling so a pathological diff cannot lock up the panel. */
const MAX_DIFF_SEGMENTS = 600;

export function computeGaps(
  rendered: ExtractedDoc | null,
  raw: ExtractedDoc,
  agent: ExtractedDoc,
): GapReport {
  const javascript = rendered ? buildJavaScriptGap(rendered, raw) : null;
  const outcome = classifyRouting(raw, agent);
  const routing = buildRoutingGap(raw, agent, outcome);

  const endToEndRetainedRatio =
    rendered && rendered.metrics.words >= MIN_MEANINGFUL_WORDS
      ? agent.metrics.words / rendered.metrics.words
      : null;

  return { javascript, routing, outcome, endToEndRetainedRatio };
}

// ---------------------------------------------------------------------------
// The JavaScript gap
// ---------------------------------------------------------------------------

function buildJavaScriptGap(rendered: ExtractedDoc, raw: ExtractedDoc): Gap {
  const ratio = safeRatio(raw.metrics.words, rendered.metrics.words);
  const severity =
    rendered.metrics.words < MIN_MEANINGFUL_WORDS ? 'none' : lossSeverity(ratio);
  const { diff, truncated } = condenseDiff(rendered.markdown, raw.markdown);

  return {
    kind: 'javascript',
    from: 'rendered',
    to: 'rawBrowser',
    severity,
    headline: javaScriptHeadline(severity, ratio),
    detail: javaScriptDetail(rendered, raw, ratio),
    retainedRatio: ratio,
    wordDelta: raw.metrics.words - rendered.metrics.words,
    tokenDelta: raw.metrics.tokens - rendered.metrics.tokens,
    missingHeadings: headingsMissingFrom(rendered, raw),
    addedHeadings: headingsMissingFrom(raw, rendered),
    diff,
    diffTruncated: truncated,
  };
}

function javaScriptHeadline(severity: GapSeverity, ratio: number): string {
  switch (severity) {
    case 'none':
      return 'Everything you can see is already in the HTML.';
    case 'minor':
      return `${percent(1 - ratio)} of the page is added by JavaScript.`;
    case 'major':
      return `${percent(1 - ratio)} of what you see is missing from the HTML.`;
    case 'critical':
      return 'Without JavaScript this page is effectively blank.';
  }
}

function javaScriptDetail(rendered: ExtractedDoc, raw: ExtractedDoc, ratio: number): string {
  if (rendered.metrics.words < MIN_MEANINGFUL_WORDS) {
    return 'There was too little text on the page to compare meaningfully.';
  }
  if (ratio >= 0.9) {
    return `The server sends ${count(raw.metrics.words, 'word')} and you see ${count(rendered.metrics.words, 'word')}. Crawlers that do not run JavaScript still get the whole page.`;
  }
  return `You see ${count(rendered.metrics.words, 'word')}; the raw HTML contains ${count(raw.metrics.words, 'word')}. No major AI crawler runs JavaScript, so the difference never reaches ChatGPT, Claude, or Perplexity — regardless of how they identify themselves.`;
}

// ---------------------------------------------------------------------------
// The routing gap
// ---------------------------------------------------------------------------

function classifyRouting(raw: ExtractedDoc, agent: ExtractedDoc): RoutingOutcome {
  if (agent.shape === 'error' || agent.status === 0 || agent.status >= 400) return 'blocked';

  // Markdown negotiation is the clearest possible signal of deliberate
  // agent-specific delivery, whatever the word counts say.
  if (agent.shape === 'markdown' && raw.shape !== 'markdown') return 'optimized';

  const ratio = safeRatio(agent.metrics.words, raw.metrics.words);

  if (raw.metrics.words < MIN_MEANINGFUL_WORDS && agent.metrics.words >= MIN_MEANINGFUL_WORDS) {
    return 'optimized';
  }
  if (ratio >= 1.15) return 'optimized';
  if (ratio >= 0.9) return 'identical';

  // Fewer words is not, by itself, evidence of a problem — trimming markup and
  // boilerplate for a machine reader is the literal goal of agent-facing
  // optimization, and it necessarily lowers the word count. Only call it a
  // loss when a whole section actually vanished; when every heading survives
  // and the payload itself is lean, this is condensation, not degradation.
  if (looksIntentionallyCondensed(raw, agent)) return 'optimized';
  return 'degraded';
}

/**
 * Word count dropping is ambiguous on its own — it is what both "content is
 * missing" and "the edge is doing its job" look like. Two signals separate
 * them without needing to compare meaning: whether every section heading
 * survives (a real loss usually drops a whole section, not just its prose),
 * and whether the response itself is lean rather than a bloated template with
 * something quietly missing.
 */
function looksIntentionallyCondensed(raw: ExtractedDoc, agent: ExtractedDoc): boolean {
  if (raw.headings.length === 0) return false; // nothing to check structure against
  if (headingsMissingFrom(raw, agent).length > 0) return false; // a section is genuinely gone

  const overhead =
    agent.metrics.payloadTokens > 0
      ? (agent.metrics.payloadTokens - agent.metrics.tokens) / agent.metrics.payloadTokens
      : 0;
  const shrink =
    raw.metrics.payloadTokens > 0 ? 1 - agent.metrics.payloadTokens / raw.metrics.payloadTokens : 0;

  // Either is fair evidence of deliberate formatting: little markup overhead
  // in what was sent, or a payload dramatically smaller than a browser's.
  return overhead <= 0.5 || shrink >= 0.6;
}

function buildRoutingGap(
  raw: ExtractedDoc,
  agent: ExtractedDoc,
  outcome: RoutingOutcome,
): Gap {
  const ratio = safeRatio(agent.metrics.words, raw.metrics.words);
  const { diff, truncated } = condenseDiff(raw.markdown, agent.markdown);

  return {
    kind: 'routing',
    from: 'rawBrowser',
    to: 'rawAgent',
    severity: routingSeverity(outcome, ratio),
    headline: routingHeadline(outcome, agent, ratio),
    detail: routingDetail(outcome, raw, agent),
    retainedRatio: ratio,
    wordDelta: agent.metrics.words - raw.metrics.words,
    tokenDelta: agent.metrics.tokens - raw.metrics.tokens,
    missingHeadings: headingsMissingFrom(raw, agent),
    addedHeadings: headingsMissingFrom(agent, raw),
    diff,
    diffTruncated: truncated,
  };
}

function routingSeverity(outcome: RoutingOutcome, ratio: number): GapSeverity {
  switch (outcome) {
    case 'blocked':
      return 'critical';
    case 'degraded':
      return lossSeverity(ratio);
    case 'optimized':
    case 'identical':
      return 'none';
  }
}

function routingHeadline(outcome: RoutingOutcome, agent: ExtractedDoc, ratio: number): string {
  switch (outcome) {
    case 'blocked':
      return `${agent.label} was refused.`;
    case 'optimized':
      if (agent.shape === 'markdown') return `Your site answers ${agent.label} with markdown.`;
      // Fewer words but every heading intact and a lean payload — condensed,
      // not "fuller", and calling it fuller would misstate what happened.
      if (ratio < 0.9) return `Your edge serves ${agent.label} a leaner, condensed version.`;
      return `Your edge serves ${agent.label} a different, fuller page.`;
    case 'identical':
      return 'Agents get the same page as a browser.';
    case 'degraded':
      return `${agent.label} gets ${percent(1 - ratio)} less content than a browser.`;
  }
}

function routingDetail(
  outcome: RoutingOutcome,
  raw: ExtractedDoc,
  agent: ExtractedDoc,
): string {
  switch (outcome) {
    case 'blocked':
      return `The request came back ${agent.error ?? `HTTP ${agent.status}`}. Whatever is on this page, this agent cannot read it — check your WAF or bot rules before anything else.`;
    case 'optimized': {
      const saved = raw.metrics.payloadTokens - agent.metrics.payloadTokens;
      const savings =
        saved > 0
          ? ` That is ${count(saved, 'token')} less to read — ${percent(saved / Math.max(raw.metrics.payloadTokens, 1))} smaller.`
          : '';
      const ratio = safeRatio(agent.metrics.words, raw.metrics.words);
      if (ratio < 0.9) {
        // Word count is down, but every heading survives and the payload is
        // lean — the signature of deliberate formatting, not a page quietly
        // missing content. Say so plainly, but still ask for a spot check:
        // a heading surviving does not guarantee nothing under it was cut.
        return `${agent.label} gets ${count(agent.metrics.words, 'word')} against ${count(raw.metrics.words, 'word')} for a browser, but every section heading survives and the payload carries little markup overhead.${savings} That pattern is what deliberate agent formatting looks like, not lost content — worth a spot check that no facts were cut within a section.`;
      }
      return `Agent-specific delivery is working: ${count(agent.metrics.words, 'word')} for the agent against ${count(raw.metrics.words, 'word')} for a browser.${savings}`;
    }
    case 'identical':
      return 'The agent response matches the browser response, so nothing at your edge is treating agents differently. That is fine if your HTML is already clean — and a missed opportunity if it is not.';
    case 'degraded':
      return `A browser receives ${count(raw.metrics.words, 'word')}; ${agent.label} receives ${count(agent.metrics.words, 'word')}. Content that disappears only for agents is usually a bot rule or a cache variant, not a deliberate choice.`;
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function lossSeverity(ratio: number): GapSeverity {
  if (ratio >= 0.9) return 'none';
  if (ratio >= 0.7) return 'minor';
  if (ratio >= 0.3) return 'major';
  return 'critical';
}

/**
 * Ratio of `part` to `whole`. With no baseline there is nothing to have lost,
 * so an empty source reads as fully retained rather than as a total loss.
 */
function safeRatio(part: number, whole: number): number {
  if (whole <= 0) return 1;
  return part / whole;
}

function headingsMissingFrom(from: ExtractedDoc, to: ExtractedDoc): string[] {
  const present = new Set(to.headings.map((h) => h.text.toLowerCase()));
  const missing: string[] = [];
  for (const heading of from.headings) {
    if (!present.has(heading.text.toLowerCase())) missing.push(heading.text);
  }
  return missing;
}

/**
 * A word-level diff with long unchanged runs collapsed. Showing every shared
 * word buries the handful that actually differ.
 */
export function condenseDiff(
  before: string,
  after: string,
): { diff: DiffSegment[]; truncated: boolean } {
  if (!before && !after) return { diff: [], truncated: false };

  const changes = diffWords(before, after);
  const segments: DiffSegment[] = [];
  let truncated = false;

  for (const change of changes) {
    if (change.added || change.removed) {
      segments.push({ value: change.value, added: change.added, removed: change.removed });
      continue;
    }
    const words = change.value.split(/(\s+)/);
    const wordCount = words.filter((w) => w.trim()).length;
    if (wordCount <= DIFF_CONTEXT_WORDS * 2) {
      segments.push({ value: change.value });
      continue;
    }
    const head = takeWords(change.value, DIFF_CONTEXT_WORDS, 'start');
    const tail = takeWords(change.value, DIFF_CONTEXT_WORDS, 'end');
    segments.push({ value: `${head} … ${tail}` });
    truncated = true;
  }

  if (segments.length > MAX_DIFF_SEGMENTS) {
    return { diff: segments.slice(0, MAX_DIFF_SEGMENTS), truncated: true };
  }
  return { diff: segments, truncated };
}

function takeWords(value: string, n: number, from: 'start' | 'end'): string {
  const words = value.trim().split(/\s+/);
  return from === 'start' ? words.slice(0, n).join(' ') : words.slice(-n).join(' ');
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function percent(fraction: number): string {
  const clamped = Math.max(0, Math.min(1, fraction));
  const value = clamped * 100;
  if (value > 0 && value < 1) return '<1%';
  if (value > 99 && value < 100) return '>99%';
  return `${Math.round(value)}%`;
}

function count(value: number, noun: string): string {
  return `${value.toLocaleString('en-US')} ${noun}${value === 1 ? '' : 's'}`;
}
