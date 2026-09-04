# ViewAsAgent — working notes

A Chrome MV3 extension that fetches the current page **as each AI crawler in turn** and diffs what
came back. Read `README.md` for the product; this file is the things that are expensive to
rediscover.

**The differentiator, in one line:** every comparable tool audits what a site *declares*
(robots.txt, llms.txt, `Accept: text/markdown`). This one measures what a site *does*, per agent.
Keep that at the front — the Agents sweep is the product's primary view, not a feature.

---

## Commands

```bash
npm run dev            # WXT dev server, hot reload
npm run build          # production -> .output/chrome-mv3
npm test               # vitest: unit + integration
npm run compile        # tsc --noEmit
npm run fixtures       # local test server on :8787
npm run fixtures:check # assert the fixtures still behave as tests assume
npm run verify         # the header-spoofing gate (see below)
npm run icons          # regenerate public/icon/*.png
```

Load the **built folder** in Chrome, never the repo root — WXT generates the manifest per build.
`.output/chrome-mv3-dev` has the localhost grant and the console seam; `.output/chrome-mv3` is for
real sites.

---

## Architecture invariants

Break these and things fail in confusing ways.

**The service worker owns all network; the side panel owns all DOM work.** MV3 service workers have
no DOM and Readability needs one. So `entrypoints/background.ts` fetches, and extraction happens in
the panel. Do not try to parse HTML in the worker.

**User-Agent is set by declarativeNetRequest, not by `fetch`.** `fetch` silently drops it — it is a
forbidden header name. `lib/fetch/headerRules.ts` installs a session rule scoped to one exact URL
and `xmlhttprequest`, removed in a `finally`, with a startup sweep for crashed workers. It also
strips `sec-ch-ua*`, `sec-fetch-*`, `Referer` — a spoof that leaves client hints in place gets
routed as a human by exactly the middleware we are trying to observe.

**Redirect chains come from observational `webRequest`.** MV3 removed only the *blocking* form.
`redirect: 'manual'` yields an opaque response with no headers, so `lib/fetch/trace.ts` observes
instead. `sentHeaders` is what Chrome actually put on the wire *after* DNR ran — that is the only
proof the spoof landed, and the UI surfaces it as the Wire Check.

**`agentFetch` serialises same-URL fetches.** Both the DNR rule and the trace recorder are keyed by
URL, so concurrent same-URL requests would collide and mis-attribute a User-Agent. This is why the
17-agent sweep is sequential and cannot simply be `Promise.all`'d. Mitigation is ordering plus
streaming results, not parallelism. Different URLs still run in parallel.

**Theming is a variable swap, not `dark:` variants.** Tailwind v4 compiles `bg-slate-950` to
`var(--color-slate-950)`, so `entrypoints/sidepanel/style.css` redefines the colour variables in use
and rethemes every component with zero class changes. Opacity modifiers follow too, via a
`color-mix()` rule inside an `@supports` guard Chrome takes. **Never add `dark:` classes.**

**All text sizes are rem.** `html { font-size }` drives type *and* Tailwind spacing together.
**Never write `text-[11px]`** — use `text-[0.6875rem]`. `lib/settings.ts` owns the steps.

---

## Where things live

```
entrypoints/background.ts       service worker: fetching, probes, DNR lifecycle
entrypoints/sidepanel/audit.ts  runSweep() and focusAgent() — the orchestration
lib/fetch/                      headerRules, trace, agentFetch, probes
lib/extract/                    Readability -> Turndown -> tokens; structured data
lib/analyze/                    pure logic: gaps, robots, edge, access, findings,
                                score, divergence, report
```

`lib/analyze/*` and `lib/extract/*` are pure and unit-tested. Keep them free of `chrome.*`. When
logic needs testing, move it there — `mostInterestingAgent` lives in `divergence.ts` rather than
`audit.ts` for exactly this reason.

---

## Gotchas that have already cost time

Each of these was a real bug, not a hypothetical.

