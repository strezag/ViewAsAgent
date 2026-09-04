import { describe, expect, it } from 'vitest';
import { buildFindings, evaluableCategories } from './findings';
import { CATEGORIES, categoryLevers, scoreAudit } from './score';
import { toJson, toMarkdown, reportFilename } from './report';
import { computeGaps } from './gaps';
import { EMPTY_STRUCTURED } from '../extract/structured';
import type {
  AccessReport,
  AuditFacts,
  DocumentShape,
  DocumentSlot,
  ExtractedDoc,
  StructuredData,
} from '../types';

function doc(
  slot: DocumentSlot,
  words: number,
  over: Partial<{
    shape: DocumentShape;
    status: number;
    label: string;
    headings: string[];
    payloadTokens: number;
    payloadBytes: number;
    contentRatio: number;
    error: string;
  }> = {},
): ExtractedDoc {
  const text = Array.from({ length: words }, (_, i) => `word${i}`).join(' ');
  return {
    slot,
    label: over.label ?? slot,
    url: 'https://example.com/page',
    status: over.status ?? 200,
    contentType: 'text/html',
    shape: over.shape ?? 'article',
    title: 'Title',
    byline: null,
    excerpt: null,
    markdown: text,
    text,
    headings: (over.headings ?? ['A heading']).map((t) => ({ level: 2, text: t })),
    links: [],
    metrics: {
      payloadBytes: over.payloadBytes ?? text.length * 3,
      scriptBytes: 0,
      textChars: text.length,
      words,
      tokens: Math.ceil(words * 1.3),
      payloadTokens: over.payloadTokens ?? Math.ceil(words * 4),
      headingCount: (over.headings ?? ['A heading']).length,
      linkCount: 0,
      contentRatio: over.contentRatio ?? 0.33,
    },
    ...(over.error ? { error: over.error } : {}),
  };
}

function access(over: Partial<AccessReport> = {}): AccessReport {
  return {
    robots: null,
    robotsStatus: 404,
    verdicts: [],
    directives: {
      metaRobots: [],
      xRobotsTag: [],
      noindex: false,
      nosnippet: false,
      noai: false,
      noimageai: false,
    },
    affordances: {
      llmsTxt: false,
      llmsFullTxt: false,
      markdownNegotiation: false,
      dotMd: false,
      jsonLdNegotiation: false,
      sitemapsDeclared: [],
      sitemapReachable: true,
    },
    edge: {
      vendors: [],
      varyOnUserAgent: false,
      varyOnAccept: false,
      agentOnlyHeaders: [],
      changedHeaders: [],
      signals: [],
    },
    ...over,
  };
}

function structured(over: Partial<StructuredData> = {}): StructuredData {
  return { ...EMPTY_STRUCTURED, ...over };
}

function facts(over: Partial<AuditFacts> = {}): AuditFacts {
  const rendered = over.rendered !== undefined ? over.rendered : doc('rendered', 500);
  const raw = over.raw ?? doc('rawBrowser', 500);
  const agent = over.agent ?? doc('rawAgent', 500, { label: 'GPTBot' });
  return {
    url: 'https://example.com/page',
    profileName: 'GPTBot',
    profileCategory: 'training',
    profileRendersJavaScript: false,
    rendered,
    raw,
    agent,
    gaps: over.gaps ?? computeGaps(rendered, raw, agent),
    access: over.access ?? access(),
    structured: over.structured ?? {
      rendered: structured({ meta: { ...EMPTY_STRUCTURED.meta, title: 'T', description: 'D', canonical: 'C' } }),
      agent: structured({ meta: { ...EMPTY_STRUCTURED.meta, title: 'T', description: 'D', canonical: 'C' } }),
    },
    redirectedOnlyForAgent: false,
    ...over,
  };
}

const byId = (list: ReturnType<typeof buildFindings>, id: string) => list.find((f) => f.id === id);

