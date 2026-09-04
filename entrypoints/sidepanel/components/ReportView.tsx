import { useState } from 'react';
import type { Audit } from '../audit';
import { categoryDescription, categoryLevers } from '@/lib/analyze/score';
import { reportFilename, toJson, toMarkdown } from '@/lib/analyze/report';
import type { CategoryScore, Finding, FindingLevel } from '@/lib/types';
import { HelpTip, Section } from './ui';

const LEVEL_SEQUENCE: FindingLevel[] = ['critical', 'warning', 'notice', 'good'];

const LEVEL_HEADINGS: Record<FindingLevel, string> = {
  critical: 'Critical',
  warning: 'Warnings',
  notice: 'Opportunities',
  good: 'Working well',
};

const LEVEL_STYLES: Record<FindingLevel, { dot: string; text: string }> = {
  critical: { dot: 'bg-rose-500', text: 'text-rose-300' },
  warning: { dot: 'bg-orange-500', text: 'text-orange-300' },
  notice: { dot: 'bg-amber-500', text: 'text-amber-300' },
  good: { dot: 'bg-emerald-500', text: 'text-emerald-300' },
};

export function ReportView({ audit }: { audit: Audit }) {
  const { score, findings, profile } = audit;

  return (
    <div className="space-y-4 pt-3">
      <div className="rounded border border-slate-800 bg-slate-900/40 p-3">
        <div className="flex items-center gap-3">
          <ScoreRing value={score.overall} />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-100">{score.verdict}</div>
            <div className="text-[0.6875rem] leading-snug text-slate-400">
              Agent readiness for {profile.name} on this page.
            </div>
          </div>
        </div>

        <div className="mt-3 space-y-1.5">
          {score.categories.map((category) => (
            <CategoryBar key={category.category} category={category} />
          ))}
        </div>

        <p className="mt-2 border-t border-slate-800 pt-2 text-[0.625rem] leading-snug text-slate-500">
          Every point deducted below traces to a finding with a fix. Categories are weighted as
          shown.
        </p>
      </div>

      <ExportRow audit={audit} />

      {LEVEL_SEQUENCE.map((level) => {
        const group = findings.filter((f) => f.level === level);
        if (group.length === 0) return null;
        return (
          <Section key={level} title={LEVEL_HEADINGS[level]} aside={String(group.length)}>
            <div className="space-y-2.5">
              {group.map((finding) => (
                <FindingRow key={finding.id} finding={finding} />
              ))}
            </div>
          </Section>
        );
      })}
    </div>
  );
}

function ScoreRing({ value }: { value: number }) {
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - value / 100);
  const stroke =
    value >= 90
      ? 'stroke-emerald-500'
      : value >= 75
        ? 'stroke-sky-500'
        : value >= 50
          ? 'stroke-amber-500'
          : value >= 25
            ? 'stroke-orange-500'
            : 'stroke-rose-500';

  return (
    <div className="relative h-14 w-14 shrink-0">
      <svg viewBox="0 0 56 56" className="h-14 w-14 -rotate-90">
        <circle cx="28" cy="28" r={radius} className="fill-none stroke-slate-800" strokeWidth="5" />
        <circle
          cx="28"
          cy="28"
          r={radius}
          className={`fill-none ${stroke}`}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center font-mono text-sm text-slate-100">
        {value}
      </div>
    </div>
  );
}

function CategoryBar({ category }: { category: CategoryScore }) {
  const evaluated = category.evaluated;

  const fill =
    category.score >= 90
      ? 'bg-emerald-500'
      : category.score >= 75
        ? 'bg-sky-500'
        : category.score >= 50
          ? 'bg-amber-500'
          : 'bg-rose-500';

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[0.625rem]">
        <span className={evaluated ? 'text-slate-300' : 'text-slate-500'}>{category.label}</span>
        <span className="flex items-center gap-1.5">
          <span className={evaluated ? 'font-mono text-slate-500' : 'text-slate-600'}>
            {evaluated ? `${category.score} · ${category.weight}%` : 'not evaluated'}
          </span>
          <HelpTip label={`How ${category.label} is scored`}>
            <CategoryHelp category={category} />
          </HelpTip>
        </span>
      </div>
      {evaluated ? (
        <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-slate-800">
          <div className={`h-full rounded-full ${fill}`} style={{ width: `${category.score}%` }} />
        </div>
      ) : (
        <div className="mt-0.5 h-1 w-full rounded-full bg-slate-800/60" />
      )}
    </div>
  );
}

