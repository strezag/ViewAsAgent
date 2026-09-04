import { useState } from 'react';
import type { Audit } from '../audit';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '@/lib/profiles';
import type { AgentCategory, RobotsVerdictRow } from '@/lib/types';
import { Section } from './ui';

/**
 * Can an agent reach this page at all, and what has the site told it? Every
 * other measurement is moot if the answer here is no.
 */
export function AccessView({ audit }: { audit: Audit }) {
  const { access, profile } = audit;
  const { directives, affordances, edge } = access;

  return (
    <div className="space-y-4 pt-3">
      <Section
        title="robots.txt"
        aside={
          access.robots
            ? `${access.robots.groups.length} group${access.robots.groups.length === 1 ? '' : 's'}`
            : access.robotsStatus === 404
              ? 'not found'
              : `HTTP ${access.robotsStatus || '—'}`
        }
      >
        {!access.robots ? (
          <p className="text-[0.6875rem] text-slate-400">
            No robots.txt rules apply to this origin, so every crawler is allowed everywhere. That is
            a valid choice — it just means access is not something you are controlling here.
          </p>
        ) : (
          <VerdictMatrix rows={access.verdicts} activeProfileId={profile.id} />
        )}
        {access.robots?.warnings.length ? (
          <ul className="mt-2 space-y-0.5 border-t border-slate-800 pt-2">
            {access.robots.warnings.map((warning, i) => (
              <li key={i} className="text-[0.625rem] text-amber-400">
                {warning}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title="Crawl directives">
        {directives.metaRobots.length === 0 && directives.xRobotsTag.length === 0 ? (
          <p className="text-[0.6875rem] text-slate-500">
            No robots meta tag and no X-Robots-Tag header. Nothing here restricts indexing or AI use.
          </p>
        ) : (
          <div className="space-y-1.5">
            <DirectiveRow label="meta robots" tokens={directives.metaRobots} />
            <DirectiveRow label="X-Robots-Tag" tokens={directives.xRobotsTag} />
          </div>
        )}
        {directives.noai || directives.noimageai || directives.noindex ? (
          <div className="mt-2 border-t border-slate-800 pt-2 text-[0.6875rem] text-amber-400">
            {directives.noindex ? <div>noindex — this page asks not to be indexed at all.</div> : null}
            {directives.noai ? <div>noai — an explicit opt-out of AI training and use.</div> : null}
            {directives.noimageai ? <div>noimageai — images are opted out of AI use.</div> : null}
          </div>
        ) : null}
      </Section>

      <Section title="Agent affordances">
        <div className="space-y-1">
          <Affordance
            ok={affordances.markdownNegotiation}
            label="Accept: text/markdown"
            yes="The server answers agents with markdown when they ask for it."
            no="Asking for markdown returned HTML. Cloudflare and Vercel can do this at the edge."
          />
          <Affordance
            ok={affordances.dotMd}
            label="<url>.md companion"
            yes="A markdown twin of this page exists."
            no="No .md companion at this path."
          />
          <Affordance
            ok={affordances.llmsTxt}
            label="/llms.txt"
            yes="An agent-facing index is published."
            no="No llms.txt. Evidence for its impact is thin, so this is optional."
          />
          <Affordance
            ok={affordances.llmsFullTxt}
            label="/llms-full.txt"
            yes="A full-text agent bundle is published."
            no="No llms-full.txt."
          />
          <Affordance
            ok={affordances.jsonLdNegotiation}
            label="Accept: application/ld+json"
            yes="Structured data is available by content negotiation."
            no="Asking for JSON-LD returned HTML."
          />
          <Affordance
            ok={affordances.sitemapReachable}
            label="Sitemap"
            yes={
              affordances.sitemapsDeclared.length
                ? `Reachable and declared in robots.txt.`
                : 'Reachable at /sitemap.xml, though robots.txt does not declare it.'
            }
            no="No sitemap found at /sitemap.xml."
          />
        </div>
      </Section>

      <Section title="At the edge" aside={edge.vendors.join(', ') || undefined}>
        <ul className="space-y-1.5">
          {edge.signals.map((signal, i) => (
            <li key={i} className="flex gap-2">
              <span
                className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                  signal.agentSpecific ? 'bg-sky-400' : 'bg-slate-600'
                }`}
              />
              <div className="min-w-0">
                <div className="text-[0.6875rem] text-slate-200">{signal.label}</div>
                <div className="text-[0.625rem] leading-snug text-slate-500">{signal.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function VerdictMatrix({
  rows,
  activeProfileId,
}: {
  rows: RobotsVerdictRow[];
  activeProfileId: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const grouped = CATEGORY_ORDER.map((category) => ({
    category,
    rows: rows.filter((r) => r.category === category),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="space-y-2">
      {grouped.map((group) => (
        <div key={group.category}>
          <div className="mb-1 text-[0.625rem] tracking-wide text-slate-500 uppercase">
            {shortCategory(group.category)}
          </div>
          <div className="space-y-px">
            {group.rows.map((row) => {
              const open = expanded === row.profileId;
              return (
                <div key={row.profileId}>
                  <button
                    onClick={() => setExpanded(open ? null : row.profileId)}
                    className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition hover:bg-slate-800/60 ${
                      row.profileId === activeProfileId ? 'bg-slate-800/40' : ''
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        row.verdict.allowed ? 'bg-emerald-500' : 'bg-rose-500'
                      }`}
                    />
                    <span className="min-w-0 flex-1 truncate text-[0.6875rem] text-slate-300">
                      {row.name}
                    </span>
                    <span
                      className={`text-[0.625rem] ${row.verdict.allowed ? 'text-emerald-400' : 'text-rose-400'}`}
                    >
                      {row.verdict.allowed ? 'allowed' : 'blocked'}
                    </span>
                  </button>
                  {open ? (
                    <p className="px-1.5 pb-1.5 font-mono text-[0.625rem] leading-snug text-slate-500">
                      {row.verdict.reason}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <p className="border-t border-slate-800 pt-2 text-[0.625rem] leading-snug text-slate-500">
        Click a crawler to see the rule that decided it.
      </p>
    </div>
  );
}

function shortCategory(category: AgentCategory): string {
  return CATEGORY_LABELS[category].split('—')[0]?.trim() ?? category;
}

function DirectiveRow({ label, tokens }: { label: string; tokens: string[] }) {
  if (tokens.length === 0) return null;
  return (
    <div className="flex gap-2">
      <span className="w-1/3 shrink-0 text-[0.625rem] text-slate-500">{label}</span>
      <div className="flex flex-wrap gap-1">
        {tokens.map((token) => (
          <span key={token} className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[0.625rem] text-slate-300">
            {token}
          </span>
        ))}
      </div>
    </div>
  );
}

function Affordance({
  ok,
  label,
  yes,
  no,
}: {
  ok: boolean;
  label: string;
  yes: string;
  no: string;
}) {
  return (
    <div className="flex gap-2">
      <span className={`mt-0.5 shrink-0 font-mono text-[0.6875rem] ${ok ? 'text-emerald-400' : 'text-slate-600'}`}>
        {ok ? '✓' : '·'}
      </span>
      <div className="min-w-0">
        <div className={`font-mono text-[0.6875rem] ${ok ? 'text-slate-200' : 'text-slate-500'}`}>{label}</div>
        <div className="text-[0.625rem] leading-snug text-slate-500">{ok ? yes : no}</div>
      </div>
    </div>
  );
}
