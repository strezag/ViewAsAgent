import type { AgentProfile, AgentResponse, HeaderPair } from '../types';
import { canonicalRequestUrl, installHeaderRule, type HeaderOverrides } from './headerRules';
import { beginTrace } from './trace';

/**
 * The single entry point for every request this extension makes on a user's
 * behalf. Everything the UI shows about "what the agent got" comes from here.
 *
 * The transport is deliberately behind one function: a datacenter-egress relay
 * (for verified-bot fidelity) can replace the body of `fetchAs` later without
 * the analysis layer or the UI knowing.
 */

const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * Both the DNR rule and the trace recorder are keyed by URL, so two concurrent
 * fetches of the same URL would collide. Serialize per URL — different URLs
 * still run in parallel, which is what the probe fan-out needs.
 */
const urlLocks = new Map<string, Promise<unknown>>();

function withUrlLock<T>(url: string, task: () => Promise<T>): Promise<T> {
  const previous = urlLocks.get(url) ?? Promise.resolve();
  const next = previous.then(task, task);
  urlLocks.set(
    url,
    next.catch(() => undefined),
  );
  void next.finally(() => {
    if (urlLocks.get(url) === next) urlLocks.delete(url);
  });
  return next;
}

export interface FetchAsOptions extends HeaderOverrides {
  method?: 'GET' | 'HEAD';
  timeoutMs?: number;
}

function responseHeaderPairs(response: Response): HeaderPair[] {
  const pairs: HeaderPair[] = [];
  response.headers.forEach((value, name) => pairs.push({ name, value }));
  return pairs;
}

export async function fetchAs(
  profile: AgentProfile,
  rawUrl: string,
  options: FetchAsOptions = {},
): Promise<AgentResponse> {
  const url = canonicalRequestUrl(rawUrl);
  const { method = 'GET', timeoutMs = 20_000, ...overrides } = options;

  return withUrlLock(url, async () => {
    const startedAt = Date.now();
    const handle = beginTrace(url);
    let rule: Awaited<ReturnType<typeof installHeaderRule>> = null;

    try {
      rule = await installHeaderRule(profile, url, overrides);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        // A real crawler is anonymous and cache-cold. Sending the user's session
        // cookie would produce a logged-in page no agent has ever seen.
        const response = await fetch(url, {
          method,
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'follow',
          signal: controller.signal,
        });

        let body = '';
        if (method !== 'HEAD') {
          const buffer = await response.arrayBuffer();
          const sliced =
            buffer.byteLength > MAX_BODY_BYTES ? buffer.slice(0, MAX_BODY_BYTES) : buffer;
          body = new TextDecoder('utf-8', { fatal: false }).decode(sliced);
        }

        const trace = handle.finish();
        // webRequest is the better source (it sees every hop), but fall back to
        // the Response when events did not arrive.
        if (trace.responseHeaders.length === 0) {
          trace.responseHeaders = responseHeaderPairs(response);
        }

        return {
          profileId: profile.id,
          requestedUrl: url,
          finalUrl: response.url || url,
          status: response.status,
          statusText: response.statusText,
          ok: response.ok,
          contentType: response.headers.get('content-type'),
          body,
          byteLength: body.length,
          elapsedMs: Date.now() - startedAt,
          trace,
        } satisfies AgentResponse;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      const trace = handle.finish();
      const message = err instanceof Error ? err.message : String(err);
      return {
        profileId: profile.id,
        requestedUrl: url,
        finalUrl: url,
        status: 0,
        statusText: '',
        ok: false,
        contentType: null,
        body: '',
        byteLength: 0,
        elapsedMs: Date.now() - startedAt,
        trace,
        error: trace.networkError ?? message,
      } satisfies AgentResponse;
    } finally {
      await rule?.remove();
    }
  });
}
