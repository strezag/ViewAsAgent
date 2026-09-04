import { describe, expect, it } from 'vitest';
import { buildExactUrlCondition, canonicalRequestUrl } from './headerRules';

/**
 * The rule condition is the containment boundary. If it matches more than the
 * one URL we are fetching, we start rewriting the User-Agent on requests the
 * page itself made — so "matches exactly one URL" is worth pinning down.
 */
describe('buildExactUrlCondition', () => {
  it('anchors a plain URL and only matches tab-less XHR', () => {
    const condition = buildExactUrlCondition('https://example.com/blog/post');
    expect(condition.urlFilter).toBe('|https://example.com/blog/post|');
    expect(condition.regexFilter).toBeUndefined();
    expect(condition.resourceTypes).toEqual(['xmlhttprequest']);
    expect(condition.tabIds).toEqual([-1]);
    expect(condition.isUrlFilterCaseSensitive).toBe(false);
  });

  it('lowercases the filter, because Chrome matches against a lowercased URL', () => {
    const condition = buildExactUrlCondition('https://Example.com/Blog/Post');
    expect(condition.urlFilter).toBe('|https://example.com/blog/post|');
    expect(condition.isUrlFilterCaseSensitive).toBe(false);
  });

  it('keeps the query string, so ?a=1 and ?a=2 are different targets', () => {
    const condition = buildExactUrlCondition('https://example.com/search?q=parsec&page=2');
    expect(condition.urlFilter).toBe('|https://example.com/search?q=parsec&page=2|');
  });

  it('strips the fragment, which never goes on the wire', () => {
    const condition = buildExactUrlCondition('https://example.com/app#/dashboard');
    expect(condition.urlFilter).toBe('|https://example.com/app|');
  });

  it.each([
    ['https://example.com/search?q=a*b', '*'],
    ['https://example.com/search?q=a^b', '^'],
    ['https://example.com/a|b', '|'],
  ])('falls back to a regex when the URL contains %s metacharacters', (url) => {
    const condition = buildExactUrlCondition(url);
    expect(condition.urlFilter).toBeUndefined();
    expect(condition.regexFilter).toBeDefined();
    expect(condition.regexFilter!.startsWith('(?i)^')).toBe(true);
    expect(condition.regexFilter!.endsWith('$')).toBe(true);
    expect(condition.tabIds).toEqual([-1]);
    expect(condition.isUrlFilterCaseSensitive).toBe(false);
  });

  it('escapes the fallback regex so it matches that URL and nothing else', () => {
    const url = 'https://example.com/search?q=a*b';
    const condition = buildExactUrlCondition(url);
    // Strip the RE2 inline flag, which JavaScript RegExp does not understand.
    const pattern = new RegExp(condition.regexFilter!.replace('(?i)', ''), 'i');

    expect(pattern.test(url)).toBe(true);
    expect(pattern.test('https://example.com/search?q=aXXXb')).toBe(false);
    expect(pattern.test('https://evil.example.com/search?q=a*b')).toBe(false);
    expect(pattern.test('https://example.com/search?q=a*b&extra=1')).toBe(false);
  });
});

describe('canonicalRequestUrl', () => {
  it('drops the hash so DNR and the trace key match the on-the-wire URL', () => {
    expect(canonicalRequestUrl('https://example.com/app#/route')).toBe('https://example.com/app');
    expect(canonicalRequestUrl('https://example.com/path?q=1#frag')).toBe(
      'https://example.com/path?q=1',
    );
  });

  it('leaves a URL with no fragment unchanged', () => {
    expect(canonicalRequestUrl('https://example.com/blog/post')).toBe(
      'https://example.com/blog/post',
    );
  });
});
