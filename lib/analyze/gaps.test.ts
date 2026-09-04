import { describe, expect, it } from 'vitest';
import { computeGaps, condenseDiff, percent } from './gaps';
import type { DocumentShape, DocumentSlot, ExtractedDoc } from '../types';

/** Builds a document with the metrics the gap analysis actually reads. */
function doc(
  slot: DocumentSlot,
  words: number,
  options: Partial<{
    shape: DocumentShape;
    status: number;
    headings: string[];
    markdown: string;
    payloadTokens: number;
    label: string;
    error: string;
  }> = {},
): ExtractedDoc {
  const text = Array.from({ length: words }, (_, i) => `word${i}`).join(' ');
  return {
    slot,
    label: options.label ?? slot,
    url: 'https://example.com/page',
    status: options.status ?? 200,
    contentType: 'text/html',
    shape: options.shape ?? 'article',
    title: 'Title',
    byline: null,
    excerpt: null,
    markdown: options.markdown ?? text,
    text,
    headings: (options.headings ?? []).map((t) => ({ level: 2, text: t })),
    links: [],
    metrics: {
      payloadBytes: text.length * 3,
      scriptBytes: 0,
      textChars: text.length,
      words,
      tokens: Math.ceil(words * 1.3),
      payloadTokens: options.payloadTokens ?? Math.ceil(words * 4),
      headingCount: (options.headings ?? []).length,
      linkCount: 0,
      contentRatio: 0.33,
    },
    ...(options.error ? { error: options.error } : {}),
  };
}

describe('the JavaScript gap', () => {
  it('is critical when the raw HTML is an empty shell', () => {
    const report = computeGaps(doc('rendered', 600), doc('rawBrowser', 2, { shape: 'empty' }), doc('rawAgent', 2, { shape: 'empty' }));
    expect(report.javascript?.severity).toBe('critical');
    expect(report.javascript?.headline).toContain('effectively blank');
  });

  it('is absent when the page is fully server-rendered', () => {
    const report = computeGaps(doc('rendered', 600), doc('rawBrowser', 600), doc('rawAgent', 600));
    expect(report.javascript?.severity).toBe('none');
    expect(report.javascript?.retainedRatio).toBe(1);
  });

  it('scales with how much content JavaScript adds', () => {
    const major = computeGaps(doc('rendered', 1000), doc('rawBrowser', 400), doc('rawAgent', 400));
    expect(major.javascript?.severity).toBe('major');

    const minor = computeGaps(doc('rendered', 1000), doc('rawBrowser', 800), doc('rawAgent', 800));
    expect(minor.javascript?.severity).toBe('minor');
  });

  it('does not draw conclusions from a page with almost no text', () => {
    const report = computeGaps(doc('rendered', 10), doc('rawBrowser', 1), doc('rawAgent', 1));
    expect(report.javascript?.severity).toBe('none');
    expect(report.javascript?.detail).toContain('too little text');
  });

  it('is null when the rendered page could not be captured', () => {
    const report = computeGaps(null, doc('rawBrowser', 500), doc('rawAgent', 500));
    expect(report.javascript).toBeNull();
    expect(report.endToEndRetainedRatio).toBeNull();
  });

  it('names the headings that do not survive', () => {
    const report = computeGaps(
      doc('rendered', 600, { headings: ['Pricing', 'FAQ', 'Support'] }),
      doc('rawBrowser', 300, { headings: ['Support'] }),
      doc('rawAgent', 300, { headings: ['Support'] }),
    );
    expect(report.javascript?.missingHeadings).toEqual(['Pricing', 'FAQ']);
  });
});