function CategoryHelp({ category }: { category: CategoryScore }) {
  // Sorted by cost so the item worth fixing first is the item read first.
  const deductions = category.findings
    .filter((finding) => finding.points > 0)
    .sort((a, b) => b.points - a.points);

  return (
    <div className="space-y-2">
      <div>
        <div className="text-[0.6875rem] font-medium text-slate-100">
          {category.label}
          {category.evaluated ? (
            <span className="ml-1 font-normal text-slate-500">
              · {category.weight}% of the score
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 text-[0.625rem] leading-snug text-slate-400">
          {categoryDescription(category.category)}
        </p>
      </div>

      {!category.evaluated ? (
        <p className="border-t border-slate-800 pt-2 text-[0.625rem] leading-snug text-slate-400">
          There was no document to measure — the agent never received one — so this category is
          excluded from the overall score rather than counted as passing.
        </p>
      ) : (
        <>
          <div className="border-t border-slate-800 pt-2">
            <div className="mb-1 text-[0.5625rem] tracking-wide text-slate-500 uppercase">
              What moves this
            </div>
            <ul className="space-y-1">
              {categoryLevers(category.category).map((lever, index) => (
                <li key={index} className="flex gap-1.5">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-slate-600" />
                  <span className="text-[0.625rem] leading-snug text-slate-400">
                    <Ticks text={lever} />
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="border-t border-slate-800 pt-2">
            <div className="mb-1 text-[0.5625rem] tracking-wide text-slate-500 uppercase">
              Costing you here
            </div>
            {deductions.length === 0 ? (
              <p className="text-[0.625rem] leading-snug text-emerald-400">
                Nothing is costing you points in this category.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {deductions.map((finding) => (
                  <li key={finding.id} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 text-[0.625rem] leading-snug text-slate-300">
                      {finding.title}
                    </span>
                    <span className="shrink-0 font-mono text-[0.625rem] text-rose-400">
                      −{finding.points}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The lever copy is shared with the Markdown export, so it carries backticks
 * around code. Render those as code rather than showing the punctuation.
 */
function Ticks({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/g).map((part, index) =>
        part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
          <code key={index} className="rounded bg-slate-800 px-1 font-mono text-slate-300">
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const style = LEVEL_STYLES[finding.level];
  return (
    <div className="flex gap-2">
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className={`text-[0.6875rem] font-medium ${style.text}`}>{finding.title}</span>
          {finding.points > 0 ? (
            <span className="shrink-0 font-mono text-[0.625rem] text-slate-600">−{finding.points}</span>
          ) : null}
        </div>
        <div className="mt-0.5 text-[0.625rem] leading-snug text-slate-400">{finding.evidence}</div>
        {finding.fix ? (
          <div className="mt-0.5 text-[0.625rem] leading-snug text-slate-500">{finding.fix}</div>
        ) : null}
      </div>
    </div>
  );
}

function ExportRow({ audit }: { audit: Audit }) {
  const [copied, setCopied] = useState(false);
  const input = { facts: audit.facts, findings: audit.findings, score: audit.score, at: audit.at };

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(toMarkdown(input));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const download = (contents: string, extension: string, mime: string) => {
    const blob = new Blob([contents], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = reportFilename(audit.facts, audit.at, extension);
    anchor.click();
    // Revoking immediately can cancel the download in some Chrome builds.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <div className="flex gap-2">
      <button
        onClick={() => void copyMarkdown()}
        className="flex-1 rounded border border-slate-700 px-2 py-1.5 text-[0.6875rem] text-slate-300 transition hover:border-slate-600 hover:text-slate-100"
      >
        {copied ? 'Copied' : 'Copy as Markdown'}
      </button>
      <button
        onClick={() => download(toMarkdown(input), '.md', 'text/markdown')}
        className="rounded border border-slate-700 px-2 py-1.5 text-[0.6875rem] text-slate-300 transition hover:border-slate-600 hover:text-slate-100"
      >
        .md
      </button>
      <button
        onClick={() => download(toJson(input), '.json', 'application/json')}
        className="rounded border border-slate-700 px-2 py-1.5 text-[0.6875rem] text-slate-300 transition hover:border-slate-600 hover:text-slate-100"
      >
        .json
      </button>
    </div>
  );
}