- **`body.textContent` includes `<script>` source.** A client-rendered shell got credited with the
  words of its own bundle, under-reporting the JavaScript gap on the pages where it matters most.
  Use `readableText()` from `lib/extract/html.ts`.
- **Fixed widths break at large text.** `w-24` becomes 144px of a 320px panel at the 24px step —
  wider than the value beside it. Use proportional (`w-1/3`, `w-1/4`) or let content wrap. Check
  any new layout at the largest step.
- **Unevaluated score categories must be excluded, not scored 100.** "No findings" is not "no
  problems" when the agent never received a document. Scoring them full marks once gave a page no
  agent could read a comfortable 76/100. See `evaluableCategories()`.
- **Verify affordances by body shape, not status code.** Single-page apps answer every unknown path
  with 200 and their shell, so a naive check reports that half the web publishes `llms.txt`.
- **Exclude volatile headers from edge diffing.** `cf-ray`, `date`, `x-vercel-id` change every
  request; counting them would report agent-specific routing on every Cloudflare site alive.
- **`:root[data-theme]` only matches `<html>`.** You cannot theme a nested div — this breaks
  side-by-side theme previews.
- **`rem` resolves against `<html>`**, not an ancestor. Setting `font-size` on a wrapper div does
  nothing for `text-[0.625rem]`.
- **jsdom here exposes no `localStorage`.** Tests that need it install an in-memory shim; production
  code must tolerate its absence (see `applyCachedFontStep`).

---

## Testing

Unit and integration tests live beside their source. Integration tests spawn the fixture server on
their own port and run the real pipeline over HTTP — that is how the `textContent` bug was found,
and synthetic fixtures would not have caught it.

`lib/theme.test.ts` parses `style.css` and asserts WCAG AA contrast for both palettes. If you change
a colour, run it; it will reject values that look fine and measure 4.47:1.

For visual checks there is a repeatable technique: render the real component into jsdom, dump
`container.innerHTML`, wrap it in the built CSS at a fixed panel width, write it under `.output/`,
and screenshot it in a browser. Use `<html data-theme=… style="font-size:Npx">` on the *root*.
This is how theme and text-scaling regressions get caught without loading the extension.

---

## The one thing that has never been verified

`npm run verify` is the Phase 1 gate: it confirms a declarativeNetRequest rule actually puts the
spoofed User-Agent on the wire from an extension fetch, by comparing what the extension believes it
sent against what the fixture server logs receiving. **It has never been run.** Chrome will not let
CDP attach to extension service workers on a desktop build, so one step is manual — the script
launches Chrome, prints a snippet, and you paste it into the worker console. Takes about a minute.

Everything this tool reports rests on that assumption. If it is wrong, the tool shows the human page
and calls it the agent's view. The UI is built to fail loudly (the Wire Check goes amber), but the
gate has not been run. Do it before trusting output on a real site.

---

## Known limitations, honestly

- **Web Bot Auth changes the premise.** Certified agents now sign requests (Ed25519, production at
  Cloudflare's edge since March 2026). Nobody can sign as GPTBot, so the UA spoof increasingly
  measures "what an unverified client claiming to be GPTBot gets" — real and useful, and drifting
  from "what GPTBot gets". The footer caveat says so; keep it honest.
- A datacenter-egress relay would help the classic rDNS-verified crawlers and **not** the signed
  ones. Weigh it accordingly.
- Cloudflare ships a free Agent Readiness score, so the scoring feature competes with it. The
  per-agent sweep does not.
- The tokenizer is a lazily-loaded 2 MB chunk. Swap for the 4-chars-per-token estimate if size ever
  matters more than exact counts.

---

## House style

Match the surrounding code. Comments explain *why*, especially where a non-obvious constraint drove
the shape — most existing comments are load-bearing. User-facing copy is plain and specific: "GPTBot
cannot fetch this page", not "reachability degraded". Every deduction in the score carries a fix.
