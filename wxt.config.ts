import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ mode }) => ({
    name: 'ViewAsAgent',
    short_name: 'ViewAsAgent',
    description:
      'See any page the way an AI agent sees it. Compare the rendered page, the raw HTML, and what GPTBot, ClaudeBot, or PerplexityBot actually receive.',
    permissions: [
      'declarativeNetRequestWithHostAccess',
      'webRequest',
      'sidePanel',
      'storage',
      'scripting',
      'activeTab',
      'tabs',
    ],
    // Deliberately optional: we ask for a specific origin the first time you
    // audit a site rather than holding a blanket <all_urls> grant.
    optional_host_permissions: ['<all_urls>'],
    // The header-verification harness drives the worker over CDP, where there
    // is no user gesture to hang a permissions.request() on. Dev builds get
    // localhost outright; production builds never do.
    ...(mode === 'development'
      ? { host_permissions: ['http://localhost/*', 'http://127.0.0.1/*'] }
      : {}),
    action: { default_title: 'View as agent' },
  }),
});
