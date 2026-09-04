import type { AgentProfile } from '../types';

/**
 * `fetch()` silently drops User-Agent — it is a forbidden header name — so the
 * only way to put a crawler identity on the wire is to rewrite it at the
 * network layer with declarativeNetRequest.
 *
 * DNR cannot name "this extension" as the initiator, so containment comes from
 * four things: the rule matches one exact URL, only `xmlhttprequest`, only
 * requests with no tab (`tabIds: [TAB_ID_NONE]` — the same test `trace.ts`
 * uses), and it exists for the duration of a single fetch. A startup sweep
 * clears anything a crashed service worker left behind.
 *
 * Matching every `xmlhttprequest` to that URL, including ones the page itself
 * made, would de-cookie and UA-rewrite an SPA self-refetch during the audit.
 */

/** chrome.tabs.TAB_ID_NONE — extension fetches are not associated with a tab. */
const TAB_ID_NONE = -1;

const RULE_ID_MIN = 20_000;
const RULE_ID_MAX = 59_999;

let cursor = RULE_ID_MIN;
const inUse = new Set<number>();

function nextRuleId(): number {
  for (let i = 0; i <= RULE_ID_MAX - RULE_ID_MIN; i++) {
    cursor = cursor >= RULE_ID_MAX ? RULE_ID_MIN : cursor + 1;
    if (!inUse.has(cursor)) {
      inUse.add(cursor);
      return cursor;
    }
  }
  throw new Error('No free declarativeNetRequest session rule id');
}

const URL_FILTER_SPECIALS = /[*^|]/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Fragments never go on the wire. A DNR `urlFilter` that includes `#…` cannot
 * match the request Chrome actually sends, so the UA spoof never lands and
 * `trace.ts` never binds (`details.url` has no hash).
 */
export function canonicalRequestUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = '';
  return url.href;
}

/**
 * Match exactly one URL. `urlFilter` has no escape mechanism, so URLs
 * containing its metacharacters (`*`, `^`, `|`) fall back to an anchored regex.
 * Case folding is declared on the condition (`isUrlFilterCaseSensitive: false`)
 * rather than trusted to Chrome's current default; the `urlFilter` is still
 * lowercased because that is the form Chrome compares against.
 */
export function buildExactUrlCondition(url: string): chrome.declarativeNetRequest.RuleCondition {
  const target = canonicalRequestUrl(url);
  const base: chrome.declarativeNetRequest.RuleCondition = {
    resourceTypes: ['xmlhttprequest'],
    tabIds: [TAB_ID_NONE],
    isUrlFilterCaseSensitive: false,
  };
  if (URL_FILTER_SPECIALS.test(target)) {
    return { ...base, regexFilter: `(?i)^${escapeRegExp(target)}$` };
  }
  return { ...base, urlFilter: `|${target.toLowerCase()}|` };
}

export interface HeaderOverrides {
  userAgent?: string;
  accept?: string;
  acceptLanguage?: string;
}

type ModifyHeaderInfo = chrome.declarativeNetRequest.ModifyHeaderInfo;

/**
 * Headers that betray a browser to any UA-Client-Hints-aware edge. A real
 * crawler sends none of these, so a spoof that leaves them in place gets routed
 * as a human by exactly the middleware we are trying to observe.
 */
const BROWSER_TELLS = [
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-ch-ua-full-version-list',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'referer',
  'origin',
  'cookie',
];

function buildHeaderActions(overrides: HeaderOverrides, includeTells: boolean): ModifyHeaderInfo[] {
  const headers: ModifyHeaderInfo[] = [];
  if (overrides.userAgent) {
    headers.push({ header: 'user-agent', operation: 'set', value: overrides.userAgent });
  }
  if (overrides.accept) {
    headers.push({ header: 'accept', operation: 'set', value: overrides.accept });
  }
  headers.push({
    header: 'accept-language',
    operation: 'set',
    value: overrides.acceptLanguage ?? 'en-US,en;q=0.9',
  });
  if (includeTells) {
    for (const header of BROWSER_TELLS) {
      headers.push({ header, operation: 'remove' });
    }
  }
  return headers;
}

export interface InstalledRule {
  id: number;
  /** False when Chrome rejected the strict rule and we fell back to a minimal one. */
  strippedBrowserTells: boolean;
  remove(): Promise<void>;
}

/**
 * Install a session rule for one URL. Returns null when the profile asks for no
 * header changes at all (the browser baseline), so callers can treat "no rule"
 * and "rule installed" uniformly.
 */
export async function installHeaderRule(
  profile: AgentProfile,
  url: string,
  overrides: HeaderOverrides = {},
): Promise<InstalledRule | null> {
  const effective: HeaderOverrides = {
    userAgent: overrides.userAgent ?? profile.userAgent,
    accept: overrides.accept ?? profile.accept,
    acceptLanguage: overrides.acceptLanguage,
  };

  // The baseline profile deliberately keeps Chrome's own identity.
  if (!effective.userAgent && profile.category === 'baseline' && !overrides.accept) {
    return null;
  }

  const condition = buildExactUrlCondition(url);
  const id = nextRuleId();

  const remove = async () => {
    inUse.delete(id);
    try {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] });
    } catch {
      // A removed rule that was never added is not an error worth surfacing.
    }
  };

  const attempt = async (includeTells: boolean) => {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [id],
      addRules: [
        {
          id,
          priority: 1,
          action: {
            type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
            requestHeaders: buildHeaderActions(effective, includeTells),
          },
          condition,
        },
      ],
    });
  };

  try {
    await attempt(true);
    return { id, strippedBrowserTells: true, remove };
  } catch (err) {
    // Chrome refuses to modify a few headers depending on version. Losing the
    // client-hint strip is a fidelity hit, not a failure — keep the UA spoof.
    console.warn('[ViewAsAgent] strict header rule rejected, retrying minimal:', err);
    try {
      await attempt(false);
      return { id, strippedBrowserTells: false, remove };
    } catch (fallbackErr) {
      inUse.delete(id);
      throw fallbackErr;
    }
  }
}

/** Clear every session rule this extension owns. Safe to call at any time. */
export async function sweepSessionRules(): Promise<number> {
  const existing = await chrome.declarativeNetRequest.getSessionRules();
  if (existing.length === 0) return 0;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: existing.map((r) => r.id),
  });
  inUse.clear();
  return existing.length;
}

export async function listSessionRules(): Promise<chrome.declarativeNetRequest.Rule[]> {
  return chrome.declarativeNetRequest.getSessionRules();
}
