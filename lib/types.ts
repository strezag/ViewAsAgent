/**
 * The shared contract between the service worker (which does all the network
 * work) and the side panel (which renders it). Keep this file dependency-free.
 */

export type AgentCategory = 'retrieval' | 'training' | 'coding' | 'baseline';

export interface AgentProfile {
  id: string;
  /** Short label shown in the UI. */
  name: string;
  vendor: string;
  category: AgentCategory;
  /** Full User-Agent string to put on the wire. Empty means "leave Chrome's alone". */
  userAgent: string;
  accept: string;
  /** Token this agent answers to in robots.txt User-agent lines. */
  robotsToken: string;
  /**
   * As of 2026 every known AI crawler is `false` here (Vercel/MERJ found zero
   * JS execution across GPTBot, ClaudeBot, PerplexityBot, Bytespider, Meta).
   * The field exists so the assumption is explicit and survives the day a
   * vendor changes it.
   */
  rendersJavaScript: boolean;
  /** Where this User-Agent string is documented, so the list stays auditable. */
  sourceUrl: string;
  note?: string;
}

export interface HeaderPair {
  name: string;
  value: string;
}

export interface RedirectHop {
  url: string;
  statusCode: number;
  redirectedTo: string;
}

export interface FetchTrace {
  /** Redirect chain, in order. Empty when the first response was terminal. */
  hops: RedirectHop[];
  /** Headers Chrome actually put on the wire — proof the spoof applied. */
  sentHeaders: HeaderPair[];
  /** Response headers of the final hop, as seen by the network stack. */
  responseHeaders: HeaderPair[];
  /** Resolved server IP, when Chrome reports one. */
  ip?: string;
  fromCache?: boolean;
  /** Set when the network stack aborted before a response. */
  networkError?: string;
}

export type DocumentSlot = 'rendered' | 'rawBrowser' | 'rawAgent';

export interface AgentResponse {
  profileId: string;
  requestedUrl: string;
  finalUrl: string;
  status: number;
  statusText: string;
  ok: boolean;
  contentType: string | null;
  body: string;
  byteLength: number;
  elapsedMs: number;
  trace: FetchTrace;
  /** Set when the fetch itself threw (DNS failure, blocked, aborted). */
  error?: string;
}

