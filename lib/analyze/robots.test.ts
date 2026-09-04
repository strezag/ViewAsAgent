import { describe, expect, it } from 'vitest';
import { isAllowed, parseRobots, pathMatches, robotsPath } from './robots';

const FIXTURE = `# ViewAsAgent fixtures
User-agent: *
Allow: /

User-agent: GPTBot
Disallow: /blocked
Disallow: /private/

User-agent: ClaudeBot
User-agent: CCBot
Disallow: /

Sitemap: https://example.com/sitemap.xml
`;

describe('parseRobots', () => {
  it('splits groups on User-agent lines and keeps their rules', () => {
    const robots = parseRobots(FIXTURE);
    expect(robots.groups).toHaveLength(3);
    expect(robots.groups[0]?.agents).toEqual(['*']);
    expect(robots.groups[1]?.agents).toEqual(['gptbot']);
    expect(robots.groups[1]?.rules).toEqual([
      { type: 'disallow', path: '/blocked' },
      { type: 'disallow', path: '/private/' },
    ]);
  });

  it('shares one group between consecutive User-agent lines', () => {
    const robots = parseRobots(FIXTURE);
    expect(robots.groups[2]?.agents).toEqual(['claudebot', 'ccbot']);
    expect(robots.groups[2]?.rules).toEqual([{ type: 'disallow', path: '/' }]);
  });

  it('collects sitemaps, which are global rather than per-group', () => {
    expect(parseRobots(FIXTURE).sitemaps).toEqual(['https://example.com/sitemap.xml']);
  });

  it('strips comments and ignores unknown fields without complaint', () => {
    const robots = parseRobots('User-agent: *  # everyone\nDisallow: /x\nRequest-rate: 1/5\n');
    expect(robots.groups[0]?.rules).toEqual([{ type: 'disallow', path: '/x' }]);
    expect(robots.warnings).toHaveLength(0);
  });

  it('reads crawl-delay without letting it start a new group', () => {
    const robots = parseRobots('User-agent: bingbot\nCrawl-delay: 10\nDisallow: /slow\n');
    expect(robots.groups).toHaveLength(1);
    expect(robots.groups[0]?.crawlDelay).toBe(10);
    expect(robots.groups[0]?.rules).toHaveLength(1);
  });

  it('warns about rules that appear before any User-agent line', () => {
    const robots = parseRobots('Disallow: /orphan\nUser-agent: *\nAllow: /');
    expect(robots.warnings[0]).toContain('before any User-agent');
  });

  it('treats an empty file as having no rules at all', () => {
    expect(parseRobots('').empty).toBe(true);
    expect(parseRobots('# only a comment\n').empty).toBe(true);
  });
});

describe('isAllowed', () => {
  const robots = parseRobots(FIXTURE);

  it('applies the group that matches the crawler token', () => {
    expect(isAllowed(robots, 'GPTBot', '/blocked').allowed).toBe(false);
    expect(isAllowed(robots, 'GPTBot', '/article').allowed).toBe(true);
  });

  it('matches the token case-insensitively', () => {
    expect(isAllowed(robots, 'gptbot', '/blocked').allowed).toBe(false);
    expect(isAllowed(robots, 'GPTBOT', '/blocked').allowed).toBe(false);
  });

  it('blocks every path for a group that disallows the root', () => {
    expect(isAllowed(robots, 'ClaudeBot', '/').allowed).toBe(false);
    expect(isAllowed(robots, 'ClaudeBot', '/anything/at/all').allowed).toBe(false);
  });

  it('falls back to the wildcard group only when nothing specific matches', () => {
    const verdict = isAllowed(robots, 'PerplexityBot', '/blocked');
    expect(verdict.allowed).toBe(true);
    expect(verdict.matchedAgent).toBe('*');
  });

  it('uses a general group for a more specific crawler token', () => {
    // Googlebot-Image follows the Googlebot group when it has none of its own.
    const google = parseRobots('User-agent: Googlebot\nDisallow: /no-google\n');
    expect(isAllowed(google, 'Googlebot-Image', '/no-google').allowed).toBe(false);
  });

  it('prefers the longest matching User-agent line', () => {
    const robotsTxt = parseRobots(
      'User-agent: Googlebot\nDisallow: /\n\nUser-agent: Googlebot-News\nAllow: /\n',
    );
    expect(isAllowed(robotsTxt, 'Googlebot-News', '/story').allowed).toBe(true);
    expect(isAllowed(robotsTxt, 'Googlebot', '/story').allowed).toBe(false);
  });

  it('lets the longest rule win, and Allow win a tie', () => {
    const robotsTxt = parseRobots('User-agent: *\nDisallow: /docs\nAllow: /docs/public\n');
    expect(isAllowed(robotsTxt, 'GPTBot', '/docs/private').allowed).toBe(false);
    expect(isAllowed(robotsTxt, 'GPTBot', '/docs/public/page').allowed).toBe(true);

    const tie = parseRobots('User-agent: *\nDisallow: /page\nAllow: /page\n');
    expect(isAllowed(tie, 'GPTBot', '/page').allowed).toBe(true);
  });

  it('treats an empty Disallow as permission rather than a block', () => {
    const robotsTxt = parseRobots('User-agent: *\nDisallow:\n');
    expect(isAllowed(robotsTxt, 'GPTBot', '/anything').allowed).toBe(true);
  });

  it('allows everything when there is no robots.txt', () => {
    const verdict = isAllowed(null, 'GPTBot', '/anything');
    expect(verdict.allowed).toBe(true);
    expect(verdict.reason).toContain('No robots.txt');
  });

  it('explains itself with the rule that decided the outcome', () => {
    const verdict = isAllowed(robots, 'GPTBot', '/private/thing');
    expect(verdict.reason).toBe('"gptbot" group: Disallow: /private/');
    expect(verdict.matchedRule).toEqual({ type: 'disallow', path: '/private/' });
  });
});

describe('pathMatches', () => {
  it('matches on prefix by default', () => {
    expect(pathMatches('/docs', '/docs/page')).toBe(true);
    expect(pathMatches('/docs', '/other')).toBe(false);
  });

  it('expands * as a wildcard', () => {
    expect(pathMatches('/*.pdf', '/files/report.pdf')).toBe(true);
    expect(pathMatches('/a/*/c', '/a/b/c')).toBe(true);
    expect(pathMatches('/a/*/c', '/a/b/d')).toBe(false);
  });

  it('anchors the end of the path with $', () => {
    expect(pathMatches('/page$', '/page')).toBe(true);
    expect(pathMatches('/page$', '/page/sub')).toBe(false);
    expect(pathMatches('/*.php$', '/index.php')).toBe(true);
    expect(pathMatches('/*.php$', '/index.php?q=1')).toBe(false);
  });

  it('treats regex metacharacters in a path as literals', () => {
    expect(pathMatches('/a+b', '/a+b')).toBe(true);
    expect(pathMatches('/a+b', '/aaab')).toBe(false);
  });
});

describe('robotsPath', () => {
  it('includes the query string, which rules can match against', () => {
    expect(robotsPath('https://example.com/search?q=1')).toBe('/search?q=1');
    expect(robotsPath('https://example.com')).toBe('/');
  });
});
