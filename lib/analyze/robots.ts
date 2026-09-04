import type { RobotsFile, RobotsGroup, RobotsRule, RobotsVerdict } from '../types';

/**
 * A robots.txt parser and matcher following RFC 9309 and Google's reference
 * behavior, which is what the crawlers in this tool actually implement:
 *
 *   - Groups are opened by one or more consecutive User-agent lines.
 *   - A group applies when its User-agent value is a case-insensitive prefix of
 *     the crawler's product token. `Googlebot` therefore covers
 *     `Googlebot-Image` unless a more specific group exists.
 *   - The longest matching User-agent value wins; `*` only applies when nothing
 *     more specific matched.
 *   - Within a group, the longest matching rule path wins, and Allow beats
 *     Disallow on a tie.
 *   - `*` is a wildcard and a trailing `$` anchors the end of the path.
 *
 * Getting this wrong in either direction is costly: a false "blocked" sends
 * someone chasing a problem they do not have, and a false "allowed" hides the
 * reason they are absent from an assistant's answers.
 */

export function parseRobots(text: string): RobotsFile {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  const warnings: string[] = [];

  let current: RobotsGroup | null = null;
  // Consecutive User-agent lines share one group; the first rule closes it.
  let acceptingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0]?.trim() ?? '';
    if (!line) continue;

    const separator = line.indexOf(':');
    if (separator === -1) {
      warnings.push(`Ignored a line with no field separator: "${truncate(line)}"`);
      continue;
    }

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    switch (field) {
      case 'user-agent': {
        if (!value) {
          warnings.push('Ignored an empty User-agent line.');
          break;
        }
        if (!current || !acceptingAgents) {
          current = { agents: [], rules: [] };
          groups.push(current);
          acceptingAgents = true;
        }
        current.agents.push(value.toLowerCase());
        break;
      }
      case 'allow':
      case 'disallow': {
        if (!current) {
          warnings.push(`"${field}" appeared before any User-agent line and was ignored.`);
          break;
        }
        acceptingAgents = false;
        // "Disallow:" with no value is the documented way to allow everything,
        // so it is a deliberate no-op rather than a malformed line.
        if (field === 'disallow' && value === '') break;
        if (value === '') break;
        current.rules.push({ type: field, path: value });
        break;
      }
      case 'sitemap': {
        if (value) sitemaps.push(value);
        break;
      }
      case 'crawl-delay': {
        const delay = Number(value);
        if (current && Number.isFinite(delay)) {
          acceptingAgents = false;
          current.crawlDelay = delay;
        }
        break;
      }
      default:
        // Unknown fields are legal and must be skipped without complaint.
        break;
    }
  }

  return {
    groups,
    sitemaps,
    empty: groups.length === 0,
    warnings,
  };
}

/**
 * Decide whether `token` may fetch `path`.
 *
 * `path` should include the query string, since robots rules match against it.
 */
export function isAllowed(robots: RobotsFile | null, token: string, path: string): RobotsVerdict {
  if (!robots || robots.empty) {
    return {
      allowed: true,
      matchedAgent: null,
      matchedRule: null,
      reason: 'No robots.txt rules apply, so everything is allowed.',
    };
  }

  const group = selectGroup(robots, token);
  if (!group) {
    return {
      allowed: true,
      matchedAgent: null,
      matchedRule: null,
      reason: `No group matches ${token} and there is no wildcard group.`,
    };
  }

  const best = bestRule(group.group.rules, path);
  if (!best) {
    return {
      allowed: true,
      matchedAgent: group.agent,
      matchedRule: null,
      reason: `Matched the "${group.agent}" group, which has no rule covering this path.`,
    };
  }

  const allowed = best.type === 'allow';
  return {
    allowed,
    matchedAgent: group.agent,
    matchedRule: best,
    reason: `"${group.agent}" group: ${best.type === 'allow' ? 'Allow' : 'Disallow'}: ${best.path}`,
  };
}

/**
 * The most specific group for this crawler. Longest matching User-agent value
 * wins, and `*` is consulted only when nothing else matched.
 */
function selectGroup(
  robots: RobotsFile,
  token: string,
): { group: RobotsGroup; agent: string } | null {
  const lowered = token.toLowerCase();
  let best: { group: RobotsGroup; agent: string; length: number } | null = null;
  let wildcard: { group: RobotsGroup; agent: string } | null = null;

  for (const group of robots.groups) {
    for (const agent of group.agents) {
      if (agent === '*') {
        wildcard ??= { group, agent };
        continue;
      }
      if (!lowered.startsWith(agent)) continue;
      if (!best || agent.length > best.length) {
        best = { group, agent, length: agent.length };
      }
    }
  }

  if (best) return { group: best.group, agent: best.agent };
  return wildcard;
}

/** Longest matching rule wins; Allow wins a tie. */
function bestRule(rules: RobotsRule[], path: string): RobotsRule | null {
  let best: RobotsRule | null = null;
  let bestLength = -1;

  for (const rule of rules) {
    if (!pathMatches(rule.path, path)) continue;
    const length = specificity(rule.path);
    if (length > bestLength || (length === bestLength && rule.type === 'allow')) {
      best = rule;
      bestLength = length;
    }
  }
  return best;
}

/** Wildcards do not add specificity, so `/*` never outranks a literal prefix. */
function specificity(pattern: string): number {
  return pattern.replace(/\*/g, '').replace(/\$$/, '').length;
}

export function pathMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;

  const source = body
    .split('*')
    .map((segment) => escapeRegExp(segment))
    .join('.*');

  try {
    return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path);
  } catch {
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function truncate(value: string): string {
  return value.length > 60 ? `${value.slice(0, 57)}…` : value;
}

/** The path-and-query robots rules are matched against. */
export function robotsPath(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return '/';
  }
}
