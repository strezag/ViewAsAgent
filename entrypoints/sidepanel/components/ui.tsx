import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { DocumentShape, GapSeverity } from '@/lib/types';

/**
 * A small `?` that reveals an explanation.
 *
 * Hover alone would exclude keyboard and touch users and makes the text
 * unselectable, so this opens on hover *and* on focus, and a click pins it open
 * until Escape or a click outside.
 *
 * Positioning is solved structurally rather than with collision logic: the
 * trigger sits at the right end of its row and the panel is right-anchored to
 * it, so it cannot cross either edge. That matters because the panel renders
 * inside `overflow-y-auto`, where CSS forces `overflow-x` away from `visible` —
 * anything wider than the container would clip or induce horizontal scrolling.
 */
export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  // Hover and focus are tracked apart from each other so Escape can dismiss a
  // panel opened either way. Folding focus into `hovered` left a keyboard user
  // unable to close it: Escape cleared the pin, and focus held it open.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrapper = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const open = hovered || focused || pinned;

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPinned(false);
      setFocused(false);
      // Without this the trigger keeps focus and immediately reopens.
      trigger.current?.blur();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setPinned(false);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <span
      ref={wrapper}
      className="relative inline-flex"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setPinned((value) => !value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[0.5625rem] leading-none transition focus:outline-none focus-visible:ring-1 focus-visible:ring-sky-500 ${
          open
            ? 'border-slate-500 text-slate-200'
            : 'border-slate-700 text-slate-500 hover:border-slate-500 hover:text-slate-300'
        }`}
      >
        ?
      </button>

      {open ? (
        <div
          id={panelId}
          role="tooltip"
          className="absolute top-full right-0 z-20 mt-1 w-64 max-w-[calc(100vw-1.5rem)] rounded border border-slate-700 bg-slate-950 p-2 text-left shadow-lg shadow-black/40"
        >
          {children}
        </div>
      ) : null}
    </span>
  );
}

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h2 className="text-[0.6875rem] font-semibold tracking-wide text-slate-400 uppercase">{title}</h2>
        {aside ? <div className="text-[0.6875rem] text-slate-500">{aside}</div> : null}
      </div>
      <div className="rounded border border-slate-800 bg-slate-900/40 p-2 text-xs">{children}</div>
    </section>
  );
}

export function Notice({ tone = 'muted', children }: { tone?: 'muted' | 'bad'; children: ReactNode }) {
  return (
    <p className={`mt-4 text-xs leading-relaxed ${tone === 'bad' ? 'text-rose-400' : 'text-slate-400'}`}>
      {children}
    </p>
  );
}

const SEVERITY_STYLES: Record<GapSeverity, string> = {
  none: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  minor: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  major: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  critical: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
};

const SEVERITY_LABELS: Record<GapSeverity, string> = {
  none: 'no gap',
  minor: 'minor',
  major: 'major',
  critical: 'critical',
};

export function SeverityPill({ severity }: { severity: GapSeverity }) {
  return (
    <span
      className={`rounded-full border px-1.5 py-0.5 text-[0.625rem] font-medium tracking-wide uppercase ${SEVERITY_STYLES[severity]}`}
    >
      {SEVERITY_LABELS[severity]}
    </span>
  );
}

const SHAPE_LABELS: Record<DocumentShape, string> = {
  article: 'article found',
  fallback: 'no article — using body',
  markdown: 'served as markdown',
  empty: 'no readable content',
  error: 'error',
};

const SHAPE_STYLES: Record<DocumentShape, string> = {
  article: 'text-emerald-400',
  fallback: 'text-amber-400',
  markdown: 'text-sky-400',
  empty: 'text-rose-400',
  error: 'text-rose-400',
};

export function ShapeBadge({ shape }: { shape: DocumentShape }) {
  return <span className={`text-[0.6875rem] ${SHAPE_STYLES[shape]}`}>{SHAPE_LABELS[shape]}</span>;
}

/** A labelled proportion bar. `ratio` above 1 renders as a full, positive bar. */
export function RatioBar({ ratio, severity }: { ratio: number; severity: GapSeverity }) {
  const width = Math.max(2, Math.min(100, ratio * 100));
  const fill =
    severity === 'none'
      ? 'bg-emerald-500'
      : severity === 'minor'
        ? 'bg-amber-500'
        : severity === 'major'
          ? 'bg-orange-500'
          : 'bg-rose-500';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
      <div className={`h-full rounded-full ${fill}`} style={{ width: `${width}%` }} />
    </div>
  );
}

export function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div title={hint}>
      <div className="font-mono text-[0.8125rem] text-slate-200">{value}</div>
      <div className="text-[0.625rem] tracking-wide text-slate-500 uppercase">{label}</div>
    </div>
  );
}

export function formatBytes(n: number): string {
  if (!n) return '0';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
