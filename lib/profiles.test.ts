import { describe, expect, it } from 'vitest';
import { AGENT_PROFILES, ALL_PROFILES, BROWSER_PROFILE, getProfile } from './profiles';

/**
 * Vendors revise their User-Agent strings, and a profile that quietly loses its
 * UA would spoof nothing while still reporting an "agent" result. These guard
 * the shape of the data rather than its accuracy — accuracy is a release-time
 * re-check against each profile's sourceUrl.
 */
describe('agent profiles', () => {
  it('has unique ids', () => {
    const ids = ALL_PROFILES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every agent a User-Agent, a robots token, and a citable source', () => {
    for (const profile of AGENT_PROFILES) {
      expect(profile.userAgent, `${profile.id} userAgent`).not.toBe('');
      expect(profile.robotsToken, `${profile.id} robotsToken`).not.toBe('');
      expect(profile.sourceUrl, `${profile.id} sourceUrl`).toMatch(/^https:\/\//);
    }
  });

  it('names each agent inside its own User-Agent string', () => {
    // A UA that does not contain the robots token is almost always a copy/paste
    // slip between two profiles.
    const exempt = new Set(['google-extended', 'applebot-extended', 'bytespider']);
    for (const profile of AGENT_PROFILES) {
      if (exempt.has(profile.id)) continue;
      expect(profile.userAgent.toLowerCase(), `${profile.id}`).toContain(
        profile.robotsToken.toLowerCase(),
      );
    }
  });

  it('keeps the browser baseline free of any spoofing', () => {
    expect(BROWSER_PROFILE.userAgent).toBe('');
    expect(BROWSER_PROFILE.category).toBe('baseline');
  });

  it('records that AI crawlers do not run JavaScript, except the search engines', () => {
    const nonRendering = AGENT_PROFILES.filter((p) => !p.rendersJavaScript).map((p) => p.id);
    expect(nonRendering).toContain('gptbot');
    expect(nonRendering).toContain('claudebot');
    expect(nonRendering).toContain('perplexitybot');
    expect(getProfile('googlebot')?.rendersJavaScript).toBe(true);
  });

  it('has exactly one profile that negotiates for markdown', () => {
    const markdown = AGENT_PROFILES.filter((p) => p.accept.includes('text/markdown'));
    expect(markdown.map((p) => p.id)).toEqual(['coding-agent-markdown']);
  });

  it('resolves unknown ids to undefined rather than a default', () => {
    expect(getProfile('not-a-bot')).toBeUndefined();
  });
});
