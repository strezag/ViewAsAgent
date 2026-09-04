# ViewAsAgent

A Chrome extension that shows you what an AI agent sees when it reads the page you're looking at.

When someone asks ChatGPT, Claude, or Perplexity about a page, an agent fetches it — and what
arrives is frequently not what your browser received. ViewAsAgent makes that difference visible.

## What makes it different

Every comparable extension audits what a site **declares** about itself — robots.txt, llms.txt,
sitemaps, whether it answers `Accept: text/markdown`. That is configuration checking, and
Cloudflare now ships an Agent Readiness score doing the same thing for free.

ViewAsAgent fetches the page **as each crawler in turn** and diffs what actually came back. Nothing
in a site's analytics tells GPTBot apart from ClaudeBot, so a page one vendor can read and another
cannot looks entirely normal from the inside. That comparison is the product's front door.

A run sweeps all 17 agent profiles, streaming results in with retrieval crawlers first, then opens a
deep audit on whichever agent has the most to say.

## Two gaps, three documents

Every audit captures the same URL three ways:

| | Document | How |
|---|---|---|
| **A** | **Rendered DOM** — what you see, after hydration | injected script reads `documentElement.outerHTML` |
| **B** | **Raw HTML, browser identity** — the server response, before JavaScript | background fetch, Chrome's own UA |
| **C** | **Raw HTML, agent identity** — what the crawler gets | background fetch, spoofed UA and `Accept` |

- **A vs B is the JavaScript gap.** No major AI crawler executes JavaScript — Vercel and MERJ found
  zero JS execution across GPTBot, ClaudeBot, PerplexityBot, Bytespider, and Meta's crawler. Content
  that only exists after hydration is invisible to all of them.
- **B vs C is the agent-routing gap.** Edge middleware (Scrunch AXP, Cloudflare, Akamai, Vercel)
  detects bot traffic and swaps in different content. A positive gap means that optimization is
  live; a negative gap means blocking or accidental cloaking.

Isolating these two variables is the point. A single "human vs agent" diff conflates them and can't
tell you *why* content is missing.

## Status

All four planned phases are complete. The extension runs an audit, explains what it found, scores
it, and exports a report.

**Working**

- 17 agent profiles across retrieval, training, and coding-agent categories, each with its
  documented UA string and a `sourceUrl` so the list stays auditable
- User-Agent and `Accept` rewriting via `declarativeNetRequest` session rules, scoped to one exact
  URL and torn down after each fetch
- Full redirect chains and real on-the-wire headers via observational `webRequest`
- A wire check in the UI that reports what the User-Agent actually was, so a failed spoof surfaces
  instead of silently reporting the human page as the agent's view
- Extraction: Readability for the main article, Turndown for markdown (including real pipe tables,
  because a flattened pricing table misrepresents what the agent reads), exact `o200k_base` token
  counts, heading and link inventories
- Both gaps computed and explained in plain language, with word-level diffs, the headings that do
  not survive, and a routing outcome of `optimized` / `identical` / `degraded` / `blocked`
- A robots.txt parser and matcher following RFC 9309 and Google's reference behavior — group
  selection by longest user-agent prefix, longest matching rule, Allow winning ties, `*` and `$`
  wildcards — giving a per-crawler allow/block verdict with the rule that decided it
- Probes for `Accept: text/markdown`, `<url>.md`, `Accept: application/ld+json`, `/llms.txt`,
  `/llms-full.txt`, and the sitemap, each verified by body shape rather than status code alone
  (a 200 proves nothing when a single-page app answers every path with its shell)
- JSON-LD and metadata compared between the rendered page and the agent's copy, which catches
  structured data injected after hydration and therefore invisible to crawlers
- Edge fingerprinting: CDN and optimizer detection, `Vary` analysis, and headers only agents
  receive — the empirical way to detect AXP-style routing, since it publishes no signature
- Severity-ranked findings, each with the evidence and a concrete fix, and an Agent Readiness score
  across five weighted categories where every deducted point traces to a named finding
- A per-agent sweep as the primary view: every profile fetched against the same page, with a
  divergence verdict — "2 of 17 agents cannot read this page" — and per-agent drill-down
- Report export as Markdown or JSON, carrying the simulated-fetch caveat with it, plus per-category
  guidance for the categories that lost points
- A help panel on each category in the Report tab explaining what moves that score and which
  findings are currently costing it points
- Text scaling across five steps and a light theme that follows the OS, both remembered across
  devices — see Accessibility below
- Fixture server with seven deliberately different routes and a request log

### Scoring

Five categories, weighted: Reachability (30), Content fidelity (30), Structured data (15),
Agent affordances (15), Efficiency (10).

