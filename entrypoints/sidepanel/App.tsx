import { useCallback, useEffect, useState } from 'react';
import { getProfile } from '@/lib/profiles';
import { originPatternFor, unauditableReason } from '@/lib/capture/renderedDom';
import { preloadTokenizer } from '@/lib/extract/tokens';
import {
  focusAgent,
  mostInterestingAgent,
  runSweep,
  SWEEP_ORDER,
  type Audit,
  type Sweep,
} from './audit';
import { AgentsView } from './components/AgentsView';
import { AgentView } from './components/AgentView';
import { GapView } from './components/GapView';
import { DetailsView } from './components/DetailsView';
import { AccessView } from './components/AccessView';
import { StructuredView } from './components/StructuredView';
import { ReportView } from './components/ReportView';
import { PageHeader } from './components/PageHeader';
import { SettingsBar } from './components/SettingsBar';
import { Notice } from './components/ui';
import {
  DEFAULT_SETTINGS,
  applySettings,
  loadSettings,
  saveSettings,
  type Settings,
} from '@/lib/settings';
import type { AgentMatrixRow } from '@/lib/types';

type RunState =
  | { status: 'idle' }
  | { status: 'sweeping'; step: string; rows: AgentMatrixRow[]; done: number; total: number }
  | { status: 'ready'; sweep: Sweep }
  | { status: 'error'; message: string };

const TABS = ['agents', 'report', 'agent', 'gap', 'access', 'structured', 'details'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  agents: 'Agents',
  report: 'Report',
  agent: 'Agent view',
  gap: 'Gaps',
  access: 'Access',
  structured: 'Structured',
  details: 'Evidence',
};

export default function App() {
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [run, setRun] = useState<RunState>({ status: 'idle' });
  const [active, setActive] = useState<Tab>('agents');
  const [focus, setFocus] = useState<Audit | null>(null);
  const [focusError, setFocusError] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    preloadTokenizer();
  }, []);

  useEffect(() => {
    void loadSettings().then((stored) => {
      setSettings(stored);
      applySettings(stored, document.documentElement);
    });
  }, []);

  const updateSettings = useCallback((next: Settings) => {
    setSettings(next);
    applySettings(next, document.documentElement);
    void saveSettings(next);
  }, []);

  useEffect(() => {
    const load = async () => {
      const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
      setTab(current ?? null);
    };
    void load();
    const onActivated = () => void load();
    const onUpdated = (_id: number, info: { status?: string; url?: string }) => {
      if (info.status === 'complete' || info.url) void load();
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  const url = tab?.url ?? '';
  const blockedReason = url ? unauditableReason(url) : 'Open a page to audit it.';

  const openFocus = useCallback(async (sweep: Sweep, profileId: string) => {
    setFocusError(null);
    try {
      setFocus(await focusAgent(sweep, profileId));
    } catch (err) {
      setFocus(null);
      setFocusError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const start = useCallback(async () => {
    if (!tab?.id || !url) return;

    // permissions.request must run while the click gesture is still live.
    let granted = true;
    try {
      granted = await chrome.permissions.request({ origins: [originPatternFor(url)] });
    } catch (err) {
      setRun({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (!granted) {
      setRun({
        status: 'error',
        message: 'ViewAsAgent needs permission for this site before it can fetch it as an agent.',
      });
      return;
    }

    setFocus(null);
    setFocusError(null);
    setActive('agents');
    setRun({ status: 'sweeping', step: 'Starting…', rows: [], done: 0, total: SWEEP_ORDER.length });

    try {
      const sweep = await runSweep({
        tabId: tab.id,
        url,
        onStep: (step) =>
          setRun((prev) => (prev.status === 'sweeping' ? { ...prev, step } : prev)),
        onRow: (row, done, total) =>
          setRun((prev) =>
            prev.status === 'sweeping' ? { ...prev, rows: [...prev.rows, row], done, total } : prev,
          ),
      });
      setRun({ status: 'ready', sweep });

      // Open the deep audit on whichever agent has the most to say, so a single
      // Run produces a complete answer rather than a matrix and a next step.
      const interesting = mostInterestingAgent(sweep.rows);
      if (interesting) await openFocus(sweep, interesting);
    } catch (err) {
      setRun({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [tab?.id, url, openFocus]);

  const rows = run.status === 'sweeping' ? run.rows : run.status === 'ready' ? run.sweep.rows : [];
  const sweeping = run.status === 'sweeping';

  return (
    <div className="flex h-full flex-col bg-slate-950">
      <PageHeader
        url={url}
        onRun={() => void start()}
        running={sweeping}
        disabled={Boolean(blockedReason)}
        progress={run.status === 'sweeping' ? { done: run.done, total: run.total } : undefined}
      />

      <SettingsBar settings={settings} onChange={updateSettings} />

      {run.status === 'sweeping' || run.status === 'ready' ? (
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-800 bg-slate-900/40 px-2">
          {TABS.map((name) => {
            const needsFocus = name !== 'agents';
            return (
              <button
                key={name}
                onClick={() => setActive(name)}
                disabled={needsFocus && !focus}
                className={`-mb-px shrink-0 border-b-2 px-2 py-1.5 text-[0.6875rem] whitespace-nowrap transition disabled:cursor-not-allowed disabled:text-slate-700 ${
                  active === name
                    ? 'border-sky-500 text-slate-100'
                    : 'border-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                {TAB_LABELS[name]}
              </button>
            );
          })}
        </nav>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        {blockedReason ? (
          <Notice>{blockedReason}</Notice>
        ) : run.status === 'idle' ? (
          <Intro />
        ) : run.status === 'error' ? (
          <Notice tone="bad">{run.message}</Notice>
        ) : active === 'agents' ? (
          <AgentsView
            rows={rows}
            focusedProfileId={focus?.profile.id ?? null}
            onFocus={(profileId) => {
              if (run.status === 'ready') void openFocus(run.sweep, profileId);
            }}
            sweeping={sweeping}
            progress={run.status === 'sweeping' ? { done: run.done, total: run.total } : undefined}
          />
        ) : !focus ? (
          <Notice tone={focusError ? 'bad' : 'muted'}>
            {focusError ?? 'Select an agent to audit it in depth.'}
          </Notice>
        ) : active === 'report' ? (
          <ReportView audit={focus} />
        ) : active === 'agent' ? (
          <AgentView audit={focus} />
        ) : active === 'gap' ? (
          <GapView audit={focus} />
        ) : active === 'access' ? (
          <AccessView audit={focus} />
        ) : active === 'structured' ? (
          <StructuredView audit={focus} />
        ) : (
          <DetailsView audit={focus} />
        )}
      </div>

      <footer className="border-t border-slate-800 px-3 py-2 text-[0.6875rem] leading-snug text-slate-500">
        <span className="font-medium text-amber-500/90">Simulated agent fetch.</span> Sent from your
        IP, unsigned. Edges that verify bots by reverse DNS or Web Bot Auth may answer a real
        crawler differently.
      </footer>
    </div>
  );
}

function Intro() {
  return (
    <div className="mt-4 space-y-3 text-xs leading-relaxed text-slate-400">
      <p className="text-slate-300">
        Press Check to fetch this page as every AI crawler in turn and compare what each one
        receives.
      </p>
      <p>
        Nothing in your analytics tells GPTBot apart from ClaudeBot, so a page that one vendor can
        read and another cannot looks completely normal from the inside.
      </p>
      <p>
        Each agent is then audited in depth: what survives JavaScript, what your edge does
        differently for crawlers, and what the page tells a machine about itself.
      </p>
    </div>
  );
}
