import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LatencyTrendChart } from '../components/TelemetryCharts';
import { ProtocolBadge, SeverityBadge, StatusPill } from '../components/StatusBadges';
import { useAuth } from '../contexts/AuthContext';
import { useTelemetry } from '../contexts/TelemetryContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch, formatRelativeTime } from '../lib/api';

interface DashboardData {
  range: string;
  summary: {
    total_monitors: number;
    up_monitors: number;
    down_monitors: number;
    degraded_monitors: number;
    paused_monitors: number;
    maintenance_monitors: number;
    overall_uptime_pct: number;
    avg_response_time_ms: number;
    p50_latency_ms: number;
    p95_latency_ms: number;
    min_latency_ms: number;
    max_latency_ms: number;
    active_incidents: number;
    ssl_total: number;
    ssl_warnings: Array<{ id: string; name: string; days_remaining: number }>;
  };
  monitors_preview: Array<{
    id: string;
    name: string;
    target: string;
    protocol: string;
    status: string;
    last_response_time_ms: number | null;
    last_checked_at: string | null;
  }>;
  protocol_distribution: Array<{
    protocol: string;
    count: number;
    up_count: number;
    availability_pct: number;
  }>;
  response_series: Array<{
    bucket: string;
    avg_ms: number;
    availability_pct: number;
  }>;
  recent_incidents: Array<{
    id: string;
    code: string;
    title: string;
    severity: string;
    status: string;
    monitor_name: string | null;
    started_at: string;
  }>;
  recent_checks: Array<{
    id: string;
    monitor_id: string;
    monitor_name: string;
    monitor_protocol: string;
    monitor_target: string;
    status: string;
    response_time_ms: number;
    status_code: number | null;
    error_message: string;
    checked_at: string;
  }>;
}

export default function DashboardPage() {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();
  const [range, setRange] = useState<'24h' | '7d' | '30d' | '90d'>('30d');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadDashboard = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await apiFetch<DashboardData>(`/dashboard?range=${range}`);
      setData(res);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load dashboard telemetry', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [range, showToast]);

  useEffect(() => {
    void loadDashboard(false);
  }, [loadDashboard]);

  useTelemetry((msg) => {
    if (msg.event === 'PROBE_RESULT' || msg.event === 'INCIDENT_CREATED' || msg.event === 'INCIDENT_UPDATED' || msg.event === 'MONITOR_UPDATED') {
      void loadDashboard(true);
    }
  });

  if (loading && !data) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-10 w-64 bg-[#102034] rounded-lg" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 bg-[#0b1c30] rounded-xl border border-[#1b2b3f]" />
          ))}
        </div>
        <div className="h-64 bg-[#0b1c30] rounded-xl border border-[#1b2b3f]" />
      </div>
    );
  }

  const s = data?.summary;

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-wider text-[#adc6ff] flex items-center gap-2">
            <span>SERVICE AVAILABILITY OVERVIEW</span>
            <span>•</span>
            <span className="text-[#4edea3]">LIVE TELEMETRY</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#d3e4fe] mt-1">Admin Telemetry Dashboard</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex bg-[#0b1c30] border border-[#1b2b3f] rounded-lg p-1">
            {(['24h', '7d', '30d', '90d'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`px-2.5 py-1 rounded-md font-mono text-xs transition-colors ${
                  range === r ? 'bg-[#4d8eff] text-[#00285d] font-semibold' : 'text-[#c2c6d6] hover:text-[#d3e4fe]'
                }`}
              >
                {r.toUpperCase()}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void loadDashboard(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] border border-[#26364a] text-xs font-medium text-[#d3e4fe] transition-colors"
          >
            <span className={`material-symbols-outlined text-[16px] ${refreshing ? 'animate-spin' : ''}`}>refresh</span>
            <span>Refresh</span>
          </button>

          {isAdmin && (
            <Link
              to="/monitors/new"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#4d8eff] hover:bg-[#adc6ff] text-[#00285d] text-xs font-semibold transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">add_circle</span>
              <span>Add Monitor</span>
            </Link>
          )}
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[#8c909f]">Overall Uptime ({range})</span>
            <span className="material-symbols-outlined text-[#4edea3] text-[20px]">verified</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-semibold text-[#4edea3] tabular-nums">
              {s?.overall_uptime_pct.toFixed(2)}%
            </span>
            <span className="font-mono text-[11px] text-[#8c909f]">Target ≥ 99.9%</span>
          </div>
          <div className="mt-2 text-xs text-[#c2c6d6] flex items-center justify-between">
            <span>{s?.total_monitors} total monitors</span>
            <span className="font-mono text-[11px] text-[#4edea3]">{s?.up_monitors} UP</span>
          </div>
        </div>

        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[#8c909f]">Fleet Status Mix</span>
            <span className="material-symbols-outlined text-[#adc6ff] text-[20px]">dns</span>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1 text-center font-mono">
            <div className="bg-[#102034] rounded-lg py-1.5">
              <div className="text-sm font-bold text-[#4edea3] tabular-nums">{s?.up_monitors ?? 0}</div>
              <div className="text-[9px] text-[#8c909f]">UP</div>
            </div>
            <div className="bg-[#102034] rounded-lg py-1.5">
              <div className="text-sm font-bold text-[#ffb4ab] tabular-nums">{s?.down_monitors ?? 0}</div>
              <div className="text-[9px] text-[#8c909f]">DOWN</div>
            </div>
            <div className="bg-[#102034] rounded-lg py-1.5">
              <div className="text-sm font-bold text-amber-300 tabular-nums">{s?.degraded_monitors ?? 0}</div>
              <div className="text-[9px] text-[#8c909f]">DEG</div>
            </div>
            <div className="bg-[#102034] rounded-lg py-1.5">
              <div className="text-sm font-bold text-[#c2c6d6] tabular-nums">{s?.paused_monitors ?? 0}</div>
              <div className="text-[9px] text-[#8c909f]">PAUSED</div>
            </div>
          </div>
          <div className="mt-2 text-[11px] font-mono text-[#8c909f]">
            {s?.maintenance_monitors ?? 0} in scheduled maintenance
          </div>
        </div>

        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[#8c909f]">Response Latency</span>
            <span className="material-symbols-outlined text-[#adc6ff] text-[20px]">speed</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-semibold text-[#d3e4fe] tabular-nums">
              {s?.avg_response_time_ms ?? 0}
              <span className="text-sm text-[#8c909f] ml-0.5">ms</span>
            </span>
          </div>
          <div className="mt-2 font-mono text-[11px] text-[#c2c6d6] flex items-center justify-between">
            <span>P50: {s?.p50_latency_ms ?? 0}ms</span>
            <span>P95: {s?.p95_latency_ms ?? 0}ms</span>
          </div>
        </div>

        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[#8c909f]">Active Incidents & SSL</span>
            <span
              className={`material-symbols-outlined text-[20px] ${
                (s?.active_incidents ?? 0) > 0 ? 'text-[#ff5451]' : 'text-[#4edea3]'
              }`}
            >
              {(s?.active_incidents ?? 0) > 0 ? 'warning' : 'shield_lock'}
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <span
              className={`text-3xl font-semibold tabular-nums ${
                (s?.active_incidents ?? 0) > 0 ? 'text-[#ffb4ab]' : 'text-[#4edea3]'
              }`}
            >
              {s?.active_incidents ?? 0}
            </span>
            <span className="text-xs text-[#c2c6d6]">Active Incidents</span>
          </div>
          <div className="mt-2 flex items-center justify-between font-mono text-[11px]">
            <span className="text-[#c2c6d6]">
              SSL Certs: {s?.ssl_total ?? 0} tracked
            </span>
            {(s?.ssl_warnings.length ?? 0) > 0 ? (
              <span className="text-amber-300">{s?.ssl_warnings.length} expiring soon</span>
            ) : (
              <span className="text-[#4edea3]">All TLS Valid</span>
            )}
          </div>
        </div>
      </div>

      {/* Main Analytics + Protocol Distribution Row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-[#d3e4fe]">Response Time & Availability Trend</h2>
              <p className="text-xs text-[#8c909f]">Aggregated synthetic check latency across active protocols</p>
            </div>
            <div className="flex items-center gap-3 font-mono text-[11px]">
              <span className="flex items-center gap-1.5 text-[#adc6ff]">
                <span className="w-2.5 h-0.5 bg-[#adc6ff]" /> Avg Latency
              </span>
              <span className="flex items-center gap-1.5 text-[#4edea3]">
                <span className="w-2.5 h-0.5 bg-[#4edea3]" /> P50
              </span>
              <span className="flex items-center gap-1.5 text-[#ffb3ad]">
                <span className="w-2.5 h-0.5 bg-[#ffb3ad]" /> P95
              </span>
            </div>
          </div>

          <LatencyTrendChart
            points={(data?.response_series || []).map((b) => ({
              label: b.bucket.slice(5).replace('T', ' ') + 'h',
              valueMs: b.avg_ms,
              availabilityPct: b.availability_pct,
            }))}
            p50Ms={s?.p50_latency_ms}
            p95Ms={s?.p95_latency_ms}
          />
        </div>

        {/* Protocol Distribution */}
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-5 flex flex-col justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[#d3e4fe]">Protocol Distribution</h2>
            <p className="text-xs text-[#8c909f] mb-4">Availability by synthetic probe protocol</p>

            <div className="space-y-3">
              {(data?.protocol_distribution || []).map((p) => (
                <div key={p.protocol} className="p-3 rounded-lg bg-[#102034] border border-[#1b2b3f]">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <ProtocolBadge protocol={p.protocol} />
                      <span className="text-xs text-[#c2c6d6] font-mono">
                        {p.up_count}/{p.count} UP
                      </span>
                    </div>
                    <span className="font-mono text-xs font-semibold text-[#4edea3] tabular-nums">
                      {p.availability_pct.toFixed(2)}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-[#000f21] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#4edea3] transition-all"
                      style={{ width: `${Math.min(100, Math.max(2, p.availability_pct))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Link
            to="/analytics"
            className="mt-4 inline-flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] border border-[#26364a] text-xs font-medium text-[#adc6ff] transition-colors"
          >
            <span>Open Deep SLA Analytics</span>
            <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
          </Link>
        </div>
      </div>

      {/* Monitors Preview Grid */}
      <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-[#d3e4fe]">Monitored Services Snapshot</h2>
            <p className="text-xs text-[#8c909f]">Click any monitor to inspect check logs, latency percentiles & SSL details</p>
          </div>
          <Link to="/monitors" className="text-xs font-medium text-[#adc6ff] hover:underline flex items-center gap-1">
            <span>View All ({s?.total_monitors})</span>
            <span className="material-symbols-outlined text-[15px]">chevron_right</span>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {(data?.monitors_preview || []).map((m) => (
            <Link
              key={m.id}
              to={`/monitors/${m.id}`}
              className="p-3.5 rounded-xl bg-[#102034] hover:bg-[#1b2b3f] border border-[#1b2b3f] hover:border-[#26364a] transition-colors flex flex-col justify-between gap-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#d3e4fe] truncate">{m.name}</div>
                  <div className="font-mono text-[11px] text-[#8c909f] truncate mt-0.5">{m.target}</div>
                </div>
                <StatusPill status={m.status} />
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-[#1b2b3f]/80 font-mono text-[11px]">
                <ProtocolBadge protocol={m.protocol} />
                <span className="text-[#c2c6d6] tabular-nums">
                  {m.last_response_time_ms !== null ? `${m.last_response_time_ms}ms` : '—'}
                </span>
                <span className="text-[#8c909f]">{formatRelativeTime(m.last_checked_at)}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Bottom Split: Recent Incidents + Live Probe Activity Stream */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[#d3e4fe]">Recent Incidents</h2>
            <Link to="/incidents" className="text-xs text-[#adc6ff] hover:underline">
              Triage Console →
            </Link>
          </div>
          {(data?.recent_incidents || []).length === 0 ? (
            <p className="text-xs text-[#8c909f] py-6 text-center">No incidents recorded.</p>
          ) : (
            <div className="space-y-2.5">
              {data!.recent_incidents.slice(0, 5).map((inc) => (
                <Link
                  key={inc.id}
                  to="/incidents"
                  className="block p-3 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] border border-[#1b2b3f] transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[11px] text-[#adc6ff]">{inc.code}</span>
                      <SeverityBadge severity={inc.severity} />
                    </div>
                    <StatusPill status={inc.status} />
                  </div>
                  <div className="text-xs font-medium text-[#d3e4fe] mt-1.5 truncate">{inc.title}</div>
                  <div className="flex items-center justify-between font-mono text-[10px] text-[#8c909f] mt-1">
                    <span>{inc.monitor_name || 'System Component'}</span>
                    <span>{formatRelativeTime(inc.started_at)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#4edea3] animate-pulse" />
              <h2 className="text-sm font-semibold text-[#d3e4fe]">Recent Monitoring Activity</h2>
            </div>
            <span className="font-mono text-[10px] text-[#8c909f]">Latest 15 probes</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#1b2b3f] font-mono text-[10px] uppercase text-[#8c909f]">
                  <th className="py-2 pr-2">Monitor</th>
                  <th className="py-2 px-2">Proto</th>
                  <th className="py-2 px-2">Result</th>
                  <th className="py-2 px-2 text-right">Latency</th>
                  <th className="py-2 pl-2 text-right">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b2b3f]/60 text-xs">
                {(data?.recent_checks || []).slice(0, 8).map((chk) => (
                  <tr key={chk.id} className="hover:bg-[#102034]/60">
                    <td className="py-2 pr-2 font-medium text-[#d3e4fe] truncate max-w-[160px]">
                      <Link to={`/monitors/${chk.monitor_id}`} className="hover:text-[#adc6ff]">
                        {chk.monitor_name}
                      </Link>
                    </td>
                    <td className="py-2 px-2">
                      <ProtocolBadge protocol={chk.monitor_protocol} />
                    </td>
                    <td className="py-2 px-2">
                      <StatusPill status={chk.status} />
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-[#c2c6d6] tabular-nums">
                      {chk.response_time_ms}ms
                    </td>
                    <td className="py-2 pl-2 text-right font-mono text-[11px] text-[#8c909f] whitespace-nowrap">
                      {formatRelativeTime(chk.checked_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
