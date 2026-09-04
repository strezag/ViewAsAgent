import type { FetchTrace, HeaderPair, RedirectHop } from '../types';

/**
 * `fetch()` with `redirect: "follow"` only exposes the final URL, and
 * `redirect: "manual"` yields an opaque response with no headers at all. So the
 * redirect chain and the headers actually sent come from observational
 * webRequest instead, which MV3 still supports (only the *blocking* form was
 * removed).
 *
 * This is also how we prove the User-Agent spoof landed: `sentHeaders` is what
 * Chrome put on the wire after declarativeNetRequest ran, not what we asked for.
 */

interface Recorder {
  url: string;
  requestId?: string;
  hops: RedirectHop[];
  sentHeaders: HeaderPair[];
  responseHeaders: HeaderPair[];
  ip?: string;
  fromCache?: boolean;
  networkError?: string;
}

/** Unbound recorders, in creation order, waiting for their request to start. */
const pending: Recorder[] = [];
/** Recorders bound to a live requestId. */
const bound = new Map<string, Recorder>();

let installed = false;

function toPairs(headers?: chrome.webRequest.HttpHeader[]): HeaderPair[] {
  if (!headers) return [];
  return headers.map((h) => ({ name: h.name, value: h.value ?? '' }));
}

/**
 * Only requests the service worker itself made are ours: extension fetches have
 * no tab, so `tabId` is -1, and `initiator` is our own extension origin.
 */
function isOurs(details: { tabId: number; initiator?: string }): boolean {
  if (details.tabId !== -1) return false;
  if (!details.initiator) return true;
  return details.initiator === `chrome-extension://${chrome.runtime.id}`;
}

/** Only the two fields we need, so this survives @types/chrome renames. */
interface RequestStart {
  url: string;
  requestId: string;
}

function bind(details: RequestStart): Recorder | undefined {
  const index = pending.findIndex((r) => r.url === details.url);
  if (index === -1) return undefined;
  const [recorder] = pending.splice(index, 1);
  if (!recorder) return undefined;
  recorder.requestId = details.requestId;
  bound.set(details.requestId, recorder);
  return recorder;
}

export function installTraceListeners(): void {
  if (installed) return;
  installed = true;

  const filter: chrome.webRequest.RequestFilter = {
    urls: ['<all_urls>'],
    types: ['xmlhttprequest'],
  };

  chrome.webRequest.onBeforeRequest.addListener((details) => {
    if (!isOurs(details)) return;
    bind(details);
  }, filter);

  chrome.webRequest.onSendHeaders.addListener(
    (details) => {
      const recorder = bound.get(details.requestId);
      if (!recorder) return;
      // Redirect hops reuse the requestId; the first set is the one we asked for.
      if (recorder.sentHeaders.length === 0) {
        recorder.sentHeaders = toPairs(details.requestHeaders);
      }
    },
    filter,
    ['requestHeaders', 'extraHeaders'],
  );

  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      const recorder = bound.get(details.requestId);
      if (!recorder) return;
      // Last write wins, so this ends up holding the final hop's headers.
      recorder.responseHeaders = toPairs(details.responseHeaders);
    },
    filter,
    ['responseHeaders', 'extraHeaders'],
  );

  chrome.webRequest.onBeforeRedirect.addListener((details) => {
    const recorder = bound.get(details.requestId);
    if (!recorder) return;
    recorder.hops.push({
      url: details.url,
      statusCode: details.statusCode,
      redirectedTo: details.redirectUrl,
    });
  }, filter);

  chrome.webRequest.onCompleted.addListener((details) => {
    const recorder = bound.get(details.requestId);
    if (!recorder) return;
    recorder.ip = details.ip;
    recorder.fromCache = details.fromCache;
  }, filter);

  chrome.webRequest.onErrorOccurred.addListener((details) => {
    const recorder = bound.get(details.requestId);
    if (!recorder) return;
    recorder.networkError = details.error;
  }, filter);
}

export interface TraceHandle {
  finish(): FetchTrace;
}

/**
 * Start recording the next extension-initiated request to `url`. Callers must
 * always call `finish()` — it releases the recorder whether or not any events
 * arrived.
 */
export function beginTrace(url: string): TraceHandle {
  const recorder: Recorder = {
    url,
    hops: [],
    sentHeaders: [],
    responseHeaders: [],
  };
  pending.push(recorder);

  return {
    finish(): FetchTrace {
      const pendingIndex = pending.indexOf(recorder);
      if (pendingIndex !== -1) pending.splice(pendingIndex, 1);
      if (recorder.requestId) bound.delete(recorder.requestId);
      return {
        hops: recorder.hops,
        sentHeaders: recorder.sentHeaders,
        responseHeaders: recorder.responseHeaders,
        ip: recorder.ip,
        fromCache: recorder.fromCache,
        networkError: recorder.networkError,
      };
    },
  };
}

/** Read back the User-Agent that actually went on the wire, for verification. */
export function sentUserAgent(trace: FetchTrace): string | undefined {
  return trace.sentHeaders.find((h) => h.name.toLowerCase() === 'user-agent')?.value;
}

export function headerValue(headers: HeaderPair[], name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers.find((h) => h.name.toLowerCase() === lower)?.value;
}
