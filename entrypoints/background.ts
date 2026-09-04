import { fetchAs } from '@/lib/fetch/agentFetch';
import { runProbes } from '@/lib/fetch/probes';
import { listSessionRules, sweepSessionRules } from '@/lib/fetch/headerRules';
import { installTraceListeners } from '@/lib/fetch/trace';
import { captureRenderedDom, type RenderedCapture } from '@/lib/capture/renderedDom';
import { getProfile, ALL_PROFILES } from '@/lib/profiles';
import type { PanelRequest, PanelResponse } from '@/lib/types';

export default defineBackground(() => {
  // Must be registered synchronously at worker start, before any fetch runs.
  installTraceListeners();

  // A crashed worker can leave a header rule live. Clear on every wake.
  void sweepSessionRules().then((n) => {
    if (n > 0) console.warn(`[ViewAsAgent] swept ${n} stale session rule(s)`);
  });

  chrome.runtime.onInstalled.addListener(() => void sweepSessionRules());
  chrome.runtime.onStartup.addListener(() => void sweepSessionRules());

  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('[ViewAsAgent] side panel behavior:', err));

  // Dev-only seam so scripts/verify-headers.mjs can drive the real code path
  // over CDP. Stripped from production builds.
  if (import.meta.env.DEV) {
    Object.assign(globalThis, {
      __viewAsAgent: { fetchAs, getProfile, sweepSessionRules, listSessionRules },
    });
  }

  chrome.runtime.onMessage.addListener(
    (message: PanelRequest, _sender, sendResponse: (r: PanelResponse) => void) => {
      handle(message)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((err: unknown) =>
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
      return true; // keep the channel open for the async reply
    },
  );
});

async function handle(message: PanelRequest): Promise<unknown> {
  switch (message.type) {
    case 'GET_PROFILES':
      return ALL_PROFILES;

    case 'FETCH_AS': {
      const profile = getProfile(message.profileId);
      if (!profile) throw new Error(`Unknown agent profile: ${message.profileId}`);
      return fetchAs(profile, message.url);
    }

    case 'RUN_PROBES': {
      const profile = getProfile(message.profileId);
      if (!profile) throw new Error(`Unknown agent profile: ${message.profileId}`);
      return runProbes(profile, message.url);
    }

    case 'CAPTURE_RENDERED':
      return captureRendered(message.tabId);

    case 'CLEAR_RULES':
      return sweepSessionRules();

    case 'DEBUG_SESSION_RULES':
      return listSessionRules();
  }
}

async function captureRendered(tabId: number): Promise<RenderedCapture> {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: captureRenderedDom,
  });
  if (!result?.result) {
    throw new Error('Could not read the rendered page. Reload the tab and try again.');
  }
  return result.result as RenderedCapture;
}