describe('reachability findings', () => {
  it('makes a blocked fetch the most severe thing on the page', () => {
    const agent = doc('rawAgent', 0, { shape: 'error', status: 403, label: 'GPTBot', error: 'HTTP 403' });
    const list = buildFindings(facts({ agent, gaps: computeGaps(doc('rendered', 500), doc('rawBrowser', 500), agent) }));

    expect(list[0]?.id).toBe('agent-blocked');
    expect(list[0]?.level).toBe('critical');
  });

  it('treats a robots block on a training crawler as a choice, not a fault', () => {
    const list = buildFindings(
      facts({
        profileCategory: 'training',
        access: access({
          verdicts: [
            {
              profileId: 'gptbot',
              name: 'GPTBot',
              vendor: 'OpenAI',
              category: 'training',
              verdict: { allowed: false, matchedAgent: 'gptbot', matchedRule: null, reason: 'blocked' },
            },
          ],
        }),
      }),
    );

    const finding = byId(list, 'robots-blocked');
    expect(finding?.level).toBe('notice');
    expect(finding?.points).toBe(0);
  });

  it('treats a robots block on a retrieval crawler as critical', () => {
    const list = buildFindings(
      facts({
        profileName: 'PerplexityBot',
        profileCategory: 'retrieval',
        access: access({
          verdicts: [
            {
              profileId: 'perplexitybot',
              name: 'PerplexityBot',
              vendor: 'Perplexity',
              category: 'retrieval',
              verdict: { allowed: false, matchedAgent: '*', matchedRule: null, reason: 'blocked' },
            },
          ],
        }),
      }),
    );

    const finding = byId(list, 'robots-blocked');
    expect(finding?.level).toBe('critical');
    expect(finding?.points).toBeGreaterThan(0);
  });

  it('reports a clean page as reachable rather than saying nothing', () => {
    expect(byId(buildFindings(facts()), 'reachable')?.level).toBe('good');
  });
});

describe('fidelity findings', () => {
  it('reports the JavaScript gap for a crawler that cannot render', () => {
    const rendered = doc('rendered', 1000);
    const raw = doc('rawBrowser', 10, { shape: 'empty', headings: [] });
    const agent = doc('rawAgent', 10, { shape: 'empty', label: 'GPTBot', headings: [] });
    const list = buildFindings(facts({ rendered, raw, agent, gaps: computeGaps(rendered, raw, agent) }));

    const finding = byId(list, 'javascript-gap');
    expect(finding?.level).toBe('critical');
    expect(finding?.points).toBeGreaterThan(50);
  });

  it('does not blame JavaScript for a crawler that renders it', () => {
    const rendered = doc('rendered', 1000);
    const raw = doc('rawBrowser', 10, { shape: 'empty' });
    const agent = doc('rawAgent', 10, { shape: 'empty', label: 'Googlebot' });
    const list = buildFindings(
      facts({
        profileName: 'Googlebot',
        profileCategory: 'retrieval',
        profileRendersJavaScript: true,
        rendered,
        raw,
        agent,
        gaps: computeGaps(rendered, raw, agent),
      }),
    );

    expect(byId(list, 'javascript-gap')).toBeUndefined();
  });

  it('says so when the whole page survives', () => {
    const finding = byId(buildFindings(facts()), 'content-intact');
    expect(finding?.level).toBe('good');
    expect(finding?.evidence).toContain('matching what a browser is sent');
  });

  it('does not claim the agent copy matches the browser when it is fuller', () => {
    const headings = ['Overview', 'How to', 'FAQ'];
    const rendered = doc('rendered', 1500, { headings });
    const raw = doc('rawBrowser', 1500, { headings, payloadTokens: 50_000 });
    const agent = doc('rawAgent', 2100, {
      headings,
      payloadTokens: 4_000,
      contentRatio: 0.85,
      label: 'ChatGPT-User',
    });
    const list = buildFindings(
      facts({
        profileName: 'ChatGPT-User',
        rendered,
        raw,
        agent,
        gaps: computeGaps(rendered, raw, agent),
      }),
    );

    expect(byId(list, 'content-intact')?.evidence).not.toContain('matching what a browser is sent');
  });

  it('does not deduct points for a lean, structurally-intact agent response', () => {
    // Reproduces a real report: the agent got 27% of the browser's word count,
    // but every heading survived and the payload was mostly content, not
    // markup. That used to score a critical -40 "routing-degraded" finding —
    // penalizing exactly the outcome agent-facing optimization is meant to
    // produce. It must now read as a good finding worth zero points.
    const headings = ['Overview', 'Pricing', 'FAQ', 'Support', 'Contact'];
    const rendered = doc('rendered', 1400, { headings });
    const raw = doc('rawBrowser', 1400, { headings, payloadTokens: 5600 });
    const agent = doc('rawAgent', 380, { headings, payloadTokens: 700, label: 'GPTBot' });
    const auditFacts = facts({ rendered, raw, agent, gaps: computeGaps(rendered, raw, agent) });

    expect(auditFacts.gaps.outcome).toBe('optimized');

    const list = buildFindings(auditFacts);
    expect(byId(list, 'routing-degraded')).toBeUndefined();
    const finding = byId(list, 'routing-optimized');
    expect(finding?.level).toBe('good');
    expect(finding?.points).toBe(0);

    const score = scoreAudit(list, evaluableCategories(auditFacts));
    expect(score.categories.find((c) => c.category === 'fidelity')?.score).toBe(100);
  });
});

