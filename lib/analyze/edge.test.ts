import { describe, expect, it } from 'vitest';
import { buildEdgeReport, detectVendors } from './edge';
import type { HeaderPair } from '../types';

const h = (record: Record<string, string>): HeaderPair[] =>
  Object.entries(record).map(([name, value]) => ({ name, value }));

describe('detectVendors', () => {
  it('recognises CDNs from their fingerprint headers', () => {
    expect(detectVendors(h({ 'cf-ray': 'abc123', 'cf-cache-status': 'HIT' }))).toContain('Cloudflare');
    expect(detectVendors(h({ 'x-vercel-cache': 'MISS' }))).toContain('Vercel');
    expect(detectVendors(h({ 'x-amz-cf-pop': 'IAD79' }))).toContain('CloudFront');
  });

  it('recognises vendors from server and via values', () => {
    expect(detectVendors(h({ server: 'AkamaiGHost' }))).toContain('Akamai');
    expect(detectVendors(h({ via: '1.1 varnish, 1.1 fastly' }))).toContain('Fastly');
  });

  it('recognises an optimizer by header prefix', () => {
    expect(detectVendors(h({ 'x-scrunch-variant': 'agent' }))).toContain('Scrunch AXP');
  });

  it('finds nothing on a plain origin', () => {
    expect(detectVendors(h({ server: 'nginx', 'content-type': 'text/html' }))).toEqual([]);
  });
});

describe('buildEdgeReport', () => {
  it('does not mistake per-request headers for agent-specific routing', () => {
    // cf-ray and date change on every single request. Treating them as evidence
    // would report agent routing on every Cloudflare site on the internet.
    const browser = h({ 'cf-ray': 'aaa111', date: 'Mon, 01 Jan 2026 00:00:00 GMT', server: 'cloudflare' });
    const agent = h({ 'cf-ray': 'bbb222', date: 'Mon, 01 Jan 2026 00:00:05 GMT', server: 'cloudflare' });

    const report = buildEdgeReport(browser, agent);

    expect(report.changedHeaders).toEqual([]);
    expect(report.agentOnlyHeaders).toEqual([]);
    expect(report.signals.some((s) => s.agentSpecific)).toBe(false);
    expect(report.signals.at(-1)?.label).toBe('No agent-specific handling detected');
  });

  it('reports a header only the agent received', () => {
    const report = buildEdgeReport(
      h({ 'content-type': 'text/html' }),
      h({ 'content-type': 'text/html', 'x-fixture-optimizer': 'demo-axp/1.0' }),
    );

    expect(report.agentOnlyHeaders).toEqual([{ name: 'x-fixture-optimizer', value: 'demo-axp/1.0' }]);
    expect(report.signals.some((s) => s.agentSpecific)).toBe(true);
  });

  it('calls out a content-type swap as the strongest routing signal', () => {
    const report = buildEdgeReport(
      h({ 'content-type': 'text/html; charset=utf-8' }),
      h({ 'content-type': 'text/markdown; charset=utf-8', vary: 'Accept' }),
    );

    expect(report.varyOnAccept).toBe(true);
    expect(report.signals[0]?.label).toContain('text/html → text/markdown');
  });

  it('does not read Vary: Accept-Encoding as content negotiation', () => {
    const report = buildEdgeReport(h({ vary: 'Accept-Encoding' }), h({ vary: 'Accept-Encoding' }));
    expect(report.varyOnAccept).toBe(false);
  });

  it('warns when responses differ by user agent but Vary does not say so', () => {
    const report = buildEdgeReport(
      h({ 'content-type': 'text/html' }),
      h({ 'content-type': 'text/html', 'x-variant': 'agent' }),
    );

    const warning = report.signals.find((s) => s.label.includes('without Vary'));
    expect(warning).toBeDefined();
    expect(warning?.detail).toContain('shared cache');
  });

  it('does not warn about a missing Vary when Vary is present', () => {
    const report = buildEdgeReport(
      h({ 'content-type': 'text/html' }),
      h({ 'content-type': 'text/html', 'x-variant': 'agent', vary: 'User-Agent' }),
    );

    expect(report.varyOnUserAgent).toBe(true);
    expect(report.signals.some((s) => s.label.includes('without Vary'))).toBe(false);
  });

  it('flags agent traffic answered by different infrastructure', () => {
    const report = buildEdgeReport(h({ server: 'nginx' }), h({ server: 'agent-edge' }));
    expect(report.signals.some((s) => s.label.includes('Different origin for agents'))).toBe(true);
  });
});
