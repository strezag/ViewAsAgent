import type { AgentProfile, ProbeBundle, ProbeId, ProbeResult } from '../types';
import { MARKDOWN_ACCEPT } from '../profiles';
import { fetchAs } from './agentFetch';
import { canonicalRequestUrl } from './headerRules';

/**
 * The small set of extra requests that reveal how a site treats agents beyond
 * the page itself: what it permits, what it advertises, and whether it will
 * hand over a cheaper format if asked.
 *
 * Origin-level probes are cached for the session because robots.txt and
 * llms.txt do not change between page loads, and refetching them on every
 * audit is noise in the site owner's logs.
 */

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_PROBE_BODY = 200_000;

/** Probes that describe the origin, not the page — safe to cache per origin. */
const ORIGIN_PROBES: ProbeId[] = ['robots', 'llms', 'llmsFull', 'sitemap'];

interface CacheEntry {
  at: number;
  result: ProbeResult;
}

export async function runProbes(profile: AgentProfile, pageUrl: string): Promise<ProbeBundle> {
  const page = canonicalRequestUrl(pageUrl);
  const origin = new URL(page).origin;

  const targets: { id: ProbeId; url: string; accept?: string }[] = [
    { id: 'robots', url: `${origin}/robots.txt`, accept: 'text/plain,*/*;q=0.8' },
    { id: 'llms', url: `${origin}/llms.txt`, accept: 'text/plain,*/*;q=0.8' },
    { id: 'llmsFull', url: `${origin}/llms-full.txt`, accept: 'text/plain,*/*;q=0.8' },
    { id: 'sitemap', url: `${origin}/sitemap.xml`, accept: 'application/xml,text/xml,*/*;q=0.8' },
    { id: 'markdownAccept', url: page, accept: MARKDOWN_ACCEPT },
    { id: 'dotMd', url: markdownCompanionUrl(page) },
    { id: 'jsonLdAccept', url: page, accept: 'application/ld+json,application/json;q=0.9' },
  ];

  // Fan-out is fine: `fetchAs` serialises same-URL work, so the two probes that
  // retarget the page (`markdownAccept`, `jsonLdAccept`) cannot collide on DNR.
  const results = await Promise.all(
    targets.map((target) => runOne(profile, target.id, target.url, target.accept, origin)),
  );

  return Object.fromEntries(results.map((r) => [r.id, r])) as ProbeBundle;
}

async function runOne(
  profile: AgentProfile,
  id: ProbeId,
  url: string,
  accept: string | undefined,
  origin: string,
): Promise<ProbeResult> {
  const cacheable = ORIGIN_PROBES.includes(id);
  const key = `probe:${origin}:${id}`;

  if (cacheable) {
    const cached = await readCache(key);
    if (cached) return cached;
  }

  let result: ProbeResult;
  try {
    const response = await fetchAs(profile, url, accept ? { accept } : {});
    result = {
      id,
      url,
      status: response.status,
      ok: response.ok,
      contentType: response.contentType,
      body: response.body.slice(0, MAX_PROBE_BODY),
      headers: response.trace.responseHeaders,
      elapsedMs: response.elapsedMs,
      ...(response.error ? { error: response.error } : {}),
    };
  } catch (err) {
    result = {
      id,
      url,
      status: 0,
      ok: false,
      contentType: null,
      body: '',
      headers: [],
      elapsedMs: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (cacheable) await writeCache(key, result);
  return result;
}

/**
 * The `<url>.md` convention used by Mintlify and other documentation platforms.
 * Query strings are dropped because the companion file is per-path.
 */
export function markdownCompanionUrl(pageUrl: string): string {
  const url = new URL(pageUrl);
  url.search = '';
  url.hash = '';

  if (url.pathname.endsWith('.md')) return url.href;
  if (url.pathname.endsWith('/')) {
    url.pathname = `${url.pathname}index.md`;
  } else {
    url.pathname = `${url.pathname}.md`;
  }
  return url.href;
}

async function readCache(key: string): Promise<ProbeResult | null> {
  try {
    const stored = await chrome.storage.session.get(key);
    const entry = stored[key] as CacheEntry | undefined;
    if (!entry) return null;
    if (Date.now() - entry.at > CACHE_TTL_MS) return null;
    return entry.result;
  } catch {
    return null;
  }
}

async function writeCache(key: string, result: ProbeResult): Promise<void> {
  try {
    await chrome.storage.session.set({ [key]: { at: Date.now(), result } satisfies CacheEntry });
  } catch {
    // Session storage is a nicety; failing to cache is not worth surfacing.
  }
}