describe('structured data findings', () => {
  it('flags JSON-LD that only exists after JavaScript', () => {
    const list = buildFindings(
      facts({
        structured: {
          rendered: structured({
            jsonLd: [{ types: ['Article'], parsed: {}, raw: '{}' }],
          }),
          agent: structured(),
        },
      }),
    );

    const finding = byId(list, 'jsonld-after-js');
    expect(finding?.level).toBe('warning');
    expect(finding?.points).toBe(35);
    expect(finding?.evidence).toContain('GPTBot receives 0');
  });

  it('does not deduct JSON-LD or canonical on lean optimized agent HTML', () => {
    const headings = ['Overview', 'How to', 'FAQ'];
    const rendered = doc('rendered', 1500, { headings });
    const raw = doc('rawBrowser', 1500, { headings, payloadTokens: 50_000 });
    const agent = doc('rawAgent', 2100, {
      headings,
      payloadTokens: 4_000,
      contentRatio: 0.85,
      label: 'ChatGPT-User',
    });
    const auditFacts = facts({
      profileName: 'ChatGPT-User',
      rendered,
      raw,
      agent,
      gaps: computeGaps(rendered, raw, agent),
      structured: {
        rendered: structured({
          jsonLd: [
            { types: ['Article'], parsed: {}, raw: '{}' },
            { types: ['BreadcrumbList'], parsed: {}, raw: '{}' },
            { types: ['Organization'], parsed: {}, raw: '{}' },
          ],
          meta: { ...EMPTY_STRUCTURED.meta, title: 'How-to', description: 'Guide.' },
        }),
        agent: structured({
          meta: { ...EMPTY_STRUCTURED.meta, title: 'How-to', description: 'Guide.' },
        }),
      },
    });
    expect(auditFacts.gaps.outcome).toBe('optimized');

    const list = buildFindings(auditFacts);
    expect(byId(list, 'jsonld-after-js')?.points).toBe(0);
    expect(byId(list, 'jsonld-after-js')?.level).toBe('notice');
    expect(byId(list, 'no-canonical')?.points).toBe(0);
    expect(byId(list, 'no-title')).toBeUndefined();
    expect(byId(list, 'no-description')).toBeUndefined();

    const score = scoreAudit(list, evaluableCategories(auditFacts));
    expect(score.categories.find((c) => c.category === 'structured')?.score).toBe(100);
  });

  it('still deducts a missing title on lean optimized HTML', () => {
    const headings = ['Overview', 'How to', 'FAQ'];
    const rendered = doc('rendered', 1500, { headings });
    const raw = doc('rawBrowser', 1500, { headings, payloadTokens: 50_000 });
    const agent = doc('rawAgent', 2100, {
      headings,
      payloadTokens: 4_000,
      contentRatio: 0.85,
      label: 'ChatGPT-User',
    });
    const list = buildFindings(
      facts({
        profileName: 'ChatGPT-User',
        rendered,
        raw,
        agent,
        gaps: computeGaps(rendered, raw, agent),
        structured: {
          rendered: structured({ meta: { ...EMPTY_STRUCTURED.meta, title: 'How-to' } }),
          agent: structured({ meta: { ...EMPTY_STRUCTURED.meta, description: 'Guide.' } }),
        },
      }),
    );

    expect(byId(list, 'no-title')?.points).toBe(20);
  });

  it('flags JSON-LD that will not parse', () => {
    const list = buildFindings(
      facts({
        structured: {
          rendered: null,
          agent: structured({
            jsonLd: [{ types: [], parsed: null, raw: '{bad', error: 'Unexpected token' }],
          }),
        },
      }),
    );
    expect(byId(list, 'jsonld-invalid')?.level).toBe('warning');
  });

  it('does not demand structured data on an error page', () => {
    const agent = doc('rawAgent', 0, { shape: 'error', status: 500, label: 'GPTBot' });
    const list = buildFindings(facts({ agent, structured: { rendered: null, agent: structured() } }));
    expect(byId(list, 'no-jsonld')).toBeUndefined();
    expect(byId(list, 'no-description')).toBeUndefined();
  });
});

