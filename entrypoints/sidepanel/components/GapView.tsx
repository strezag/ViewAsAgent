import { useState } from 'react';
import type { Audit } from '../audit';
import { percent } from '@/lib/analyze/gaps';
import type { Gap } from '@/lib/types';
import { RatioBar, SeverityPill, formatCount } from './ui';

/**
 * The diagnosis. Two cards, two independent causes — a page can lose content to
 * JavaScript, to edge routing, or to both, and the fix is different each time.
 */
export function GapView({ audit }: { audit: Audit }) {
  const { gaps, rendered, renderedError, profile } = audit;

  return (
    <div className="space-y-3 pt-3">
      {gaps.javascript ? (
        <GapCard
          gap={gaps.javascript}
          title="JavaScript gap"
          subtitle="What you see → the raw HTML"
          fixHint="No major AI crawler runs JavaScript. Server-render or pre-render this content and every agent gains it at once."
        />
      ) : (
        <div className="rounded border border-slate-800 bg-slate-900/40 p-2 text-[0.6875rem] text-slate-400">
          {renderedError
            ? `Could not read the rendered page, so the JavaScript gap is unknown. ${renderedError}`
            : 'The rendered page was not captured, so the JavaScript gap is unknown.'}
        </div>
      )}

      <GapCard
        gap={gaps.routing}
        title="Routing gap"
        subtitle={`The raw HTML → ${profile.name}`}
        fixHint={routingFix(audit)}
      />

      {rendered && gaps.endToEndRetainedRatio !== null ? (
        <div className="rounded border border-slate-800 bg-slate-900/40 p-2">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[0.6875rem] font-medium text-slate-300">End to end</span>
            <span className="font-mono text-[0.6875rem] text-slate-500">
              {formatCount(audit.agent.metrics.words)} of {formatCount(rendered.metrics.words)} words
            </span>
          </div>
          <RatioBar
            ratio={gaps.endToEndRetainedRatio}
            severity={
              gaps.endToEndRetainedRatio >= 0.9
                ? 'none'
                : gaps.endToEndRetainedRatio >= 0.7
                  ? 'minor'
                  : gaps.endToEndRetainedRatio >= 0.3
                    ? 'major'
                    : 'critical'
            }
          />
          <p className="mt-1.5 text-[0.6875rem] leading-snug text-slate-400">
            {percent(gaps.endToEndRetainedRatio)} of the words on your screen survive the trip to{' '}
            {profile.name}.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function routingFix(audit: Audit): string {
  switch (audit.gaps.outcome) {
    case 'blocked':
      return 'Check robots rules, WAF policy, and rate limiting for this user agent. A blocked crawler cannot cite you at all.';
    case 'degraded':
      return 'Content that vanishes only for agents is usually a bot rule or a cache variant keyed on User-Agent. Check Vary headers and CDN cache keys.';
    case 'optimized':
      return 'This is working. Confirm the optimized variant stays in sync with the page a human sees — drift here becomes a wrong answer in an AI response.';
    case 'identical':
      return 'Nothing at your edge treats agents differently. If the JavaScript gap above is large, agent-specific delivery or server rendering is the lever.';
  }
}

function GapCard({
  gap,
  title,
  subtitle,
  fixHint,
}: {
  gap: Gap;
  title: string;
  subtitle: string;
  fixHint: string;
}) {
  const [showDiff, setShowDiff] = useState(false);
  const changed = gap.diff.some((s) => s.added || s.removed);

  return (
    <div className="rounded border border-slate-800 bg-slate-900/40 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[0.6875rem] font-medium text-slate-300">{title}</div>
          <div className="text-[0.625rem] text-slate-500">{subtitle}</div>
        </div>
        <SeverityPill severity={gap.severity} />
      </div>

      <p className="mt-2 text-xs leading-snug font-medium text-slate-100">{gap.headline}</p>
      <p className="mt-1 text-[0.6875rem] leading-relaxed text-slate-400">{gap.detail}</p>

      <div className="mt-2">
        <RatioBar ratio={gap.retainedRatio} severity={gap.severity} />
      </div>

      {gap.missingHeadings.length > 0 ? (
        <HeadingList
          label="Headings that do not survive"
          tone="missing"
          items={gap.missingHeadings}
        />
      ) : null}
      {gap.addedHeadings.length > 0 ? (
        <HeadingList label="Headings only the target has" tone="added" items={gap.addedHeadings} />
      ) : null}

      <div className="mt-2 flex items-center gap-2 border-t border-slate-800 pt-2">
        <button
          onClick={() => setShowDiff((v) => !v)}
          disabled={!changed}
          className="text-[0.625rem] text-sky-400 hover:text-sky-300 disabled:text-slate-600"
        >
          {changed ? (showDiff ? 'Hide differences' : 'Show differences') : 'No textual differences'}
        </button>
        <span className="ml-auto font-mono text-[0.625rem] text-slate-500">
          {gap.wordDelta >= 0 ? '+' : ''}
          {gap.wordDelta.toLocaleString('en-US')} words
        </span>
      </div>

      {showDiff ? <DiffBlock gap={gap} /> : null}
      {!showDiff ? <p className="mt-2 text-[0.625rem] leading-snug text-slate-500">{fixHint}</p> : null}
    </div>
  );
}

function HeadingList({
  label,
  items,
  tone,
}: {
  label: string;
  items: string[];
  tone: 'missing' | 'added';
}) {
  const color = tone === 'missing' ? 'text-rose-300 bg-rose-500/10' : 'text-emerald-300 bg-emerald-500/10';
  return (
    <div className="mt-2">
      <div className="mb-1 text-[0.625rem] tracking-wide text-slate-500 uppercase">
        {label} ({items.length})
      </div>
      <div className="flex flex-wrap gap-1">
        {items.slice(0, 12).map((text, i) => (
          <span
            key={`${text}-${i}`}
            className={`max-w-full truncate rounded px-1.5 py-0.5 text-[0.625rem] ${color}`}
            title={text}
          >
            {text}
          </span>
        ))}
        {items.length > 12 ? (
          <span className="px-1 py-0.5 text-[0.625rem] text-slate-500">+{items.length - 12} more</span>
        ) : null}
      </div>
    </div>
  );
}

function DiffBlock({ gap }: { gap: Gap }) {
  return (
    <div className="mt-2">
      <div className="mb-1 flex gap-3 text-[0.625rem] text-slate-500">
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-rose-500/40" />
          only before
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-500/40" />
          only after
        </span>
      </div>
      <div className="max-h-72 overflow-auto rounded bg-slate-950 p-2 font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap">
        {gap.diff.map((segment, i) => (
          <span
            key={i}
            className={
              segment.removed
                ? 'bg-rose-500/20 text-rose-300'
                : segment.added
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'text-slate-500'
            }
          >
            {segment.value}
          </span>
        ))}
      </div>
      {gap.diffTruncated ? (
        <p className="mt-1 text-[0.625rem] text-slate-500">
          Long unchanged passages are collapsed to keep the changes readable.
        </p>
      ) : null}
    </div>
  );
}
