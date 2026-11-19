import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { HeartbeatBarStrip, LatencyTrendChart } from '../components/TelemetryCharts';
import { ProtocolBadge, SeverityBadge, StatusPill } from '../components/StatusBadges';
import { useAuth } from '../contexts/AuthContext';
import { useTelemetry } from '../contexts/TelemetryContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch, downloadAuthenticatedFile, formatRelativeTime, formatUtcTimestamp } from '../lib/api';

interface MonitorDetailsResponse {
  monitor: {
    id: string;
    name: string;
    target: string;
    protocol: string;
    http_method: string;
    port: number | null;
    dns_record_type: string;
    expected_status: string;
    interval_sec: number;
    timeout_ms: number;
    retry_threshold: number;
    status: string;
    enabled: boolean;
    is_public: boolean;
    last_response_time_ms: number | null;
    last_checked_at: string | null;
    last_error: string;
    ssl_valid: boolean | null;
    ssl_issuer: string | null;
    ssl_subject: string | null;
    ssl_expires_at: string | null;
    ssl_days_remaining: number | null;
    tags: string[];
  };
  availability: { '24h': number; '7d': number; '30d': number; '90d': number };
  latency_stats: { avg_ms: number; p50_ms: number; p95_ms: number };
  checks: Array<{
    id: string;
    status: string;
    response_time_ms: number;
    status_code: number | null;
    error_message: string;
    checked_at: string;
    details: Record<string, unknown>;
  }>;
  errors: Array<{
    id: string;
    status: string;
    response_time_ms: number;
    status_code: number | null;
    error_message: string;
    checked_at: string;
  }>;
  incidents: Array<{
    id: string;
    code: string;
    title: string;
    severity: string;
    status: string;
    started_at: string;
    resolved_at: string | null;
  }>;
  daily_bars: Array<{ day: string; uptime_pct: number }>;
}

