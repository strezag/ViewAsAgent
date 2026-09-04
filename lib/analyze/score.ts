import type { CategoryScore, Finding, ReadinessScore, ScoreCategory } from '../types';

/**
 * An Agent Readiness score, derived entirely from findings.
 *
 * Every point deducted traces to a named finding with a fix, and the category
 * weights are visible in the UI. A score whose derivation is opaque is not
 * credible to the people who have to act on it — and would be easy to game
 * without improving anything real.
 */

interface CategoryDefinition {
  category: ScoreCategory;
  label: string;
  weight: number;
  /** One line explaining what this category measures. */
  description: string;
  /**
   * The levers that actually move this score, highest impact first.
   *
   * Individual findings carry a fix for the specific problem they name. These
   * answer the question a finding cannot: what would raise this category on a
   * page where nothing is obviously broken.
   */
  levers: string[];
}

export const CATEGORIES: CategoryDefinition[] = [
  {
    category: 'reachability',
    label: 'Reachability',
    weight: 30,
    description: 'Whether the agent can fetch the page at all.',
    levers: [
      'A 403, 429, or challenge page costs the most here. Check WAF rules, bot management, and rate limits before anything else.',
      'robots.txt is judged per crawler. Blocking a training crawler is a licensing choice; blocking a retrieval crawler removes you from answers people see today.',
      '`noindex`, whether from a meta tag or `X-Robots-Tag`, applies to AI answers too.',
    ],
  },
  {
    category: 'fidelity',
    label: 'Content fidelity',
    weight: 30,
    description: 'Whether the content survives the trip.',
    levers: [
      'Server-render or pre-render anything JavaScript injects. No major AI crawler runs JavaScript, so this one change fixes all of them at once.',
      'Content that disappears only for agents is usually a bot rule or a cache variant keyed on User-Agent.',
      'Wrap the main content in `<main>` or `<article>`. Agents use the same extraction heuristics this tool does.',
      'Give the page real headings. They are the outline an agent uses to find the passage that answers a question.',
    ],
  },
  {
    category: 'structured',
    label: 'Structured data',
    weight: 15,
    description: 'What the page tells a machine about itself.',
    levers: [
      'Emit JSON-LD server-side. Anything a tag manager injects after hydration is invisible to a crawler that does not render.',
      'Invalid JSON-LD is silently ignored, so a parse error means the markup is doing nothing at all.',
      '`<title>` and a meta description have to be in the HTML the agent receives. Canonical and JSON-LD help, but condensed agent HTML can identify the page without them.',
    ],
  },
  {
    category: 'efficiency',
    label: 'Efficiency',
    weight: 10,
    description: 'What the page costs an agent to read.',
    levers: [
      'Serving markdown through `Accept: text/markdown` is the direct fix and usually removes most of the payload.',
      'What matters is readable text as a share of the whole payload. Inline scripts and heavy markup push it down.',
      'Agents read inside a context budget, so a heavy page can be truncated before the part that answers the question.',
    ],
  },
  {
    category: 'affordances',
    label: 'Agent affordances',
    weight: 15,
    description: 'What the site offers agents beyond the page.',
    levers: [
      'Markdown helps coding agents; retrieval crawlers more often get condensed HTML. Either is fine if the payload is cheap to read.',
      'Declare your sitemap in robots.txt so crawlers do not have to guess where it is.',
      'If you route by User-Agent, add `Vary: User-Agent` or key the CDN cache on it. Otherwise a shared cache can serve the agent copy to a human.',
      'llms.txt is cheap to publish, though the evidence for its impact is thin.',
    ],
  },
];

/**
 * `evaluable` names the categories that could actually be measured. When an
 * agent cannot fetch the page there is no content to judge for fidelity,
 * structured data, or efficiency — and scoring those as perfect, which is what
 * "no findings means no deductions" would do, produced a comfortable score for
 * a page no agent can read. Unmeasurable categories are excluded from the
 * weighting instead, so the categories that *were* measured decide the score.
 */
export function scoreAudit(
  findings: Finding[],
  evaluable: ScoreCategory[] = CATEGORIES.map((c) => c.category),
): ReadinessScore {
  const evaluated = new Set(evaluable);

  const categories: CategoryScore[] = CATEGORIES.map((definition) => {
    const own = findings.filter((f) => f.category === definition.category);
    const deducted = own.reduce((total, finding) => total + finding.points, 0);
    return {
      category: definition.category,
      label: definition.label,
      score: clamp(100 - deducted),
      weight: definition.weight,
      evaluated: evaluated.has(definition.category),
      findings: own,
    };
  });

  const counted = categories.filter((c) => c.evaluated);
  const totalWeight = counted.reduce((sum, c) => sum + c.weight, 0);
  const overall =
    totalWeight === 0
      ? 0
      : Math.round(counted.reduce((sum, c) => sum + c.score * c.weight, 0) / totalWeight);

  return { overall, verdict: verdictFor(overall), categories };
}

export function categoryDescription(category: ScoreCategory): string {
  return CATEGORIES.find((c) => c.category === category)?.description ?? '';
}

export function categoryLabel(category: ScoreCategory): string {
  return CATEGORIES.find((c) => c.category === category)?.label ?? category;
}

export function categoryLevers(category: ScoreCategory): string[] {
  return CATEGORIES.find((c) => c.category === category)?.levers ?? [];
}

function verdictFor(score: number): string {
  if (score >= 90) return 'Agent-ready';
  if (score >= 75) return 'Mostly ready';
  if (score >= 50) return 'Needs work';
  if (score >= 25) return 'Poor';
  return 'Effectively invisible';
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}