describe('efficiency findings', () => {
  it('flags a page that is expensive to read', () => {
    const agent = doc('rawAgent', 5000, { label: 'GPTBot', payloadTokens: 90_000 });
    const list = buildFindings(facts({ agent }));
    expect(byId(list, 'heavy-payload')?.level).toBe('warning');
  });

  it('flags a payload that is mostly markup', () => {
    const agent = doc('rawAgent', 200, {
      label: 'GPTBot',
      contentRatio: 0.02,
      payloadBytes: 400_000,
    });
    expect(byId(buildFindings(facts({ agent })), 'markup-heavy')?.level).toBe('notice');
  });
});

describe('affordance findings', () => {
  function leanOptimizedFacts(over: Partial<AuditFacts> = {}) {
    const headings = ['Overview', 'How to', 'FAQ'];
    const rendered = doc('rendered', 1500, { headings });
    const raw = doc('rawBrowser', 1500, { headings, payloadTokens: 50_000 });
    const agent = doc('rawAgent', 2100, {
      headings,
      payloadTokens: 4_000,
      contentRatio: 0.85,
      label: 'ChatGPT-User',
    });
    return facts({
      profileName: 'ChatGPT-User',
      profileCategory: 'retrieval',
      rendered,
      raw,
      agent,
      gaps: computeGaps(rendered, raw, agent),
      access: access({
        affordances: {
          llmsTxt: false,
          llmsFullTxt: false,
          markdownNegotiation: false,
          dotMd: false,
          jsonLdNegotiation: false,
          sitemapsDeclared: [],
          sitemapReachable: false,
        },
      }),
      ...over,
    });
  }

  it('does not deduct for missing markdown or sitemap when the agent HTML is already lean', () => {
    const auditFacts = leanOptimizedFacts();
    expect(auditFacts.gaps.outcome).toBe('optimized');

    const list = buildFindings(auditFacts);
    expect(byId(list, 'no-markdown-negotiation')?.points).toBe(0);
    expect(byId(list, 'no-sitemap')?.points).toBe(0);
    expect(byId(list, 'no-markdown-negotiation')?.evidence).toContain('not scored');

    const score = scoreAudit(list, evaluableCategories(auditFacts));
    expect(score.categories.find((c) => c.category === 'affordances')?.score).toBe(100);
  });

  it('still deducts markdown and sitemap on an identical, unoptimized page', () => {
    const list = buildFindings(
      facts({
        access: access({
          affordances: {
            llmsTxt: false,
            llmsFullTxt: false,
            markdownNegotiation: false,
            dotMd: false,
            jsonLdNegotiation: false,
            sitemapsDeclared: [],
            sitemapReachable: false,
          },
        }),
      }),
    );

    expect(byId(list, 'no-markdown-negotiation')?.points).toBe(30);
    expect(byId(list, 'no-sitemap')?.points).toBe(25);
  });

  it('still deducts markdown when optimized delivery is still expensive to read', () => {
    const headings = ['Overview', 'How to', 'FAQ'];
    const rendered = doc('rendered', 1500, { headings });
    const raw = doc('rawBrowser', 1500, { headings, payloadTokens: 80_000 });
    const agent = doc('rawAgent', 2100, {
      headings,
      payloadTokens: 90_000,
      contentRatio: 0.02,
      payloadBytes: 400_000,
      label: 'ChatGPT-User',
    });
    const auditFacts = facts({
      profileName: 'ChatGPT-User',
      rendered,
      raw,
      agent,
      gaps: computeGaps(rendered, raw, agent),
    });
    expect(auditFacts.gaps.outcome).toBe('optimized');
    expect(byId(buildFindings(auditFacts), 'no-markdown-negotiation')?.points).toBe(30);
  });

  it('still deducts a missing Vary header on lean optimized delivery', () => {
    const list = buildFindings(
      leanOptimizedFacts({
        access: access({
          affordances: {
            llmsTxt: false,
            llmsFullTxt: false,
            markdownNegotiation: false,
            dotMd: false,
            jsonLdNegotiation: false,
            sitemapsDeclared: [],
            sitemapReachable: false,
          },
          edge: {
            vendors: [],
            varyOnUserAgent: false,
            varyOnAccept: false,
            agentOnlyHeaders: [],
            changedHeaders: [],
            signals: [
              {
                label: 'Agent routing without Vary: User-Agent',
                detail: 'Responses differ by user agent but no Vary header says so.',
                agentSpecific: true,
              },
            ],
          },
        }),
      }),
    );

    expect(byId(list, 'vary-missing')?.points).toBe(20);
    expect(byId(list, 'no-markdown-negotiation')?.points).toBe(0);
  });
});

