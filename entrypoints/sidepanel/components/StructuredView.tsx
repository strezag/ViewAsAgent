import type { Audit } from '../audit';
import type { JsonLdBlock, PageMeta, StructuredData } from '@/lib/types';
import { Section } from './ui';

/**
 * Structured data is written for machines, so the only question that matters is
 * whether the machine received it. Comparing the rendered page against the
 * agent's copy catches the expensive, invisible failure: JSON-LD injected by a
 * tag manager after hydration, perfect on screen and absent from the HTML every
 * non-rendering crawler reads.
 */
export function StructuredView({ audit }: { audit: Audit }) {
  const { structured, profile } = audit;
  const rendered = structured.rendered;
  const agent = structured.agent;

  const lostBlocks = rendered ? rendered.jsonLd.length - agent.jsonLd.length : 0;
  const lostTypes = rendered ? typesMissing(rendered, agent) : [];

  return (
    <div className="space-y-4 pt-3">
      <Section title="JSON-LD" aside={`${agent.jsonLd.length} block${agent.jsonLd.length === 1 ? '' : 's'} for ${profile.name}`}>
        {rendered && lostBlocks > 0 ? (
          <div className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 p-2">
            <div className="text-[0.6875rem] font-medium text-amber-300">
              {lostBlocks} JSON-LD block{lostBlocks === 1 ? '' : 's'} never reach {profile.name}.
            </div>
            <div className="mt-0.5 text-[0.625rem] leading-snug text-amber-200/70">
              {lostTypes.length > 0
                ? `Missing types: ${lostTypes.join(', ')}. `
                : ''}
              Structured data added by JavaScript is invisible to crawlers that do not render. Move
              it into the server-side HTML.
            </div>
          </div>
        ) : null}

        {agent.jsonLd.length === 0 ? (
          <p className="text-[0.6875rem] text-slate-400">
            {rendered && rendered.jsonLd.length > 0
              ? `The page has structured data, but none of it survives to ${profile.name}.`
              : 'No JSON-LD on this page. Schema.org markup is how an agent learns what a page is about without inferring it from prose.'}
          </p>
        ) : (
          <div className="space-y-2">
            {agent.jsonLd.map((block, i) => (
              <JsonLdCard key={i} block={block} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Metadata">
        <MetaComparison rendered={rendered?.meta ?? null} agent={agent.meta} agentLabel={profile.name} />
      </Section>

      {agent.meta.hreflang.length > 0 ? (
        <Section title="Language alternates" aside={`${agent.meta.hreflang.length}`}>
          <ul className="space-y-0.5 font-mono text-[0.625rem]">
            {agent.meta.hreflang.slice(0, 20).map((alt, i) => (
              <li key={i} className="flex gap-2">
                <span className="w-14 shrink-0 text-sky-400">{alt.lang}</span>
                <span className="truncate text-slate-400" title={alt.href}>
                  {alt.href}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

function typesMissing(rendered: StructuredData, agent: StructuredData): string[] {
  const present = new Set(agent.jsonLd.flatMap((b) => b.types));
  const missing = new Set<string>();
  for (const type of rendered.jsonLd.flatMap((b) => b.types)) {
    if (!present.has(type)) missing.add(type);
  }
  return Array.from(missing);
}

function JsonLdCard({ block }: { block: JsonLdBlock }) {
  if (block.error) {
    return (
      <div className="rounded border border-rose-500/30 bg-rose-500/10 p-2">
        <div className="text-[0.6875rem] font-medium text-rose-300">Invalid JSON-LD</div>
        <div className="mt-0.5 font-mono text-[0.625rem] text-rose-200/70">{block.error}</div>
        <pre className="mt-1 max-h-24 overflow-auto font-mono text-[0.625rem] text-slate-400">
          {block.raw.slice(0, 400)}
        </pre>
      </div>
    );
  }

  return (
    <div className="rounded border border-slate-800 bg-slate-950 p-2">
      <div className="mb-1 flex flex-wrap gap-1">
        {block.types.length > 0 ? (
          block.types.map((type) => (
            <span key={type} className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[0.625rem] text-sky-300">
              {type}
            </span>
          ))
        ) : (
          <span className="text-[0.625rem] text-amber-400">no @type — agents cannot classify this</span>
        )}
      </div>
      <pre className="max-h-48 overflow-auto font-mono text-[0.625rem] leading-relaxed text-slate-400">
        {JSON.stringify(block.parsed, null, 2).slice(0, 3000)}
      </pre>
    </div>
  );
}

const META_FIELDS: { key: keyof PageMeta; label: string }[] = [
  { key: 'title', label: 'title' },
  { key: 'description', label: 'description' },
  { key: 'canonical', label: 'canonical' },
  { key: 'ogTitle', label: 'og:title' },
  { key: 'ogDescription', label: 'og:description' },
  { key: 'ogType', label: 'og:type' },
  { key: 'ogImage', label: 'og:image' },
  { key: 'twitterCard', label: 'twitter:card' },
];

function MetaComparison({
  rendered,
  agent,
  agentLabel,
}: {
  rendered: PageMeta | null;
  agent: PageMeta;
  agentLabel: string;
}) {
  return (
    <table className="w-full text-[0.625rem]">
      <tbody>
        {META_FIELDS.map(({ key, label }) => {
          const agentValue = asText(agent[key]);
          const renderedValue = rendered ? asText(rendered[key]) : null;
          const lost = Boolean(renderedValue && !agentValue);

          return (
            <tr key={key} className="border-t border-slate-800/70 align-top">
              <td className="w-1/3 py-1 pr-2 font-mono text-slate-500">{label}</td>
              <td className="py-1 break-words">
                {agentValue ? (
                  <span className="text-slate-300">{agentValue}</span>
                ) : lost ? (
                  <span className="text-amber-400">
                    missing for {agentLabel} — present only after JavaScript
                  </span>
                ) : (
                  <span className="text-slate-600">not set</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function asText(value: PageMeta[keyof PageMeta]): string | null {
  if (typeof value === 'string') return value;
  return null;
}
