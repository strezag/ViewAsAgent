import type { EdgeReport, EdgeSignal, HeaderPair } from '../types';

/**
 * Scrunch AXP and its equivalents publish no detection signature, so the only
 * honest way to find them is empirically: fetch the same URL as a browser and
 * as a crawler, and look at what the edge did differently.
 *
 * The vendor table is data rather than logic so a new CDN or optimizer can be
 * added without touching the comparison.
 */

interface VendorSignature {
  vendor: string;
  /** Exact header names, lowercase. */
  headers?: string[];
  /** Header name prefixes, lowercase. */
  prefixes?: string[];
  /** Matched against the `server` header value. */
  server?: RegExp;
  /** Matched against the `via` header value. */
  via?: RegExp;
}

const VENDORS: VendorSignature[] = [
  { vendor: 'Cloudflare', headers: ['cf-ray', 'cf-cache-status', 'cf-apo-via'] },
  { vendor: 'Vercel', headers: ['x-vercel-id', 'x-vercel-cache'], server: /vercel/i },
  {
    vendor: 'Akamai',
    headers: ['x-akamai-transformed', 'x-akamai-request-id'],
    prefixes: ['akamai-'],
    server: /akamai/i,
  },
  { vendor: 'CloudFront', headers: ['x-amz-cf-id', 'x-amz-cf-pop'], via: /cloudfront/i },
  { vendor: 'Fastly', headers: ['x-fastly-request-id'], via: /fastly/i },
  { vendor: 'Netlify', headers: ['x-nf-request-id'], server: /netlify/i },
  { vendor: 'Next.js', headers: ['x-nextjs-cache', 'x-nextjs-prerender'] },
  { vendor: 'Shopify', headers: ['x-shopify-stage', 'x-shopid'] },
  { vendor: 'GitHub Pages', headers: ['x-github-request-id'] },
  // Speculative. Scrunch documents no header, so this only fires if one appears.
  { vendor: 'Scrunch AXP', prefixes: ['x-scrunch-', 'x-axp-'] },
];

/**
 * Headers that change on every request regardless of who is asking. Treating
 * these as evidence would report agent-specific routing on every single site.
 */
const VOLATILE = new Set([
  'date',
  'age',
  'etag',
  'last-modified',
  'expires',
  'set-cookie',
  'report-to',
  'nel',
  'alt-svc',
  'cf-ray',
  'cf-cache-status',
  'x-request-id',
  'request-id',
  'x-correlation-id',
  'x-trace-id',
  'x-amz-cf-id',
  'x-amz-cf-pop',
  'x-vercel-id',
  'x-served-by',
  'x-cache',
  'x-cache-hits',
  'x-timer',
  'x-akamai-request-id',
  'x-nf-request-id',
  'x-fastly-request-id',
  'x-github-request-id',
  'server-timing',
  'content-length',
  'keep-alive',
  'connection',
]);

function headerMap(headers: HeaderPair[]): Map<string, string> {
  return new Map(headers.map((h) => [h.name.toLowerCase(), h.value]));
}

export function detectVendors(headers: HeaderPair[]): string[] {
  const map = headerMap(headers);
  const names = Array.from(map.keys());
  const server = map.get('server') ?? '';
  const via = map.get('via') ?? '';
  const found: string[] = [];

  for (const signature of VENDORS) {
    const byName = signature.headers?.some((h) => map.has(h)) ?? false;
    const byPrefix = signature.prefixes?.some((p) => names.some((n) => n.startsWith(p))) ?? false;
    const byServer = signature.server?.test(server) ?? false;
    const byVia = signature.via?.test(via) ?? false;
    if (byName || byPrefix || byServer || byVia) found.push(signature.vendor);
  }
  return found;
}

export function buildEdgeReport(
  browserHeaders: HeaderPair[],
  agentHeaders: HeaderPair[],
): EdgeReport {
  const browser = headerMap(browserHeaders);
  const agent = headerMap(agentHeaders);

  const agentOnlyHeaders: HeaderPair[] = [];
  const changedHeaders: { name: string; browser: string; agent: string }[] = [];

  for (const [name, value] of agent) {
    if (VOLATILE.has(name)) continue;
    if (!browser.has(name)) {
      agentOnlyHeaders.push({ name, value });
    } else if (browser.get(name) !== value) {
      changedHeaders.push({ name, browser: browser.get(name) ?? '', agent: value });
    }
  }

  const vary = (browser.get('vary') ?? '') + ',' + (agent.get('vary') ?? '');
  const varyOnUserAgent = /user-agent/i.test(vary);
  const varyOnAccept = /\baccept\b/i.test(vary.replace(/accept-(encoding|language|charset)/gi, ''));

  const vendors = Array.from(
    new Set([...detectVendors(browserHeaders), ...detectVendors(agentHeaders)]),
  );

  const signals: EdgeSignal[] = [];

  if (vendors.length > 0) {
    signals.push({
      label: vendors.join(', '),
      detail: 'Detected from response headers. Agent routing, if any, happens here.',
      agentSpecific: false,
    });
  }

  const browserType = contentType(browser);
  const agentType = contentType(agent);
  if (browserType && agentType && browserType !== agentType) {
    signals.push({
      label: `Content-Type changes for agents: ${browserType} → ${agentType}`,
      detail: 'The edge is serving agents a different format entirely.',
      agentSpecific: true,
    });
  }

  if (varyOnAccept) {
    signals.push({
      label: 'Vary: Accept',
      detail: 'Content negotiation is declared, so caches will keep agent and browser copies apart.',
      agentSpecific: true,
    });
  }

  if (varyOnUserAgent) {
    signals.push({
      label: 'Vary: User-Agent',
      detail: 'The response is declared to depend on who is asking.',
      agentSpecific: true,
    });
  } else if (agentOnlyHeaders.length > 0 || changedHeaders.length > 0) {
    // Routing without Vary is a real cache-poisoning risk worth naming.
    signals.push({
      label: 'Agent routing without Vary: User-Agent',
      detail:
        'Responses differ by user agent but no Vary header says so. A shared cache can serve the agent copy to a human, or the reverse.',
      agentSpecific: true,
    });
  }

  const serverChanged = changedHeaders.find((h) => h.name === 'server');
  if (serverChanged) {
    signals.push({
      label: `Different origin for agents: ${serverChanged.browser} → ${serverChanged.agent}`,
      detail: 'Agent traffic is being answered by different infrastructure.',
      agentSpecific: true,
    });
  }

  if (agentOnlyHeaders.length > 0) {
    signals.push({
      label: `${agentOnlyHeaders.length} header${agentOnlyHeaders.length === 1 ? '' : 's'} only agents receive`,
      detail: agentOnlyHeaders.map((h) => h.name).join(', '),
      agentSpecific: true,
    });
  }

  if (signals.every((s) => !s.agentSpecific)) {
    signals.push({
      label: 'No agent-specific handling detected',
      detail:
        'The edge answered a crawler exactly as it answered a browser. Nothing is routing agents differently.',
      agentSpecific: false,
    });
  }

  return { vendors, varyOnUserAgent, varyOnAccept, agentOnlyHeaders, changedHeaders, signals };
}

function contentType(headers: Map<string, string>): string | null {
  const value = headers.get('content-type');
  return value ? (value.split(';')[0]?.trim().toLowerCase() ?? null) : null;
}