describe('scoreAudit', () => {
  it('gives a clean page a high score and a positive verdict', () => {
    const score = scoreAudit(buildFindings(facts()));
    expect(score.overall).toBeGreaterThan(60);
    expect(score.categories).toHaveLength(5);
  });

  it('collapses the score when the agent cannot fetch the page', () => {
    // Fidelity, structured data and efficiency have nothing to measure here.
    // Scoring them as perfect once gave a page no agent can read a 76.
    const agent = doc('rawAgent', 0, { shape: 'error', status: 403, label: 'GPTBot' });
    const blocked = facts({
      agent,
      gaps: computeGaps(doc('rendered', 500), doc('rawBrowser', 500), agent),
    });
    const findings = buildFindings(blocked);
    const score = scoreAudit(findings, evaluableCategories(blocked));

    expect(score.categories.find((c) => c.category === 'reachability')?.score).toBeLessThan(50);
    expect(score.overall).toBeLessThan(50);
    expect(score.verdict).not.toBe('Mostly ready');
  });

  it('excludes categories it could not measure instead of scoring them full marks', () => {
    const agent = doc('rawAgent', 0, { shape: 'error', status: 403, label: 'GPTBot' });
    const blocked = facts({
      agent,
      gaps: computeGaps(doc('rendered', 500), doc('rawBrowser', 500), agent),
    });
    const score = scoreAudit(buildFindings(blocked), evaluableCategories(blocked));

    const unevaluated = score.categories.filter((c) => !c.evaluated).map((c) => c.category);
    expect(unevaluated).toEqual(['fidelity', 'structured', 'efficiency']);
  });

  it('evaluates every category on a page the agent can read', () => {
    const clean = facts();
    expect(evaluableCategories(clean)).toHaveLength(5);
    expect(scoreAudit(buildFindings(clean), evaluableCategories(clean)).categories.every((c) => c.evaluated)).toBe(true);
  });

  it('never leaves a category outside 0 to 100', () => {
    const agent = doc('rawAgent', 0, { shape: 'error', status: 403, label: 'GPTBot' });
    const score = scoreAudit(
      buildFindings(
        facts({
          agent,
          gaps: computeGaps(doc('rendered', 500), doc('rawBrowser', 500), agent),
          access: access({
            directives: {
              metaRobots: ['noindex'],
              xRobotsTag: [],
              noindex: true,
              nosnippet: false,
              noai: false,
              noimageai: false,
            },
          }),
        }),
      ),
    );

    for (const category of score.categories) {
      expect(category.score).toBeGreaterThanOrEqual(0);
      expect(category.score).toBeLessThanOrEqual(100);
    }
  });

  it('accounts for every deduction with a finding that has a fix', () => {
    const findings = buildFindings(facts({ agent: doc('rawAgent', 5000, { label: 'GPTBot', payloadTokens: 90_000 }) }));
    for (const finding of findings) {
      if (finding.points > 0) expect(finding.fix.length).toBeGreaterThan(0);
      if (finding.level === 'good') expect(finding.points).toBe(0);
    }
  });
});

