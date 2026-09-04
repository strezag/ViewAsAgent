// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { extractLinks, parseHtml } from './html';

describe('extractLinks', () => {
  it('keeps the same href twice when the link text differs', () => {
    const doc = parseHtml(
      '<a href="/docs">Docs</a><a href="/docs">Reference</a>',
      { baseUrl: 'https://example.com/' },
    );
    expect(extractLinks(doc)).toEqual([
      { href: '/docs', text: 'Docs' },
      { href: '/docs', text: 'Reference' },
    ]);
  });

  it('drops a duplicate href-and-text pair', () => {
    const doc = parseHtml(
      '<a href="/docs">Docs</a><nav><a href="/docs">Docs</a></nav>',
      { baseUrl: 'https://example.com/' },
    );
    expect(extractLinks(doc)).toEqual([{ href: '/docs', text: 'Docs' }]);
  });
});