export default function MonitorDetailsPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { showToast, confirmAction } = useToast();

  const [monitorList, setMonitorList] = useState<Array<{ id: string; name: string; protocol: string }>>([]);
  const [selectedId, setSelectedId] = useState<string>(id || '');
  const [range, setRange] = useState<'24h' | '7d' | '30d' | '90d'>('24h');
  const [tab, setTab] = useState<'checks' | 'errors' | 'incidents'>('checks');
  const [data, setData] = useState<MonitorDetailsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (id) setSelectedId(id);
  }, [id]);

  useEffect(() => {
    apiFetch<{ items: Array<{ id: string; name: string; protocol: string }> }>('/monitors?limit=100')
      .then((res) => {
        setMonitorList(res.items);
        if (!id && !selectedId && res.items.length > 0) {
          setSelectedId(res.items[0].id);
        }
      })
      .catch(() => undefined);
  }, [id, selectedId]);

  const loadDetails = useCallback(async (silent = false) => {
    if (!selectedId) {
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const res = await apiFetch<MonitorDetailsResponse>(`/monitors/${selectedId}?range=${range}`);
      setData(res);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load monitor telemetry', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedId, range, showToast]);

  useEffect(() => {
    void loadDetails(false);
  }, [loadDetails]);

  useTelemetry((msg) => {
    if (msg.monitor_id === selectedId) {
      void loadDetails(true);
    }
  });

  const handleManualCheck = async () => {
    if (!selectedId) return;
    setChecking(true);
    try {
      const res = await apiFetch<{ status: string; response_time_ms: number; error_message?: string }>(
        `/monitors/${selectedId}/check-now`,
        { method: 'POST' },
      );
      showToast(
        `Probe finished: ${res.status} (${res.response_time_ms}ms)${res.error_message ? ` — ${res.error_message}` : ''}`,
        res.status === 'UP' ? 'success' : 'warn',
      );
      await loadDetails(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Probe trigger failed', 'error');
    } finally {
      setChecking(false);
    }
  };

  const handleTogglePause = async () => {
    if (!data) return;
    try {
      await apiFetch(`/monitors/${data.monitor.id}/toggle-pause`, { method: 'POST' });
      showToast(`${data.monitor.name} ${data.monitor.enabled ? 'paused' : 'resumed'}.`, 'success');
      await loadDetails(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update monitor state', 'error');
    }
  };

  const handleDelete = async () => {
    if (!data) return;
    const ok = await confirmAction({
      title: `Delete "${data.monitor.name}"?`,
      message: 'This permanently deletes the monitor and its check history.',
      confirmLabel: 'Delete Monitor',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiFetch(`/monitors/${data.monitor.id}`, { method: 'DELETE' });
      showToast(`Deleted "${data.monitor.name}".`, 'success');
      navigate('/monitors');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete monitor', 'error');
    }
  };

  if (loading && !data) {
    return <div className="p-8 text-center font-mono text-xs text-[#8c909f]">Loading monitor details...</div>;
  }

  if (!data) {
    return (
      <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-8 text-center space-y-3">
        <p className="text-sm text-[#c2c6d6]">No monitors found. Create a monitor to inspect live telemetry.</p>
        {isAdmin && (
          <Link
            to="/monitors/new"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#4d8eff] text-[#00285d] text-xs font-semibold"
          >
            Add Monitor
          </Link>
        )}
      </div>
    );
  }

  const m = data.monitor;

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb + Monitor Switcher */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/monitors" className="font-mono text-xs text-[#adc6ff] hover:underline">
              Monitors
            </Link>
            <span className="text-[#8c909f]">/</span>
            <select
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                navigate(`/monitors/${e.target.value}`);
              }}
              aria-label="Select monitor"
              className="px-2.5 py-1 rounded-lg bg-[#102034] border border-[#26364a] font-mono text-xs text-[#d3e4fe]"
            >
              {monitorList.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} ({item.protocol})
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <h1 className="text-2xl font-semibold text-[#d3e4fe]">{m.name}</h1>
            <StatusPill status={m.status} />
            <ProtocolBadge protocol={m.protocol} />
          </div>
          <div className="font-mono text-xs text-[#8c909f] break-all">
            {m.target} {m.port ? `• Port ${m.port}` : ''} • Interval {m.interval_sec}s • Timeout {m.timeout_ms}ms
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              void downloadAuthenticatedFile(`/monitors/${m.id}/export.csv`, `monitor-${m.id}-checks.csv`).catch((e) =>
                showToast(e.message, 'error'),
              )
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] border border-[#26364a] text-xs text-[#d3e4fe]"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            <span>Export Checks CSV</span>
          </button>

          {isAdmin && (
            <>
              <button
                type="button"
                disabled={checking}
                onClick={() => void handleManualCheck()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#4edea3] hover:bg-[#4edea3]/90 text-[#003824] text-xs font-semibold disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                <span>{checking ? 'Probing...' : 'Trigger Check'}</span>
              </button>
              <button
                type="button"
                onClick={() => void handleTogglePause()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] border border-[#26364a] text-xs text-amber-300"
              >
                <span className="material-symbols-outlined text-[16px]">{m.enabled ? 'pause' : 'play_circle'}</span>
                <span>{m.enabled ? 'Pause' : 'Resume'}</span>
              </button>
              <Link
                to={`/monitors/${m.id}/edit`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] border border-[#26364a] text-xs text-[#d3e4fe]"
              >
                <span className="material-symbols-outlined text-[16px]">edit</span>
                <span>Edit</span>
              </Link>
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#93000a]/50 hover:bg-[#93000a] border border-[#ff5451]/40 text-xs text-[#ffb4ab]"
              >
                <span className="material-symbols-outlined text-[16px]">delete</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Availability Windows + Latency Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {(['24h', '7d', '30d', '90d'] as const).map((w) => (
          <div key={w} className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-3.5">
            <div className="font-mono text-[10px] uppercase text-[#8c909f]">{w} Availability</div>
            <div className="text-xl font-semibold text-[#4edea3] tabular-nums mt-1">
              {data.availability[w].toFixed(2)}%
            </div>
          </div>
        ))}
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-3.5">
          <div className="font-mono text-[10px] uppercase text-[#8c909f]">P50 Median</div>
          <div className="text-xl font-semibold text-[#d3e4fe] tabular-nums mt-1">{data.latency_stats.p50_ms}ms</div>
        </div>
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-3.5">
          <div className="font-mono text-[10px] uppercase text-[#8c909f]">P95 Tail</div>
          <div className="text-xl font-semibold text-[#adc6ff] tabular-nums mt-1">{data.latency_stats.p95_ms}ms</div>
        </div>
      </div>

      {/* Response Time Trend + SSL Card */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-[#d3e4fe]">Response Time & Latency History</h2>
              <p className="text-xs text-[#8c909f]">
                Last checked: {formatRelativeTime(m.last_checked_at)} ({formatUtcTimestamp(m.last_checked_at)})
              </p>
            </div>
            <div className="inline-flex bg-[#102034] border border-[#1b2b3f] rounded-lg p-1">
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
          </div>

          <LatencyTrendChart
            points={[...data.checks]
              .reverse()
              .slice(-48)
              .map((c) => ({
                label: c.checked_at.slice(11, 16),
                valueMs: c.response_time_ms,
                availabilityPct: c.status === 'UP' ? 100 : 0,
              }))}
            p50Ms={data.latency_stats.p50_ms}
            p95Ms={data.latency_stats.p95_ms}
          />

          <div className="pt-2 border-t border-[#1b2b3f]">
            <div className="flex items-center justify-between text-[11px] font-mono text-[#8c909f] mb-1.5">
              <span>90-Day Daily Heartbeat</span>
              <span>Green ≥ 99.5% • Amber ≥ 95% • Red &lt; 95%</span>
            </div>
            <HeartbeatBarStrip bars={data.daily_bars} slots={60} />
          </div>
        </div>

        {/* Configuration & SSL Details */}
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-5 space-y-4">
          <h2 className="text-sm font-semibold text-[#d3e4fe]">Certificate & Probe Metadata</h2>

          {(m.protocol === 'HTTPS' || m.protocol === 'SSL') && (
            <div className="p-3.5 rounded-xl bg-[#102034] border border-[#1b2b3f] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] uppercase text-[#adc6ff]">X.509 SSL/TLS Certificate</span>
                {m.ssl_valid !== null && (
                  <span
                    className={`font-mono text-[10px] px-2 py-0.5 rounded ${
                      m.ssl_valid ? 'bg-[#00a572]/20 text-[#4edea3]' : 'bg-[#93000a]/50 text-[#ffb4ab]'
                    }`}
                  >
                    {m.ssl_valid ? 'VALID' : 'INVALID'}
                  </span>
                )}
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-[#8c909f]">Days Left:</span>
                  <span
                    className={`font-mono font-semibold ${
                      (m.ssl_days_remaining ?? 99) <= 14 ? 'text-amber-300' : 'text-[#4edea3]'
                    }`}
                  >
                    {m.ssl_days_remaining !== null ? `${m.ssl_days_remaining} days` : 'Not inspected yet'}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-[#8c909f]">Issuer:</span>
                  <span className="font-mono text-[#d3e4fe] truncate">{m.ssl_issuer || '—'}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-[#8c909f]">Subject:</span>
                  <span className="font-mono text-[#d3e4fe] truncate">{m.ssl_subject || '—'}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-[#8c909f]">Expires:</span>
                  <span className="font-mono text-[#c2c6d6] text-[11px]">{formatUtcTimestamp(m.ssl_expires_at)}</span>
                </div>
              </div>
            </div>
          )}

          <div className="p-3.5 rounded-xl bg-[#102034] border border-[#1b2b3f] space-y-2 text-xs">
            <div className="font-mono text-[11px] uppercase text-[#8c909f]">Probe Settings</div>
            <div className="flex justify-between">
              <span className="text-[#8c909f]">Check Frequency:</span>
              <span className="font-mono text-[#d3e4fe]">Every {m.interval_sec}s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#8c909f]">Timeout Budget:</span>
              <span className="font-mono text-[#d3e4fe]">{m.timeout_ms}ms</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#8c909f]">Retry Threshold:</span>
              <span className="font-mono text-[#d3e4fe]">{m.retry_threshold} consecutive failures</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#8c909f]">Public Status Portal:</span>
              <span className="font-mono text-[#4edea3]">{m.is_public ? 'Published' : 'Private'}</span>
            </div>
            {m.expected_status && (
              <div className="flex justify-between">
                <span className="text-[#8c909f]">Expected HTTP:</span>
                <span className="font-mono text-[#d3e4fe]">{m.expected_status}</span>
              </div>
            )}
            {m.protocol === 'DNS' && (
              <div className="flex justify-between">
                <span className="text-[#8c909f]">DNS Query Type:</span>
                <span className="font-mono text-[#d3e4fe]">{m.dns_record_type}</span>
              </div>
            )}
          </div>

          {m.last_error && (
            <div className="p-3 rounded-xl bg-[#93000a]/30 border border-[#ff5451]/40 text-xs text-[#ffb4ab] font-mono">
              Last Error: {m.last_error}
            </div>
          )}
        </div>
      </div>

      {/* History Tabs: Check History, Error History, Incident History */}
      <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl overflow-hidden">
        <div className="flex border-b border-[#1b2b3f] px-4 pt-3 gap-4">
          {[
            { key: 'checks', label: `Check History (${data.checks.length})` },
            { key: 'errors', label: `Error History (${data.errors.length})` },
            { key: 'incidents', label: `Incident History (${data.incidents.length})` },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key as 'checks' | 'errors' | 'incidents')}
              className={`pb-3 text-xs font-semibold border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-[#4edea3] text-[#4edea3]'
                  : 'border-transparent text-[#8c909f] hover:text-[#d3e4fe]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          {tab === 'checks' && (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#102034]/60 border-b border-[#1b2b3f] font-mono text-[10px] uppercase text-[#8c909f]">
                  <th className="p-3">Timestamp (UTC)</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Latency</th>
                  <th className="p-3 text-right">Code</th>
                  <th className="p-3">Message / Payload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b2b3f]/60">
                {data.checks.slice(0, 40).map((c) => (
                  <tr key={c.id} className="hover:bg-[#102034]/50">
                    <td className="p-3 font-mono text-[11px] text-[#c2c6d6] whitespace-nowrap">
                      {formatUtcTimestamp(c.checked_at)}
                    </td>
                    <td className="p-3">
                      <StatusPill status={c.status} />
                    </td>
                    <td className="p-3 text-right font-mono text-[#d3e4fe] tabular-nums">{c.response_time_ms}ms</td>
                    <td className="p-3 text-right font-mono text-[#8c909f]">{c.status_code ?? '—'}</td>
                    <td className="p-3 font-mono text-[11px] text-[#c2c6d6] max-w-md truncate">
                      {c.error_message || 'Assertion passed'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {tab === 'errors' && (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#102034]/60 border-b border-[#1b2b3f] font-mono text-[10px] uppercase text-[#8c909f]">
                  <th className="p-3">Timestamp (UTC)</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Latency</th>
                  <th className="p-3">Diagnostic Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b2b3f]/60">
                {data.errors.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-6 text-center text-[#8c909f] font-mono">
                      Zero failed checks recorded for this monitor.
                    </td>
                  </tr>
                ) : (
                  data.errors.map((e) => (
                    <tr key={e.id} className="hover:bg-[#102034]/50">
                      <td className="p-3 font-mono text-[11px] text-[#c2c6d6] whitespace-nowrap">
                        {formatUtcTimestamp(e.checked_at)}
                      </td>
                      <td className="p-3">
                        <StatusPill status={e.status} />
                      </td>
                      <td className="p-3 text-right font-mono tabular-nums">{e.response_time_ms}ms</td>
                      <td className="p-3 font-mono text-[11px] text-[#ffb4ab]">{e.error_message}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {tab === 'incidents' && (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-[#102034]/60 border-b border-[#1b2b3f] font-mono text-[10px] uppercase text-[#8c909f]">
                  <th className="p-3">Code</th>
                  <th className="p-3">Title</th>
                  <th className="p-3">Severity</th>
                  <th className="p-3">Lifecycle</th>
                  <th className="p-3">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b2b3f]/60">
                {data.incidents.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-[#8c909f] font-mono">
                      No incidents recorded for this monitor.
                    </td>
                  </tr>
                ) : (
                  data.incidents.map((inc) => (
                    <tr key={inc.id} className="hover:bg-[#102034]/50">
                      <td className="p-3 font-mono text-[#adc6ff]">{inc.code}</td>
                      <td className="p-3 font-medium text-[#d3e4fe]">{inc.title}</td>
                      <td className="p-3">
                        <SeverityBadge severity={inc.severity} />
                      </td>
                      <td className="p-3">
                        <StatusPill status={inc.status} />
                      </td>
                      <td className="p-3 font-mono text-[11px] text-[#8c909f]">
                        {formatUtcTimestamp(inc.started_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
