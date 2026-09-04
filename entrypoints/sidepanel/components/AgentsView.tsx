import { summarizeDivergence, type DivergenceLevel } from '@/lib/analyze/divergence';
import { CATEGORY_LABELS } from '@/lib/profiles';
import type { AgentCategory, AgentMatrixRow, RoutingOutcome } from '@/lib/types';
import { formatCount } from './ui';

/**
 * Single-word labels: the row has to survive the largest text size in a narrow
 * panel, and the summary card above carries the full phrasing.
 */
const OUTCOME_STYLES: Record<RoutingOutcome, { label: string; className: string }> = {
  optimized: { label: 'optimized', className: 'text-sky-400' },
  identical: { label: 'same', className: 'text-slate-400' },
  degraded: { label: 'reduced', className: 'text-orange-400' },
  blocked: { label: 'blocked', className: 'text-rose-400' },
};

/** Matches SWEEP_ORDER: the crawlers that shape answers today come first. */
const DISPLAY_ORDER: AgentCategory[] = ['retrieval', 'coding', 'training'];

const LEVEL_STYLES: Record<DivergenceLevel, string> = {
  blocked: 'border-rose-500/30 bg-rose-500/10',
  divergent: 'border-amber-500/30 bg-amber-500/10',
  optimized: 'border-sky-500/30 bg-sky-500/10',
  uniform: 'border-emerald-500/30 bg-emerald-500/10',
  unknown: 'border-slate-800 bg-slate-900/40',
};

const LEVEL_TEXT: Record<DivergenceLevel, string> = {
  blocked: 'text-rose-300',
  divergent: 'text-amber-300',
  optimized: 'text-sky-300',
  uniform: 'text-emerald-300',
  unknown: 'text-slate-300',
};

/**
 * The front door: every agent against the same page.
 *
 * Nothing in a site's analytics distinguishes GPTBot from ClaudeBot, so "one
 * vendor is blocked and the rest are fine" is invisible until something fetches
 * as each of them and compares. That is the question this view answers.
 */
export function AgentsView({
  rows,
  focusedProfileId,
  onFocus,
  sweeping,
  progress,
}: {
  rows: AgentMatrixRow[];
  focusedProfileId: string | null;
  onFocus: (profileId: string) => void;
  sweeping: boolean;
  progress?: { done: number; total: number };
}) {
  const summary = summarizeDivergence(rows);
  // Grouped in the order they are fetched, so rows appear where they will
  // finally sit rather than jumping between sections as the sweep fills in.
  const grouped = DISPLAY_ORDER.map((category) => ({
    category,
    rows: rows.filter((r) => r.category === category),
  })).filter((g) => g.rows.length > 0);

  return (
    <div className="space-y-3 pt-3">
      {sweeping && progress ? (
        <div>
          <div className="mb-1 flex items-baseline justify-between text-[0.625rem] text-slate-400">
            <span>Fetching as each agent…</span>
            <span className="font-mono text-slate-500">
              {progress.done} of {progress.total}
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-sky-500 transition-all"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      ) : (
        <div className={`rounded border p-2 ${LEVEL_STYLES[summary.level]}`}>
          <div className={`text-[0.6875rem] font-medium ${LEVEL_TEXT[summary.level]}`}>
            {summary.headline}
          </div>
          <div className="mt-1 text-[0.625rem] leading-snug text-slate-400">{summary.detail}</div>
        </div>
      )}

      {grouped.map((group) => (
        <div key={group.category}>
          <div className="mb-1 text-[0.5625rem] tracking-wide text-slate-500 uppercase">
            {shortCategory(group.category)}
          </div>
          <div className="space-y-px">
            {group.rows.map((row) => (
              <AgentRow
                key={row.profileId}
                row={row}
                focused={row.profileId === focusedProfileId}
                onFocus={onFocus}
              />
            ))}
          </div>
        </div>
      ))}

      {rows.length > 0 && !sweeping ? (
        <p className="border-t border-slate-800 pt-2 text-[0.5625rem] leading-snug text-slate-500">
          Columns are HTTP status, words received, and how that compares with what a browser is
          sent. A red dot means robots.txt disallows that crawler regardless of what the fetch
          returned. Select an agent to audit it in depth.
        </p>
      ) : null}
    </div>
  );
}

function AgentRow({
  row,
  focused,
  onFocus,
}: {
  row: AgentMatrixRow;
  focused: boolean;
  onFocus: (profileId: string) => void;
}) {
  return (
    <button
      onClick={() => onFocus(row.profileId)}
      aria-pressed={focused}
      className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition hover:bg-slate-800/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500 ${
        focused ? 'bg-slate-800/70' : ''
      }`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${row.robotsAllowed ? 'bg-slate-600' : 'bg-rose-500'}`}
        title={row.robotsAllowed ? 'Allowed by robots.txt' : 'Disallowed by robots.txt'}
      />
      {/* Wraps rather than truncates: at the largest text size a third of these
          names no longer fit on one line, and the crawler's identity is the
          whole point of the row. */}
      <span className="min-w-0 flex-1 text-[0.625rem] leading-tight break-words text-slate-300">
        {row.name}
      </span>
      <span
        className={`shrink-0 font-mono text-[0.5625rem] ${
          row.status >= 400 || row.status === 0 ? 'text-rose-400' : 'text-slate-500'
        }`}
      >
        {row.status || '—'}
      </span>
      <span className="shrink-0 text-right font-mono text-[0.5625rem] whitespace-nowrap text-slate-500">
        {formatCount(row.words)}w
      </span>
      <span
        className={`w-1/4 shrink-0 truncate text-right text-[0.5625rem] ${OUTCOME_STYLES[row.outcome].className}`}
      >
        {OUTCOME_STYLES[row.outcome].label}
      </span>
    </button>
  );
}

function shortCategory(category: AgentCategory): string {
  return CATEGORY_LABELS[category].split('—')[0]?.trim() ?? category;
}
