import { describe, expect, it } from 'vitest';
import { list, mostInterestingAgent, summarizeDivergence } from './divergence';
import type { AgentMatrixRow, RoutingOutcome } from '../types';

function row(
  name: string,
  outcome: RoutingOutcome,
  over: Partial<AgentMatrixRow> = {},
): AgentMatrixRow {
  return {
    profileId: name.toLowerCase(),
    name,
    vendor: 'Vendor',
    category: 'retrieval',
    status: outcome === 'blocked' ? 403 : 200,
    words: outcome === 'blocked' ? 0 : 500,
    tokens: 650,
    shape: outcome === 'blocked' ? 'error' : 'article',
    contentType: 'text/html',
    outcome,
    robotsAllowed: true,
    ...over,
  };
}

describe('summarizeDivergence', () => {
  it('leads with blocked agents, because a refusal outranks everything else', () => {
    const summary = summarizeDivergence([
      row('GPTBot', 'identical'),
      row('ClaudeBot', 'blocked'),
      row('PerplexityBot', 'identical'),
    ]);

    expect(summary.level).toBe('blocked');
    expect(summary.headline).toBe('1 of 3 agents cannot read this page.');
    expect(summary.blocked).toEqual(['ClaudeBot']);
    expect(summary.detail).toContain('cannot cite it');
  });

  it('says so plainly when nothing can read the page', () => {
    const summary = summarizeDivergence([row('GPTBot', 'blocked'), row('ClaudeBot', 'blocked')]);
    expect(summary.headline).toBe('No agent can read this page.');
  });

  it('reports uneven treatment and names who gets what', () => {
    const summary = summarizeDivergence([
      row('GPTBot', 'identical'),
      row('OAI-SearchBot', 'optimized'),
      row('PerplexityBot', 'degraded'),
    ]);

    expect(summary.level).toBe('divergent');
    expect(summary.headline).toBe('Agents are not all treated the same.');
    expect(summary.detail).toContain('PerplexityBot get less than a browser gets');
    expect(summary.detail).toContain('OAI-SearchBot get a fuller or cleaner version');
  });

  it('groups agents by what they received, worst first', () => {
    const summary = summarizeDivergence([
      row('A', 'optimized'),
      row('B', 'degraded'),
      row('C', 'optimized'),
      row('D', 'identical'),
    ]);

    expect(summary.groups.map((g) => g.outcome)).toEqual(['degraded', 'identical', 'optimized']);
    expect(summary.groups.find((g) => g.outcome === 'optimized')?.agents).toEqual(['A', 'C']);
  });

  it('recognises consistent optimization, and warns about drift rather than celebrating', () => {
    const summary = summarizeDivergence([row('A', 'optimized'), row('B', 'optimized')]);

    expect(summary.level).toBe('optimized');
    expect(summary.headline).toBe('Every agent gets your agent-optimized version.');
    // An optimized variant that goes stale is the expensive failure mode.
    expect(summary.detail).toContain('stays in sync');
  });

  it('does not call uniform degradation a success', () => {
    const summary = summarizeDivergence([row('A', 'degraded'), row('B', 'degraded')]);
    expect(summary.level).toBe('divergent');
    expect(summary.headline).toContain('less than a browser');
  });

  it('reports the uniform case as the plain answer it is', () => {
    const summary = summarizeDivergence([row('A', 'identical'), row('B', 'identical')]);
    expect(summary.level).toBe('uniform');
    expect(summary.headline).toBe('Every agent receives the same page.');
  });

  it('mentions robots even when every fetch succeeded', () => {
    // A crawler that fetched fine but is disallowed still will not crawl you.
    const summary = summarizeDivergence([
      row('A', 'identical'),
      row('B', 'identical', { robotsAllowed: false }),
    ]);

    expect(summary.robotsBlocked).toEqual(['B']);
    expect(summary.detail).toContain('robots.txt still disallows');
  });

  it('handles an empty sweep without inventing a verdict', () => {
    const summary = summarizeDivergence([]);
    expect(summary.level).toBe('unknown');
    expect(summary.total).toBe(0);
  });
});

describe('mostInterestingAgent', () => {
  it('opens on a refused crawler over a healthy one', () => {
    const chosen = mostInterestingAgent([
      row('GPTBot', 'identical'),
      row('ClaudeBot', 'blocked'),
      row('PerplexityBot', 'optimized'),
    ]);
    expect(chosen).toBe('claudebot');
  });

  it('prefers degraded over merely different', () => {
    expect(
      mostInterestingAgent([row('A', 'optimized'), row('B', 'degraded'), row('C', 'identical')]),
    ).toBe('b');
  });

  it('breaks ties toward retrieval, which affects answers people read today', () => {
    const chosen = mostInterestingAgent([
      row('Trainer', 'blocked', { profileId: 'trainer', category: 'training' }),
      row('Searcher', 'blocked', { profileId: 'searcher', category: 'retrieval' }),
    ]);
    expect(chosen).toBe('searcher');
  });

  it('falls back to sweep order when everything is equal', () => {
    expect(mostInterestingAgent([row('First', 'identical'), row('Second', 'identical')])).toBe(
      'first',
    );
  });

  it('returns null for an empty sweep', () => {
    expect(mostInterestingAgent([])).toBeNull();
  });
});

describe('list', () => {
  it('reads as English at every length', () => {
    expect(list([])).toBe('No agents');
    expect(list(['A'])).toBe('A');
    expect(list(['A', 'B'])).toBe('A and B');
    expect(list(['A', 'B', 'C'])).toBe('A, B and C');
    expect(list(['A', 'B', 'C', 'D'])).toBe('A, B, C and 1 other');
    expect(list(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 others');
  });
});
