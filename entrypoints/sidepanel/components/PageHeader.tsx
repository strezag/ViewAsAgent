import { SWEEP_ORDER } from '../audit';

/**
 * What the header shows for the current tab URL.
 *
 * Chrome already prints the extension name in the side-panel chrome, so the
 * in-app title is redundant. The useful thing to lead with is *which page* is
 * being audited: hostname as the primary label, path/query as muted context.
 */
export function displayUrl(raw: string): { host: string; path: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    // Prefer host over hostname so non-default ports stay visible.
    const host = parsed.host || parsed.hostname;
    if (!host) return null;
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return { host, path: path === '/' ? '' : path };
  } catch {
    return null;
  }
}

export function PageHeader({
  url,
  onRun,
  running,
  disabled,
  progress,
}: {
  url: string;
  onRun: () => void;
  running: boolean;
  disabled: boolean;
  progress?: { done: number; total: number };
}) {
  const parts = displayUrl(url);
  const label = running
    ? progress
      ? `Checking ${progress.done} of ${progress.total}…`
      : 'Checking agents…'
    : `Check all ${SWEEP_ORDER.length} agents`;

  return (
    <header className="border-b border-slate-800 bg-slate-900/60 px-3 py-3">
      <div className="min-w-0" title={url || undefined}>
        {parts ? (
          <p className="truncate text-sm font-semibold tracking-tight text-slate-100">
            <span>{parts.host}</span>
            {parts.path ? (
              <span className="font-normal text-slate-500">{parts.path}</span>
            ) : null}
          </p>
        ) : (
          <p className="truncate text-sm font-semibold tracking-tight text-slate-500">
            {url || 'no page'}
          </p>
        )}
      </div>

      <div className="mt-2">
        <button
          type="button"
          onClick={onRun}
          disabled={running || disabled}
          className="rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500"
        >
          {label}
        </button>
      </div>
    </header>
  );
}
