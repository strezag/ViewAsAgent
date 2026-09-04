import type { Audit } from '../audit';
import { sentUserAgent } from '@/lib/fetch/trace';
import type { ExtractedDoc, HeaderPair } from '@/lib/types';
import { Section, ShapeBadge, formatBytes, formatCount } from './ui';

/**
 * The evidence behind the verdicts: what went on the wire, what came back, and
 * where the two agent-facing responses diverge from the browser's.
 */
export function DetailsView({ audit }: { audit: Audit }) {
  const { profile, responses, rendered, raw, agent } = audit;
  const onWire = sentUserAgent(responses.agent.trace);
  const spoofConfirmed = Boolean(onWire && profile.userAgent && onWire === profile.userAgent);

  return (
    <div className="space-y-4 pt-3">
      <Section title="Wire check">
        {onWire ? (
          <>
            <div className={spoofConfirmed ? 'text-emerald-400' : 'text-amber-400'}>
              {spoofConfirmed
                ? 'The agent identity reached the server.'
                : 'What went on the wire does not match the profile — treat these results with suspicion.'}
            </div>
            <pre className="mt-1 overflow-x-auto rounded bg-slate-950 p-2 font-mono text-[0.6875rem] leading-snug text-slate-300">
              {onWire}
            </pre>
          </>
        ) : (
          <div className="text-slate-500">
            No request trace was captured, so the User-Agent could not be confirmed.
          </div>
        )}
        {responses.agent.trace.ip ? (
          <div className="mt-1.5 font-mono text-[0.625rem] text-slate-500">
            resolved {responses.agent.trace.ip} in {responses.agent.elapsedMs} ms
          </div>
        ) : null}
      </Section>

      <Section title="The three documents">
        <table className="w-full text-[0.6875rem]">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 text-left font-medium">Document</th>
              <th className="py-1 text-right font-medium">Status</th>
              <th className="py-1 text-right font-medium">Words</th>
              <th className="py-1 text-right font-medium">Size</th>
            </tr>
          </thead>
          <tbody>
            <DocRow doc={rendered} fallbackLabel="What you see" error={audit.renderedError} />
            <DocRow doc={raw} fallbackLabel="Raw HTML" />
            <DocRow doc={agent} fallbackLabel={profile.name} />
          </tbody>
        </table>
      </Section>

      {responses.agent.trace.hops.length > 0 ? (
        <Section title="Redirect chain">
          <ol className="space-y-1 font-mono text-[0.6875rem] text-slate-300">
            {responses.agent.trace.hops.map((hop, i) => (
              <li key={i} className="break-all">
                <span className="text-amber-400">{hop.statusCode}</span> {hop.url}
                <span className="text-slate-600"> → </span>
                {hop.redirectedTo}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[0.6875rem] leading-snug text-slate-400">
            {responses.browser.trace.hops.length === 0
              ? `This redirect happened only for ${profile.name}. A browser was not redirected.`
              : 'A browser was redirected too, so this is not agent-specific.'}
          </p>
        </Section>
      ) : null}

      <Section title="Response headers only the agent saw">
        <HeaderDiff
          browser={responses.browser.trace.responseHeaders}
          agent={responses.agent.trace.responseHeaders}
        />
      </Section>
    </div>
  );
}

function DocRow({
  doc,
  fallbackLabel,
  error,
}: {
  doc: ExtractedDoc | null;
  fallbackLabel: string;
  error?: string;
}) {
  if (!doc) {
    return (
      <tr className="border-t border-slate-800/70">
        <td className="py-1 pr-2 text-slate-300">
          {fallbackLabel}
          {error ? <div className="text-[0.625rem] text-rose-400">{error}</div> : null}
        </td>
        <td className="py-1 text-right text-slate-600">—</td>
        <td className="py-1 text-right text-slate-600">—</td>
        <td className="py-1 text-right text-slate-600">—</td>
      </tr>
    );
  }
  const bad = doc.status === 0 || doc.status >= 400;
  return (
    <tr className="border-t border-slate-800/70">
      <td className="py-1 pr-2 text-slate-300">
        {doc.label}
        <div className="text-[0.625rem]">
          <ShapeBadge shape={doc.shape} />
        </div>
      </td>
      <td className={`py-1 text-right font-mono ${bad ? 'text-rose-400' : 'text-emerald-400'}`}>
        {doc.status || '—'}
      </td>
      <td className="py-1 text-right font-mono text-slate-400">{formatCount(doc.metrics.words)}</td>
      <td className="py-1 text-right font-mono text-slate-400">
        {formatBytes(doc.metrics.payloadBytes)}
      </td>
    </tr>
  );
}

function HeaderDiff({ browser, agent }: { browser: HeaderPair[]; agent: HeaderPair[] }) {
  const browserMap = new Map(browser.map((h) => [h.name.toLowerCase(), h.value]));
  const differing = agent.filter((h) => browserMap.get(h.name.toLowerCase()) !== h.value);

  if (differing.length === 0) {
    return (
      <div className="text-[0.6875rem] text-slate-500">
        Identical response headers. No sign of agent-specific routing at the edge.
      </div>
    );
  }

  return (
    <table className="w-full font-mono text-[0.6875rem]">
      <tbody>
        {differing.map((h) => {
          const was = browserMap.get(h.name.toLowerCase());
          return (
            <tr key={h.name} className="border-t border-slate-800/70 align-top">
              <td className="w-1/3 py-1 pr-2 break-all text-sky-400">{h.name}</td>
              <td className="py-1 break-all text-slate-300">
                {h.value}
                {was !== undefined ? (
                  <div className="text-slate-600 line-through">{was}</div>
                ) : (
                  <div className="text-[0.625rem] text-slate-600">(absent for the browser)</div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