describe('report export', () => {
  const input = () => {
    const f = facts();
    const findings = buildFindings(f);
    return { facts: f, findings, score: scoreAudit(findings), at: Date.UTC(2026, 7, 24) };
  };

  it('carries the simulated-fetch caveat into the exported markdown', () => {
    // A finding pasted into a ticket without this could send someone chasing a
    // difference that only exists because the request came from a laptop.
    const markdown = toMarkdown(input());
    expect(markdown).toContain('Simulated agent fetch');
    expect(markdown).toContain('residential IP');
  });

  it('includes the score, the categories, and every finding title', () => {
    const data = input();
    const markdown = toMarkdown(data);
    expect(markdown).toContain(`Score **${data.score.overall}/100**`);
    expect(markdown).toContain('| Content fidelity |');
    for (const finding of data.findings) {
      expect(markdown).toContain(finding.title);
    }
  });

  it('produces JSON that round-trips', () => {
    const parsed = JSON.parse(toJson(input())) as Record<string, unknown>;
    expect(parsed.tool).toBe('ViewAsAgent');
    expect(parsed.simulated).toBe(true);
    expect(parsed.url).toBe('https://example.com/page');
  });

  it('builds a filename that says which page, agent, and day', () => {
    const name = reportFilename(facts(), Date.UTC(2026, 7, 24), '.md');
    expect(name).toBe('example.com-page-gptbot-2026-08-24.md');
  });

  it('explains how to improve the categories that lost points', () => {
    const markdown = toMarkdown(input());
    expect(markdown).toContain('### What moves each score');

    // Affordances always loses points in this fixture (no markdown negotiation).
    const affordances = categoryLevers('affordances')[0]!;
    expect(markdown).toContain(affordances);
  });

  it('leaves out advice for a category that is already at full marks', () => {
    const data = input();
    const reachability = data.score.categories.find((c) => c.category === 'reachability');
    // Guard the premise: this fixture has nothing wrong with reachability.
    expect(reachability?.score).toBe(100);

    const markdown = toMarkdown(data);
    expect(markdown).not.toContain(categoryLevers('reachability')[0]!);
  });

  it('omits the section entirely when nothing can be improved', () => {
    const perfect = {
      ...input(),
      score: scoreAudit([]),
    };
    expect(toMarkdown(perfect)).not.toContain('### What moves each score');
  });
});

describe('category guidance', () => {
  it('gives every category levers, so none can ship without advice', () => {
    for (const category of CATEGORIES) {
      expect(categoryLevers(category.category).length, category.label).toBeGreaterThan(0);
    }
  });

  it('keeps each lever short enough to read in a popover', () => {
    for (const category of CATEGORIES) {
      for (const lever of categoryLevers(category.category)) {
        expect(lever.length, `${category.label}: ${lever}`).toBeLessThan(200);
        expect(lever.endsWith('.'), `${category.label}: ${lever}`).toBe(true);
      }
    }
  });

  it('balances backticks, which the panel splits on to render code', () => {
    for (const category of CATEGORIES) {
      for (const lever of categoryLevers(category.category)) {
        const ticks = (lever.match(/`/g) ?? []).length;
        expect(ticks % 2, `${category.label}: ${lever}`).toBe(0);
      }
    }
  });
});