describe('the routing gap', () => {
  it('reports a block rather than treating it as lost content', () => {
    const report = computeGaps(
      doc('rendered', 600),
      doc('rawBrowser', 600),
      doc('rawAgent', 0, { shape: 'error', status: 403, label: 'ClaudeBot', error: 'HTTP 403' }),
    );
    expect(report.outcome).toBe('blocked');
    expect(report.routing.severity).toBe('critical');
    expect(report.routing.headline).toBe('ClaudeBot was refused.');
    expect(report.routing.detail).toContain('403');
  });

  it('calls markdown negotiation optimization even at similar length', () => {
    const report = computeGaps(
      doc('rendered', 500),
      doc('rawBrowser', 500, { payloadTokens: 8000 }),
      doc('rawAgent', 500, { shape: 'markdown', payloadTokens: 700, label: 'Coding agent' }),
    );
    expect(report.outcome).toBe('optimized');
    expect(report.routing.severity).toBe('none');
    expect(report.routing.headline).toContain('markdown');
    // The token saving is the argument, so it belongs in the copy.
    expect(report.routing.detail).toContain('less to read');
  });

  it('recognises an edge that serves agents a fuller page', () => {
    const report = computeGaps(
      doc('rendered', 600),
      doc('rawBrowser', 100),
      doc('rawAgent', 600, { label: 'GPTBot' }),
    );
    expect(report.outcome).toBe('optimized');
  });

  it('recognises no routing at all', () => {
    const report = computeGaps(doc('rendered', 600), doc('rawBrowser', 600), doc('rawAgent', 600));
    expect(report.outcome).toBe('identical');
    expect(report.routing.severity).toBe('none');
  });

  it('flags content that disappears only for agents', () => {
    const report = computeGaps(
      doc('rendered', 600),
      doc('rawBrowser', 600),
      doc('rawAgent', 200, { label: 'PerplexityBot' }),
    );
    expect(report.outcome).toBe('degraded');
    expect(report.routing.severity).toBe('major');
    expect(report.routing.headline).toContain('PerplexityBot');
  });

  it('does not call a lean, structurally-intact response "degraded" just because it is shorter', () => {
    // The exact shape of a real report: fewer words, every heading survives,
    // and the payload the agent got carries little markup overhead. Trimming
    // boilerplate for a machine reader is the goal of agent formatting, not a
    // fault — penalizing it was the bug this test guards against.
    const headings = ['Overview', 'Pricing', 'FAQ', 'Support', 'Contact'];
    const report = computeGaps(
      doc('rendered', 1400, { headings }),
      doc('rawBrowser', 1400, { headings, payloadTokens: 5600 }),
      doc('rawAgent', 380, { headings, payloadTokens: 700, label: 'Claude-SearchBot' }),
    );

    expect(report.outcome).toBe('optimized');
    expect(report.routing.severity).toBe('none');
    expect(report.routing.headline).toContain('leaner');
    expect(report.routing.headline).not.toContain('fuller');
    expect(report.routing.detail).toContain('spot check');
  });

  it('still calls it degraded when a whole section actually disappears', () => {
    // Same word ratio and the same lean payload as the case above — the only
    // difference is that "Support" never reaches the agent. A missing section
    // is real evidence of loss that a lean payload does not excuse.
    const report = computeGaps(
      doc('rendered', 1400, { headings: ['Overview', 'Pricing', 'FAQ', 'Support', 'Contact'] }),
      doc('rawBrowser', 1400, {
        headings: ['Overview', 'Pricing', 'FAQ', 'Support', 'Contact'],
        payloadTokens: 5600,
      }),
      doc('rawAgent', 380, {
        headings: ['Overview', 'Pricing', 'FAQ', 'Contact'],
        payloadTokens: 700,
        label: 'Claude-SearchBot',
      }),
    );

    expect(report.outcome).toBe('degraded');
    expect(report.routing.missingHeadings).toEqual(['Support']);
  });

  it('does not excuse a bloated response just because headings survive', () => {
    // Headings intact, but the payload itself is not lean (heavy markup
    // overhead) and not meaningfully smaller than the browser's — structure
    // alone is not sufficient evidence of deliberate formatting.
    const headings = ['Overview', 'Pricing'];
    const report = computeGaps(
      doc('rendered', 1000, { headings }),
      doc('rawBrowser', 1000, { headings, payloadTokens: 4000 }),
      doc('rawAgent', 300, { headings, payloadTokens: 3800, label: 'GPTBot' }),
    );

    expect(report.outcome).toBe('degraded');
  });

  it('falls back to the word ratio alone when there are no headings to check', () => {
    // With nothing to corroborate "condensed, not missing", the conservative
    // read is the right one even if the payload happens to look lean.
    const report = computeGaps(
      doc('rendered', 600),
      doc('rawBrowser', 600, { payloadTokens: 2400 }),
      doc('rawAgent', 200, { payloadTokens: 300, label: 'PerplexityBot' }),
    );

    expect(report.outcome).toBe('degraded');
  });
});

describe('end-to-end retention', () => {
  it('measures the rendered page against what the agent finally got', () => {
    const report = computeGaps(doc('rendered', 1000), doc('rawBrowser', 400), doc('rawAgent', 250));
    expect(report.endToEndRetainedRatio).toBeCloseTo(0.25, 5);
  });
});

describe('condenseDiff', () => {
  it('marks what was removed and what was added', () => {
    const { diff } = condenseDiff('alpha beta gamma', 'alpha delta gamma');
    expect(diff.some((s) => s.removed && s.value.includes('beta'))).toBe(true);
    expect(diff.some((s) => s.added && s.value.includes('delta'))).toBe(true);
  });

  it('collapses long unchanged passages so the changes stay visible', () => {
    const shared = Array.from({ length: 200 }, (_, i) => `w${i}`).join(' ');
    const { diff, truncated } = condenseDiff(`${shared} removed`, `${shared} added`);

    expect(truncated).toBe(true);
    expect(diff.some((s) => s.value.includes('…'))).toBe(true);
    expect(diff.some((s) => s.added)).toBe(true);
    expect(diff.some((s) => s.removed)).toBe(true);
  });

  it('handles two empty documents without producing noise', () => {
    expect(condenseDiff('', '')).toEqual({ diff: [], truncated: false });
  });
});

describe('percent', () => {
  it('avoids rounding small differences away to nothing', () => {
    expect(percent(0.004)).toBe('<1%');
    expect(percent(0.996)).toBe('>99%');
    expect(percent(0)).toBe('0%');
    expect(percent(1)).toBe('100%');
  });
});