export interface CapturedDocument {
  slot: DocumentSlot;
  /** Human-readable label, e.g. "GPTBot" or "Rendered DOM". */
  label: string;
  url: string;
  html: string;
  contentType: string | null;
  status: number;
  byteLength: number;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

export interface Heading {
  level: number;
  text: string;
}

export interface LinkRef {
  href: string;
  text: string;
}

export interface DocMetrics {
  /** Size of the payload as delivered. */
  payloadBytes: number;
  /** Bytes of the payload that are <script> contents. */
  scriptBytes: number;
  textChars: number;
  words: number;
  /** Tokens in the extracted markdown — what an agent ingests as prose. */
  tokens: number;
  /** Tokens in the raw payload as delivered, markup and all. */
  payloadTokens: number;
  headingCount: number;
  linkCount: number;
  /** Readable text as a fraction of total payload. Low means markup-heavy. */
  contentRatio: number;
}

/** What the source document turned out to be once we looked at it. */
export type DocumentShape =
  | 'article' // Readability found a main article
  | 'fallback' // no article found; we used <body>
  | 'markdown' // the server sent markdown, no HTML parsing needed
  | 'empty' // nothing extractable
  | 'error'; // non-2xx or a failed fetch

export interface ExtractedDoc {
  slot: DocumentSlot;
  label: string;
  url: string;
  status: number;
  contentType: string | null;
  shape: DocumentShape;
  title: string | null;
  byline: string | null;
  excerpt: string | null;
  /** The main content as markdown — the closest thing to what an LLM ingests. */
  markdown: string;
  /** Plain text of the main content. */
  text: string;
  headings: Heading[];
  links: LinkRef[];
  metrics: DocMetrics;
  /** Set when the document could not be extracted at all. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Gap analysis
// ---------------------------------------------------------------------------

export type GapSeverity = 'none' | 'minor' | 'major' | 'critical';

/** What the edge did with an agent-identified request. */
export type RoutingOutcome =
  | 'optimized' // the agent got more or cleaner content than a browser
  | 'identical' // no agent-specific routing detected
  | 'degraded' // the agent got materially less
  | 'blocked'; // the agent got an error or a challenge

export interface DiffSegment {
  value: string;
  added?: boolean;
  removed?: boolean;
}

export interface Gap {
  kind: 'javascript' | 'routing';
  from: DocumentSlot;
  to: DocumentSlot;
  severity: GapSeverity;
  /** One plain sentence a non-engineer can act on. */
  headline: string;
  detail: string;
  /** to.words / from.words. Above 1 means the target had more. */
  retainedRatio: number;
  wordDelta: number;
  tokenDelta: number;
  missingHeadings: string[];
  addedHeadings: string[];
  diff: DiffSegment[];
  /** True when the diff was truncated for display. */
  diffTruncated: boolean;
}

export interface GapReport {
  javascript: Gap | null;
  routing: Gap;
  outcome: RoutingOutcome;
  /** Words in the rendered page that survive all the way to the agent. */
  endToEndRetainedRatio: number | null;
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

export interface RobotsRule {
  type: 'allow' | 'disallow';
  /** The raw path pattern, which may contain * and a trailing $. */
  path: string;
}

export interface RobotsGroup {
  /** Every User-agent line that opened this group, lowercased. */
  agents: string[];
  rules: RobotsRule[];
  crawlDelay?: number;
}

export interface RobotsFile {
  groups: RobotsGroup[];
  sitemaps: string[];
  /** True when the file was fetched but had no usable directives. */
  empty: boolean;
  /** Lines we could not make sense of, worth surfacing to a site owner. */
  warnings: string[];
}

export interface RobotsVerdict {
  allowed: boolean;
  /** The User-agent line that won, or null when nothing matched. */
  matchedAgent: string | null;
  matchedRule: RobotsRule | null;
  reason: string;
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

export type ProbeId =
  | 'robots'
  | 'llms'
  | 'llmsFull'
  | 'sitemap'
  | 'markdownAccept'
  | 'dotMd'
  | 'jsonLdAccept';

export interface ProbeResult {
  id: ProbeId;
  url: string;
  status: number;
  ok: boolean;
  contentType: string | null;
  body: string;
  headers: HeaderPair[];
  elapsedMs: number;
  error?: string;
}

export type ProbeBundle = Record<ProbeId, ProbeResult>;

// ---------------------------------------------------------------------------
// Structured data
// ---------------------------------------------------------------------------

export interface JsonLdBlock {
  /** @type values found, flattened across @graph. */
  types: string[];
  parsed: unknown;
  raw: string;
  error?: string;
}

export interface HrefLang {
  lang: string;
  href: string;
}

export interface PageMeta {
  title: string | null;
  description: string | null;
  canonical: string | null;
  metaRobots: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  ogType: string | null;
  twitterCard: string | null;
  hreflang: HrefLang[];
}

export interface StructuredData {
  jsonLd: JsonLdBlock[];
  meta: PageMeta;
}

// ---------------------------------------------------------------------------
// Access and edge
// ---------------------------------------------------------------------------

export interface CrawlDirectives {
  /** Tokens from <meta name="robots"> and any agent-specific meta. */
  metaRobots: string[];
  /** Tokens from the X-Robots-Tag response header. */
  xRobotsTag: string[];
  noindex: boolean;
  nosnippet: boolean;
  /** The opt-out signals aimed specifically at AI use. */
  noai: boolean;
  noimageai: boolean;
}

export interface AgentAffordances {
  llmsTxt: boolean;
  llmsFullTxt: boolean;
  /** The server answered Accept: text/markdown with markdown. */
  markdownNegotiation: boolean;
  /** A <url>.md companion exists. */
  dotMd: boolean;
  jsonLdNegotiation: boolean;
  sitemapsDeclared: string[];
  sitemapReachable: boolean;
}

export interface EdgeSignal {
  label: string;
  detail: string;
  /** Whether this signal indicates agent-specific handling. */
  agentSpecific: boolean;
}

export interface EdgeReport {
  /** CDN or optimization vendors detected from response headers. */
  vendors: string[];
  varyOnUserAgent: boolean;
  varyOnAccept: boolean;
  agentOnlyHeaders: HeaderPair[];
  changedHeaders: { name: string; browser: string; agent: string }[];
  signals: EdgeSignal[];
}

export interface RobotsVerdictRow {
  profileId: string;
  name: string;
  vendor: string;
  category: AgentCategory;
  verdict: RobotsVerdict;
}

export interface AccessReport {
  /** Null when robots.txt was missing or unreadable, which means "allow all". */
  robots: RobotsFile | null;
  robotsStatus: number;
  verdicts: RobotsVerdictRow[];
  directives: CrawlDirectives;
  affordances: AgentAffordances;
  edge: EdgeReport;
}

// ---------------------------------------------------------------------------
// Findings and scoring
// ---------------------------------------------------------------------------

export type ScoreCategory =
  | 'reachability'
  | 'fidelity'
  | 'structured'
  | 'efficiency'
  | 'affordances';

/**
 * `good` findings are reported too. A audit that only lists problems reads as
 * a complaint; naming what already works tells someone what not to break.
 */
export type FindingLevel = 'critical' | 'warning' | 'notice' | 'good';

export interface Finding {
  id: string;
  level: FindingLevel;
  category: ScoreCategory;
  title: string;
  /** What was observed, with numbers. */
  evidence: string;
  /** What to do about it. Empty for `good` findings. */
  fix: string;
  /** Points deducted from this category. Always 0 for `good`. */
  points: number;
}

export interface CategoryScore {
  category: ScoreCategory;
  label: string;
  score: number;
  weight: number;
  /**
   * False when there was nothing to measure — most often because the agent
   * could not fetch the page. Unevaluated categories are excluded from the
   * overall score rather than scored as perfect.
   */
  evaluated: boolean;
  findings: Finding[];
}

export interface ReadinessScore {
  overall: number;
  verdict: string;
  categories: CategoryScore[];
}

/**
 * Everything the findings and scoring rules read, with no dependency on the
 * browser, the DOM, or the message layer — so the rules stay unit-testable.
 */
export interface AuditFacts {
  url: string;
  profileName: string;
  profileCategory: AgentCategory;
  profileRendersJavaScript: boolean;
  rendered: ExtractedDoc | null;
  raw: ExtractedDoc;
  agent: ExtractedDoc;
  gaps: GapReport;
  access: AccessReport;
  structured: { rendered: StructuredData | null; agent: StructuredData };
  /** A redirect happened for the agent but not for a browser. */
  redirectedOnlyForAgent: boolean;
}

/** One row of the run-all-agents matrix. */
export interface AgentMatrixRow {
  profileId: string;
  name: string;
  vendor: string;
  category: AgentCategory;
  status: number;
  words: number;
  tokens: number;
  shape: DocumentShape;
  contentType: string | null;
  outcome: RoutingOutcome;
  robotsAllowed: boolean;
  error?: string;
}

/** Messages the side panel sends to the service worker. */
export type PanelRequest =
  | { type: 'GET_PROFILES' }
  | { type: 'CAPTURE_RENDERED'; tabId: number }
  | { type: 'FETCH_AS'; profileId: string; url: string }
  | { type: 'RUN_PROBES'; url: string; profileId: string }
  | { type: 'CLEAR_RULES' }
  | { type: 'DEBUG_SESSION_RULES' };

export type PanelResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };
