import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LatencyTrendChart } from '../components/TelemetryCharts';
import { ProtocolBadge, StatusPill } from '../components/StatusBadges';
import { useToast } from '../contexts/ToastContext';
import { apiFetch, downloadAuthenticatedFile, formatDuration } from '../lib/api';

interface AnalyticsPayload {
  range: string;
  overview: {
    overall_uptime_pct: number;
    avg_response_ms: number;
    p50_ms: number;
    p95_ms: number;
    mtta_sec: number;
    mttr_sec: number;
    total_checks: number;
    total_failures: number;
  };
  windows: Record<
    '24h' | '7d' | '30d' | '90d',
    { uptime_pct: number; checks_total: number; failed_checks: number; incidents_count: number }
  >;
  protocol_stats: Array<{
    protocol: string;
    total_checks: number;
    failed_checks: number;
    uptime_pct: number;
    p50_ms: number;
    p95_ms: number;
  }>;
  daily_series: Array<{
    day: string;
    uptime_pct: number;
    avg_ms: number;
    total_checks: number;
  }>;
  unstable_monitors: Array<{
    id: string;
    name: string;
    target: string;
    protocol: string;
    status: string;
    transitions: number;
    failed_checks: number;
    uptime_pct: number;
    predominant_error: string;
  }>;
}

export default function AnalyticsPage() {
  const { showToast } = useToast();
  const [range, setRange] = useState<'24h' | '7d' | '30d' | '90d'>('30d');
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<AnalyticsPayload>(`/analytics?range=${range}`);
      setData(res);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load analytics', 'error');
    } finally {
      setLoading(false);
    }
  }, [range, showToast]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  if (loading && !data) {
    return <div className="p-8 text-center font-mono text-xs text-[#8c909f]">Computing SLA & availability analytics...</div>;
  }

  const ov = data?.overview;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-wider text-[#adc6ff]">
            MULTI-PROTOCOL SLA & AVAILABILITY INTELLIGENCE
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#d3e4fe] mt-1">Service Availability Analytics</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          <div className="inline-flex bg-[#0b1c30] border border-[#1b2b3f] rounded-lg p-1">
            {(['24h', '7d', '30d', '90d'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`px-2.5 py-1 rounded font-mono text-xs ${
                  range === r ? 'bg-[#4d8eff] text-[#00285d] font-semibold' : 'text-[#c2c6d6]'
                }`}
              >
                {r.toUpperCase()}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() =>
              void downloadAuthenticatedFile('/analytics/export.csv', 'vigilnode-availability-report.csv').catch((e) =>
                showToast(e.message, 'error'),
              )
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#4d8eff] hover:bg-[#adc6ff] text-[#00285d] text-xs font-semibold"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] border border-[#26364a] text-xs text-[#d3e4fe]"
          >
            <span className="material-symbols-outlined text-[16px]">print</span>
            <span>Print Report</span>
          </button>
        </div>
      </div>

      {/* Top 6 KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4">
          <div className="font-mono text-[10px] uppercase text-[#8c909f]">Overall Uptime</div>
          <div className="text-2xl font-semibold text-[#4edea3] tabular-nums mt-1">
            {ov?.overall_uptime_pct.toFixed(2)}%
          </div>
          <div className="font-mono text-[10px] text-[#8c909f] mt-1">{ov?.total_checks} checks</div>
        </div>
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4">
          <div className="font-mono text-[10px] uppercase text-[#8c909f]">Avg Response</div>
          <div className="text-2xl font-semibold text-[#d3e4fe] tabular-nums mt-1">{ov?.avg_response_ms}ms</div>
          <div className="font-mono text-[10px] text-[#8c909f] mt-1">Across all probes</div>
        </div>
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4">
          <div className="font-mono text-[10px] uppercase text-[#8c909f]">P50 Median</div>
          <div className="text-2xl font-semibold text-[#4edea3] tabular-nums mt-1">{ov?.p50_ms}ms</div>
          <div className="font-mono text-[10px] text-[#8c909f] mt-1">50th percentile</div>
        </div>
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4">
          <div className="font-mono text-[10px] uppercase text-[#8c909f]">P95 Tail</div>
          <div className="text-2xl font-semibold text-[#adc6ff] tabular-nums mt-1">{ov?.p95_ms}ms</div>
          <div className="font-mono text-[10px] text-[#8c909f] mt-1">95th percentile</div>
        </div>
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4">
          <div className="font-mono text-[10px] uppercase text-[#8c909f]">MTTA</div>
          <div className="text-2xl font-semibold text-[#d3e4fe] tabular-nums mt-1">
            {formatDuration(ov?.mtta_sec ?? 0)}
          </div>
          <div className="font-mono text-[10px] text-[#8c909f] mt-1">Mean acknowledge</div>
        </div>
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4">
          <div className="font-mono text-[10px] uppercase text-[#8c909f]">MTTR</div>
          <div className="text-2xl font-semibold text-[#d3e4fe] tabular-nums mt-1">
            {formatDuration(ov?.mttr_sec ?? 0)}
          </div>
          <div className="font-mono text-[10px] text-[#8c909f] mt-1">Mean resolution</div>
        </div>
      </div>

      {/* Multi-Window Rolling Availability Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {(['24h', '7d', '30d', '90d'] as const).map((w) => {
          const item = data?.windows[w];
          return (
            <div key={w} className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs uppercase text-[#adc6ff]">{w.toUpperCase()} Window</span>
                <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[#00a572]/20 text-[#4edea3]">
                  {item && item.uptime_pct >= 99.5 ? 'HEALTHY' : 'ATTENTION'}
                </span>
              </div>
              <div className="text-3xl font-semibold text-[#4edea3] tabular-nums">
                {item?.uptime_pct.toFixed(2)}%
              </div>
              <div className="flex items-center justify-between font-mono text-[11px] text-[#8c909f]">
                <span>Failed: {item?.failed_checks ?? 0}</span>
                <span>Incidents: {item?.incidents_count ?? 0}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Trend Chart + Protocol Failures */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-5 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-[#d3e4fe]">Daily Latency & Availability Trend ({range})</h2>
            <p className="text-xs text-[#8c909f]">Daily average response latency compared against P50 and P95</p>
          </div>
          <LatencyTrendChart
            points={(data?.daily_series || []).map((d) => ({
              label: d.day.slice(5),
              valueMs: d.avg_ms,
              availabilityPct: d.uptime_pct,
            }))}
            p50Ms={ov?.p50_ms}
            p95Ms={ov?.p95_ms}
          />
        </div>

        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-[#d3e4fe]">Protocol Performance & Failures</h2>
          <div className="space-y-2.5">
            {(data?.protocol_stats || []).map((ps) => (
              <div key={ps.protocol} className="p-3 rounded-xl bg-[#102034] border border-[#1b2b3f] space-y-1.5">
                <div className="flex items-center justify-between">
                  <ProtocolBadge protocol={ps.protocol} />
                  <span className="font-mono text-xs font-semibold text-[#4edea3] tabular-nums">
                    {ps.uptime_pct.toFixed(2)}%
                  </span>
                </div>
                <div className="flex items-center justify-between font-mono text-[11px] text-[#c2c6d6]">
                  <span>P50: {ps.p50_ms}ms • P95: {ps.p95_ms}ms</span>
                  <span className={ps.failed_checks > 0 ? 'text-[#ffb4ab]' : 'text-[#8c909f]'}>
                    {ps.failed_checks} fails
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top Flapping / Unstable Endpoints */}
      <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#1b2b3f] flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#d3e4fe]">Endpoint Stability & Flapping Analysis</h2>
          <span className="font-mono text-[11px] text-[#8c909f]">Ranked by UP/DOWN state transitions</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#102034]/60 border-b border-[#1b2b3f] font-mono text-[10px] uppercase text-[#8c909f]">
                <th className="p-3">Monitor</th>
                <th className="p-3">Protocol</th>
                <th className="p-3 text-right">Transitions</th>
                <th className="p-3 text-right">Failed Checks</th>
                <th className="p-3 text-right">Uptime</th>
                <th className="p-3">Predominant Diagnostic</th>
                <th className="p-3">Current</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1b2b3f]/60">
              {(data?.unstable_monitors || []).map((um) => (
                <tr key={um.id} className="hover:bg-[#102034]/50">
                  <td className="p-3 font-medium text-[#d3e4fe]">
                    <Link to={`/monitors/${um.id}`} className="hover:text-[#adc6ff]">
                      {um.name}
                    </Link>
                    <div className="font-mono text-[10px] text-[#8c909f]">{um.target}</div>
                  </td>
                  <td className="p-3">
                    <ProtocolBadge protocol={um.protocol} />
                  </td>
                  <td className="p-3 text-right font-mono text-amber-300 tabular-nums">{um.transitions} flaps</td>
                  <td className="p-3 text-right font-mono text-[#ffb4ab] tabular-nums">{um.failed_checks}</td>
                  <td className="p-3 text-right font-mono text-[#4edea3] tabular-nums">{um.uptime_pct.toFixed(2)}%</td>
                  <td className="p-3 font-mono text-[11px] text-[#c2c6d6] max-w-xs truncate">{um.predominant_error}</td>
                  <td className="p-3">
                    <StatusPill status={um.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
