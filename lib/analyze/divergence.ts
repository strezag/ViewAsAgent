import type { AgentMatrixRow, RoutingOutcome } from '../types';

/**
 * The headline the product now leads with: do all the agents get the same page,
 * and if not, which ones do not.
 *
 * Every comparable tool audits what a site *declares* — robots.txt, llms.txt,
 * sitemaps, whether it answers `Accept: text/markdown`. None of them fetch the
 * page as each crawler and compare what actually came back. That comparison is
 * the thing this tool can say and they cannot, so it belongs at the front.
 */

export type DivergenceLevel = 'blocked' | 'divergent' | 'optimized' | 'uniform' | 'unknown';

export interface OutcomeGroup {
  outcome: RoutingOutcome;
  agents: string[];
}

export interface DivergenceSummary {
  level: DivergenceLevel;
  /** One sentence stating the finding. */
  headline: string;
  detail: string;
  total: number;
  blocked: string[];
  /** Agents robots.txt disallows, whatever the fetch returned. */
  robotsBlocked: string[];
  groups: OutcomeGroup[];
}

const OUTCOME_ORDER: RoutingOutcome[] = ['blocked', 'degraded', 'identical', 'optimized'];

export function summarizeDivergence(rows: AgentMatrixRow[]): DivergenceSummary {
  const total = rows.length;

  if (total === 0) {
    return {
      level: 'unknown',
      headline: 'No agents checked yet.',
      detail: 'Run a sweep to see what each crawler receives.',
      total: 0,
      blocked: [],
      robotsBlocked: [],
      groups: [],
    };
  }

  const groups = buildGroups(rows);
  const blocked = rows.filter((r) => r.outcome === 'blocked').map((r) => r.name);
  const robotsBlocked = rows.filter((r) => !r.robotsAllowed).map((r) => r.name);
  const distinctOutcomes = new Set(rows.map((r) => r.outcome));

  const base = { total, blocked, robotsBlocked, groups };

  if (blocked.length > 0) {
    return {
      ...base,
      level: 'blocked',
      headline:
        blocked.length === total
          ? 'No agent can read this page.'
          : `${blocked.length} of ${total} agents cannot read this page.`,
      detail: `${list(blocked)} came back with an error or a challenge. A crawler that cannot fetch the page cannot cite it, whatever else is on it.`,
    };
  }

  if (distinctOutcomes.size > 1) {
    return {
      ...base,
      level: 'divergent',
      headline: 'Agents are not all treated the same.',
      detail: describeGroups(groups),
    };
  }

  if (distinctOutcomes.has('optimized')) {
    return {
      ...base,
      level: 'optimized',
      headline: 'Every agent gets your agent-optimized version.',
      detail: `All ${total} crawlers receive something different from the page a browser is sent, and consistently so. Confirm that version stays in sync with the human page — drift here becomes a wrong answer in an assistant.`,
    };
  }

  if (distinctOutcomes.has('degraded')) {
    return {
      ...base,
      level: 'divergent',
      headline: 'Every agent gets less than a browser does.',
      detail: `All ${total} crawlers receive materially less content than the page a browser is sent. That is usually a bot rule or a cache variant rather than a deliberate choice.`,
    };
  }

  return {
    ...base,
    level: 'uniform',
    headline: 'Every agent receives the same page.',
    detail: `All ${total} crawlers get what a browser gets. Nothing at your edge is treating agents differently${
      robotsBlocked.length > 0 ? ', though robots.txt still disallows some of them' : ''
    }.`,
  };
}

function buildGroups(rows: AgentMatrixRow[]): OutcomeGroup[] {
  const byOutcome = new Map<RoutingOutcome, string[]>();
  for (const row of rows) {
    const existing = byOutcome.get(row.outcome);
    if (existing) existing.push(row.name);
    else byOutcome.set(row.outcome, [row.name]);
  }
  return OUTCOME_ORDER.filter((outcome) => byOutcome.has(outcome)).map((outcome) => ({
    outcome,
    agents: byOutcome.get(outcome) ?? [],
  }));
}

const OUTCOME_PHRASES: Record<RoutingOutcome, string> = {
  optimized: 'get a fuller or cleaner version',
  identical: 'get the same page a browser gets',
  degraded: 'get less than a browser gets',
  blocked: 'are refused',
};

function describeGroups(groups: OutcomeGroup[]): string {
  return `${groups
    .map((group) => `${list(group.agents)} ${OUTCOME_PHRASES[group.outcome]}`)
    .join('; ')}. Nothing in your analytics distinguishes these crawlers, so a difference here is invisible until someone looks.`;
}

/**
 * Which agent to open the deep audit on: the one with the most to say.
 *
 * A refused crawler outranks a healthy one, and a retrieval crawler outranks a
 * training one — being absent from answers people read today matters more than
 * being absent from a model trained next year.
 */
export function mostInterestingAgent(rows: AgentMatrixRow[]): string | null {
  if (rows.length === 0) return null;

  const outcomeRank: Record<RoutingOutcome, number> = {
    blocked: 0,
    degraded: 1,
    optimized: 2,
    identical: 3,
  };
  const categoryRank = (row: AgentMatrixRow): number =>
    row.category === 'retrieval' ? 0 : row.category === 'coding' ? 1 : 2;

  const rank = (row: AgentMatrixRow): number => outcomeRank[row.outcome] * 10 + categoryRank(row);

  // A stable sort keeps sweep order as the tiebreak.
  return [...rows].sort((a, b) => rank(a) - rank(b))[0]?.profileId ?? null;
}

/** "A", "A and B", "A, B and C", "A, B and 3 others". */
export function list(names: string[], max = 3): string {
  if (names.length === 0) return 'No agents';
  if (names.length === 1) return names[0]!;
  if (names.length <= max) {
    return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  }
  const shown = names.slice(0, max).join(', ');
  const rest = names.length - max;
  return `${shown} and ${rest} other${rest === 1 ? '' : 's'}`;
}