A category that could not be measured is excluded from the score rather than counted as passing.
When an agent cannot fetch the page at all, there is no content to judge for fidelity, structured
data, or efficiency — and scoring those as perfect, which "no findings means no deductions" would
do, once handed a comfortable 76/100 to a page no agent could read.

## Accessibility

A control row sits under the header, always visible rather than behind a settings icon — hiding
these controls is an anti-pattern, since the people who need them are the least likely to hunt for
them.

**Text size** steps through root font sizes of 16, 18, 20, 22, and 24px, defaulting to 18. Every
size in the panel is `rem` and Tailwind v4 spacing is too, so one value scales type and spacing
together and the layout keeps its proportions. Verified at 24px in a 320px panel with no horizontal
overflow.

**Theme** follows `prefers-color-scheme` by default, with light and dark as explicit overrides.
Both palettes are written out as hex in `entrypoints/sidepanel/style.css`; because Tailwind v4
compiles colours to `var(--color-*)`, redefining those variables rethemes every component without
touching a single class.

`lib/theme.test.ts` parses that stylesheet and asserts WCAG AA contrast (4.5:1) for every
text-carrying token against both surfaces, in both themes. It exists because the dark theme shipped
with faint text at roughly 3.2:1 — Tailwind's `slate-600` on `slate-950`, used for point costs and
"not evaluated" labels. Both faint tones are now lifted until they pass.

## Setup

```bash
npm install
```

Development, with hot reload:

```bash
npm run dev
```

Production build into `.output/chrome-mv3`:

```bash
npm run build
```

## Loading it in Chrome

There is no `manifest.json` in the repo root — WXT generates one per build. Point Chrome at a
build directory, not at the project:

| Load this | When |
|---|---|
| `.output\chrome-mv3-dev` | working against the fixture server, or using the console seam |
| `.output\chrome-mv3` | using it on real sites |

Go to `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose one of
those folders. Then click the toolbar icon to open the side panel.

`npm run verify` launches its own Chrome with a throwaway profile and the extension already loaded,
so you do not need to load it by hand for that.

## Verifying header spoofing

Everything this tool reports rests on one assumption: that a `declarativeNetRequest` rule can put a
crawler's User-Agent on an extension-initiated fetch. If that fails silently, ViewAsAgent shows you
the human page and calls it the agent's view — the worst failure mode available, because it looks
like an answer.

So it is checked against an independent witness. The fixture server logs every inbound User-Agent
and `Accept`, and the harness compares that log against what the extension believes it sent:

```bash
npm run verify
```

This builds, starts the fixture server, launches Chrome with a throwaway profile and the extension
loaded, and prints a snippet to paste into the service worker's console. Chrome does not allow CDP
to attach to extension service workers on a normal desktop build, so that one paste is manual —
everything on either side of it, including the assertions, is automatic.

Run the fixture server on its own:

```bash
npm run fixtures
```

| Route | Behavior |
|---|---|
| `/ssr` | fully server-rendered — the control, no gap on either axis |
| `/csr` | empty shell, content fetched by JavaScript — large JavaScript gap |
| `/routed` | serves stripped, summary-enriched HTML to bot user agents |
| `/negotiated` | answers `Accept: text/markdown` with markdown |
| `/blocked` | 403 to bot user agents |
| `/redirected` | 302s bots to a markdown file — tests redirect-chain capture |
| `/__log` | every request the server received, with the headers that arrived |

Check the fixtures still behave as the tests assume:

```bash
npm run fixtures:check
```

Unit and integration tests over the analysis layer — 135 of them, covering the robots matcher,
extraction, gap classification, findings, and scoring, with the integration tests running the real
pipeline against the fixture server over HTTP:

```bash
npm test
```

Regenerate the extension icons:

```bash
npm run icons
```

## What this cannot do

Real AI crawlers fetch from datacenter IPs that Cloudflare and Akamai verify by reverse DNS and,
increasingly, signed requests. ViewAsAgent fetches from your machine with an unsigned request, so a
bot-verifying edge may answer differently than it would a real crawler — sometimes with the human
page, sometimes with a challenge.

The UI says so on every result, and treats "identical to the human page despite a bot User-Agent" as
a reported outcome rather than a silent success. The transport lives behind a single `fetchAs()`
function so a datacenter-egress relay can be added later without touching the analysis or the UI.

## Permissions

The extension ships with `optional_host_permissions` rather than a blanket `<all_urls>` grant: it
asks for one origin the first time you audit a site. Nothing leaves your browser — there is no
backend. Development builds additionally hold `http://localhost/*` so the verification harness can
run without a user gesture; production builds never do.
