import type { AgentProfile } from './types';

/**
 * Vendors publish User-Agent strings but almost never publish Accept headers.
 * These are pragmatic defaults; the one place it genuinely matters is the
 * coding-agent profile, where `Accept: text/markdown` is the whole point.
 */
const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const ANY_ACCEPT = '*/*';
export const MARKDOWN_ACCEPT = 'text/markdown,text/plain;q=0.9,text/html;q=0.8,*/*;q=0.5';

/** The comparison baseline: Chrome's own identity, JavaScript not executed. */
export const BROWSER_PROFILE: AgentProfile = {
  id: 'browser',
  name: 'Browser (baseline)',
  vendor: 'You',
  category: 'baseline',
  userAgent: '', // empty means "leave Chrome's own header alone"
  accept: HTML_ACCEPT,
  robotsToken: '*',
  rendersJavaScript: false,
  sourceUrl: '',
  note: 'The server response to a browser-identified request, before any JavaScript runs.',
};

export const AGENT_PROFILES: AgentProfile[] = [
  // ---- Retrieval: decides what agents say about you right now -------------
  {
    id: 'oai-searchbot',
    name: 'OAI-SearchBot',
    vendor: 'OpenAI',
    category: 'retrieval',
    userAgent:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot',
    accept: HTML_ACCEPT,
    robotsToken: 'OAI-SearchBot',
    rendersJavaScript: false,
    sourceUrl: 'https://platform.openai.com/docs/bots',
    note: 'Builds the ChatGPT search index. Blocking it removes you from ChatGPT citations.',
  },
  {
    id: 'chatgpt-user',
    name: 'ChatGPT-User',
    vendor: 'OpenAI',
    category: 'retrieval',
    userAgent:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
    accept: HTML_ACCEPT,
    robotsToken: 'ChatGPT-User',
    rendersJavaScript: false,
    sourceUrl: 'https://platform.openai.com/docs/bots',
    note: 'Fetches a page live because someone asked about it in ChatGPT.',
  },
  {
    id: 'claude-searchbot',
    name: 'Claude-SearchBot',
    vendor: 'Anthropic',
    category: 'retrieval',
    userAgent:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +Claude-SearchBot@anthropic.com)',
    accept: HTML_ACCEPT,
    robotsToken: 'Claude-SearchBot',
    rendersJavaScript: false,
    sourceUrl: 'https://support.anthropic.com/en/articles/8896518',
  },
  {
    id: 'claude-user',
    name: 'Claude-User',
    vendor: 'Anthropic',
    category: 'retrieval',
    userAgent:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)',
    accept: HTML_ACCEPT,
    robotsToken: 'Claude-User',
    rendersJavaScript: false,
    sourceUrl: 'https://support.anthropic.com/en/articles/8896518',
    note: 'Fetches a page live because someone asked about it in Claude.',
  },
  {
    id: 'perplexitybot',
    name: 'PerplexityBot',
    vendor: 'Perplexity',
    category: 'retrieval',
    userAgent:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot',
    accept: HTML_ACCEPT,
    robotsToken: 'PerplexityBot',
    rendersJavaScript: false,
    sourceUrl: 'https://docs.perplexity.ai/guides/bots',
  },
  {
    id: 'perplexity-user',
    name: 'Perplexity-User',
    vendor: 'Perplexity',
    category: 'retrieval',
    userAgent:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user',
    accept: HTML_ACCEPT,
    robotsToken: 'Perplexity-User',
    rendersJavaScript: false,
    sourceUrl: 'https://docs.perplexity.ai/guides/bots',
  },
  {
    id: 'googlebot',
    name: 'Googlebot',
    vendor: 'Google',
    category: 'retrieval',
    userAgent:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/131.0.0.0 Safari/537.36',
    accept: HTML_ACCEPT,
    robotsToken: 'Googlebot',
    rendersJavaScript: true,
    sourceUrl:
      'https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers',
    note: 'The one crawler here that does render JavaScript, and the gateway to AI Overviews.',
  },
  {
    id: 'bingbot',
    name: 'bingbot',
    vendor: 'Microsoft',
    category: 'retrieval',
    userAgent:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
    accept: HTML_ACCEPT,
    robotsToken: 'bingbot',
    rendersJavaScript: true,
    sourceUrl: 'https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0',
    note: 'Feeds Copilot.',
  },

  // ---- Training: decides what models know about you in two years ----------
  {
    id: 'gptbot',
    name: 'GPTBot',
    vendor: 'OpenAI',
    category: 'training',
    userAgent:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot',
    accept: HTML_ACCEPT,
    robotsToken: 'GPTBot',
    rendersJavaScript: false,
    sourceUrl: 'https://platform.openai.com/docs/bots',
  },
  {
    id: 'claudebot',
    name: 'ClaudeBot',
    vendor: 'Anthropic',
    category: 'training',
    userAgent:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
    accept: HTML_ACCEPT,
    robotsToken: 'ClaudeBot',
    rendersJavaScript: false,
    sourceUrl: 'https://support.anthropic.com/en/articles/8896518',
  },
  {
    id: 'google-extended',
    name: 'Google-Extended',
    vendor: 'Google',
    category: 'training',
    // Google-Extended is a robots.txt opt-out token, not a crawler with its own
    // UA. Googlebot does the fetching, so we send Googlebot on the wire and
    // judge access by the Google-Extended token.
    userAgent:
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/131.0.0.0 Safari/537.36',
    accept: HTML_ACCEPT,
    robotsToken: 'Google-Extended',
    rendersJavaScript: true,
    sourceUrl:
      'https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers',
    note: 'A robots.txt token, not a distinct crawler. Controls Gemini training use only.',
  },
  {
    id: 'bytespider',
    name: 'Bytespider',
    vendor: 'ByteDance',
    category: 'training',
    userAgent:
      'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)',
    accept: ANY_ACCEPT,
    robotsToken: 'Bytespider',
    rendersJavaScript: false,
    sourceUrl: 'https://support.bytedance.com',
    note: 'Documented history of ignoring robots.txt. Block at the WAF if you need it blocked.',
  },
  {
    id: 'meta-externalagent',
    name: 'Meta-ExternalAgent',
    vendor: 'Meta',
    category: 'training',
    userAgent:
      'meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)',
    accept: ANY_ACCEPT,
    robotsToken: 'meta-externalagent',
    rendersJavaScript: false,
    sourceUrl: 'https://developers.facebook.com/docs/sharing/webmasters/web-crawlers',
  },
  {
    id: 'applebot-extended',
    name: 'Applebot-Extended',
    vendor: 'Apple',
    category: 'training',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
    accept: HTML_ACCEPT,
    robotsToken: 'Applebot-Extended',
    rendersJavaScript: true,
    sourceUrl: 'https://support.apple.com/en-us/119829',
    note: 'A robots.txt token layered on Applebot. Controls Apple Intelligence training use.',
  },
  {
    id: 'amazonbot',
    name: 'Amazonbot',
    vendor: 'Amazon',
    category: 'training',
    userAgent:
      'Mozilla/5.0 (Linux; like Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 (compatible; Amazonbot/0.1; +https://developer.amazon.com/support/amazonbot)',
    accept: HTML_ACCEPT,
    robotsToken: 'Amazonbot',
    rendersJavaScript: false,
    sourceUrl: 'https://developer.amazon.com/amazonbot',
  },
  {
    id: 'ccbot',
    name: 'CCBot',
    vendor: 'Common Crawl',
    category: 'training',
    userAgent: 'CCBot/2.0 (https://commoncrawl.org/faq/)',
    accept: ANY_ACCEPT,
    robotsToken: 'CCBot',
    rendersJavaScript: false,
    sourceUrl: 'https://commoncrawl.org/faq',
    note: 'Feeds nearly every open training corpus downstream.',
  },

  // ---- Coding agents: the ones that ask for markdown ----------------------
  {
    id: 'coding-agent-markdown',
    name: 'Coding agent (markdown)',
    vendor: 'Anthropic and others',
    category: 'coding',
    userAgent: 'Claude-User/1.0 (+Claude-User@anthropic.com)',
    accept: MARKDOWN_ACCEPT,
    robotsToken: 'Claude-User',
    rendersJavaScript: false,
    sourceUrl: 'https://developers.cloudflare.com/changelog/2026-02-12-markdown-for-agents',
    note: 'Exercises Accept: text/markdown negotiation the way Claude Code and OpenCode do. Cloudflare and Vercel both answer this header with markdown.',
  },
];

export const ALL_PROFILES: AgentProfile[] = [BROWSER_PROFILE, ...AGENT_PROFILES];

export function getProfile(id: string): AgentProfile | undefined {
  return ALL_PROFILES.find((p) => p.id === id);
}

export const CATEGORY_LABELS: Record<AgentProfile['category'], string> = {
  baseline: 'Baseline',
  retrieval: 'Retrieval — what agents say about you now',
  training: 'Training — what models learn about you',
  coding: 'Coding agents — markdown negotiation',
};

export const CATEGORY_ORDER: AgentProfile['category'][] = ['retrieval', 'training', 'coding'];
