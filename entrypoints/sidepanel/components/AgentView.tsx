import { useState } from 'react';
import type { Audit } from '../audit';
import { percent } from '@/lib/analyze/gaps';
import { Metric, RatioBar, Section, ShapeBadge, formatBytes, formatCount } from './ui';

type Source = 'markdown' | 'payload';

/**
 * The headline answer: what this agent actually came away with, and what it
 * cost. Markdown is the default view because that is the form nearly every
 * agent converts a page into before reading it.
 */
export function AgentView({ audit }: { audit: Audit }) {
  const [source, setSource] = useState<Source>('markdown');
  const { agent, raw, gaps, profile } = audit;
  const body = source === 'markdown' ? agent.markdown : audit.responses.agent.body;

  const retained = gaps.endToEndRetainedRatio;

  return (
    <div className="space-y-4 pt-3">
      <Section title={`What ${profile.name} came away with`} aside={<ShapeBadge shape={agent.shape} />}>
        {agent.error ? (
          <p className="text-rose-400">{agent.error}</p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2">
              <Metric
                label="tokens"
                value={formatCount(agent.metrics.tokens)}
                hint="Tokens in the extracted markdown — what the agent reads as prose."
              />
              <Metric
                label="raw tokens"
                value={formatCount(agent.metrics.payloadTokens)}
                hint="Tokens in the payload as delivered, markup included."
              />
              <Metric label="words" value={formatCount(agent.metrics.words)} />
              <Metric label="headings" value={String(agent.metrics.headingCount)} />
            </div>

            {retained !== null ? (
              <div className="mt-3">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-[0.6875rem] text-slate-400">
                    {percent(retained)} of what you see reaches {profile.name}
                  </span>
                  <span className="font-mono text-[0.6875rem] text-slate-500">
                    {formatCount(agent.metrics.words)} / {formatCount(audit.rendered?.metrics.words ?? 0)}
                  </span>
                </div>
                <RatioBar
                  ratio={retained}
                  severity={retained >= 0.9 ? 'none' : retained >= 0.7 ? 'minor' : retained >= 0.3 ? 'major' : 'critical'}
                />
              </div>
            ) : null}

            {agent.metrics.payloadTokens > 0 ? (
              <p className="mt-3 text-[0.6875rem] leading-snug text-slate-400">
                {efficiencyLine(agent.metrics.tokens, agent.metrics.payloadTokens, raw.metrics.payloadTokens)}
              </p>
            ) : null}
          </>
        )}
      </Section>

      <Section
        title="The content itself"
        aside={
          <div className="flex gap-1">
            <Toggle active={source === 'markdown'} onClick={() => setSource('markdown')}>
              Markdown
            </Toggle>
            <Toggle active={source === 'payload'} onClick={() => setSource('payload')}>
              Raw payload
            </Toggle>
          </div>
        }
      >
        <div className="mb-1.5 flex items-center justify-between text-[0.6875rem] text-slate-500">
          <span>{agent.contentType ?? 'no content-type'}</span>
          <span>{formatBytes(audit.responses.agent.byteLength)}</span>
        </div>
        <pre className="max-h-[60vh] overflow-auto rounded bg-slate-950 p-2 font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap text-slate-300">
          {body.slice(0, 60000) || '(nothing)'}
        </pre>
        {body.length > 60000 ? (
          <p className="mt-1 text-[0.625rem] text-slate-500">
            Showing the first 60,000 of {body.length.toLocaleString('en-US')} characters.
          </p>
        ) : null}
      </Section>

      {agent.headings.length > 0 ? (
        <Section title="Structure the agent can see">
          <ul className="space-y-0.5">
            {agent.headings.slice(0, 40).map((h, i) => (
              <li
                key={`${h.text}-${i}`}
                className="truncate text-[0.6875rem] text-slate-300"
                style={{ paddingLeft: `${(h.level - 1) * 10}px` }}
                title={h.text}
              >
                <span className="mr-1.5 font-mono text-slate-600">h{h.level}</span>
                {h.text}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

function efficiencyLine(markdownTokens: number, payloadTokens: number, browserPayloadTokens: number): string {
  const overhead = payloadTokens - markdownTokens;
  const parts: string[] = [];
  if (overhead > 0 && payloadTokens > 0) {
    parts.push(
      `${percent(overhead / payloadTokens)} of this payload is markup the agent has to read past.`,
    );
  }
  const saved = browserPayloadTokens - payloadTokens;
  if (saved > 0 && browserPayloadTokens > 0) {
    parts.push(
      `It is still ${percent(saved / browserPayloadTokens)} smaller than what a browser is sent.`,
    );
  }
  return parts.join(' ');
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded px-1.5 py-0.5 text-[0.625rem] transition ${
        active ? 'bg-slate-700 text-slate-100' : 'text-slate-500 hover:text-slate-300'
      }`}
    >
      {children}
    </button>
  );
}
