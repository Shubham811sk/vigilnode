import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MiniSparkline } from '../components/TelemetryCharts';
import { ProtocolBadge, StatusPill } from '../components/StatusBadges';
import { useAuth } from '../contexts/AuthContext';
import { useTelemetry } from '../contexts/TelemetryContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch, downloadAuthenticatedFile, formatRelativeTime } from '../lib/api';

interface MonitorItem {
  id: string;
  name: string;
  target: string;
  protocol: string;
  port: number | null;
  status: string;
  enabled: boolean;
  is_public: boolean;
  interval_sec: number;
  last_response_time_ms: number | null;
  last_checked_at: string | null;
  last_error: string;
  uptime_pct: number;
  tags: string[];
  recent_checks: Array<{ status: string; response_time_ms: number }>;
}

interface MonitorsResponse {
  items: MonitorItem[];
  total: number;
  page: number;
  limit: number;
  total_pages: number;
  summary: {
    total: number;
    up: number;
    degraded: number;
    down: number;
    paused: number;
    maintenance: number;
  };
}

export default function MonitorsPage() {
  const { isAdmin } = useAuth();
  const { showToast, confirmAction } = useToast();

  const [data, setData] = useState<MonitorsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [protocol, setProtocol] = useState('ALL');
  const [sort, setSort] = useState('created_at');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadMonitors = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({
        search,
        status,
        protocol,
        sort,
        order,
        page: String(page),
        limit: '15',
      });
      const res = await apiFetch<MonitorsResponse>(`/monitors?${params.toString()}`);
      setData(res);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load monitors', 'error');
    } finally {
      setLoading(false);
    }
  }, [search, status, protocol, sort, order, page, showToast]);

  useEffect(() => {
    void loadMonitors(false);
  }, [loadMonitors]);

  useTelemetry((msg) => {
    if (msg.event === 'PROBE_RESULT' || msg.event === 'MONITOR_UPDATED') {
      void loadMonitors(true);
    }
  });

  const handleTogglePause = async (mon: MonitorItem) => {
    setBusyId(mon.id);
    try {
      await apiFetch(`/monitors/${mon.id}/toggle-pause`, { method: 'POST' });
      showToast(`${mon.name} ${mon.enabled ? 'paused' : 'resumed'}.`, 'success');
      await loadMonitors(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to toggle monitor', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleCheckNow = async (mon: MonitorItem) => {
    setBusyId(mon.id);
    try {
      const res = await apiFetch<{ status: string; response_time_ms: number; error_message?: string }>(
        `/monitors/${mon.id}/check-now`,
        { method: 'POST' },
      );
      showToast(
        `${mon.name}: ${res.status} (${res.response_time_ms}ms)${res.error_message ? ` — ${res.error_message}` : ''}`,
        res.status === 'UP' ? 'success' : 'warn',
      );
      await loadMonitors(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Manual probe failed', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (mon: MonitorItem) => {
    const ok = await confirmAction({
      title: `Delete "${mon.name}"?`,
      message: 'This removes the monitor and its historical check logs permanently.',
      confirmLabel: 'Delete Monitor',
      danger: true,
    });
    if (!ok) return;
    setBusyId(mon.id);
    try {
      await apiFetch(`/monitors/${mon.id}`, { method: 'DELETE' });
      showToast(`Deleted monitor "${mon.name}".`, 'success');
      setSelectedIds((prev) => prev.filter((id) => id !== mon.id));
      await loadMonitors(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete monitor', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const handleBulk = async (action: 'pause' | 'resume' | 'check' | 'delete') => {
    if (selectedIds.length === 0) return;
    if (action === 'delete') {
      const ok = await confirmAction({
        title: `Delete ${selectedIds.length} monitor(s)?`,
        message: 'Selected monitors and their telemetry history will be permanently deleted.',
        confirmLabel: 'Delete Selected',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      const res = await apiFetch<{ message: string }>('/monitors/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids: selectedIds, action }),
      });
      showToast(res.message, 'success');
      setSelectedIds([]);
      await loadMonitors(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Bulk action failed', 'error');
    }
  };

  const items = data?.items || [];
  const allChecked = items.length > 0 && items.every((m) => selectedIds.includes(m.id));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-wider text-[#adc6ff]">MULTI-PROTOCOL INVENTORY</div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#d3e4fe] mt-1">Monitor Management</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              void downloadAuthenticatedFile('/monitors/export.csv', 'vigilnode-monitors.csv').catch((e) =>
                showToast(e.message, 'error'),
              )
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] border border-[#26364a] text-xs font-medium text-[#d3e4fe]"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            <span>Export CSV</span>
          </button>
          {isAdmin && (
            <Link
              to="/monitors/new"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#4d8eff] hover:bg-[#adc6ff] text-[#00285d] text-xs font-semibold"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              <span>Add New Monitor</span>
            </Link>
          )}
        </div>
      </div>

      {/* Summary Status Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {[
          { key: 'ALL', label: `All (${data?.summary.total ?? 0})` },
          { key: 'UP', label: `Operational (${data?.summary.up ?? 0})` },
          { key: 'DOWN', label: `Down (${data?.summary.down ?? 0})` },
          { key: 'DEGRADED', label: `Degraded (${data?.summary.degraded ?? 0})` },
          { key: 'PAUSED', label: `Paused (${data?.summary.paused ?? 0})` },
          { key: 'MAINTENANCE', label: `Maintenance (${data?.summary.maintenance ?? 0})` },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setStatus(tab.key);
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-lg font-mono text-xs border transition-colors ${
              status === tab.key
                ? 'bg-[#1b2b3f] border-[#adc6ff]/50 text-[#adc6ff] font-semibold'
                : 'bg-[#0b1c30] border-[#1b2b3f] text-[#c2c6d6] hover:bg-[#102034]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filter & Search Toolbar */}
      <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <span className="material-symbols-outlined text-[16px] text-[#8c909f] absolute left-3 top-1/2 -translate-y-1/2">
              search
            </span>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Filter by name, hostname, IP, or tag..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] focus:border-[#adc6ff] focus:outline-none text-xs text-[#d3e4fe]"
            />
          </div>

          <select
            value={protocol}
            onChange={(e) => {
              setProtocol(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by protocol"
            className="px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
          >
            <option value="ALL">All Protocols</option>
            <option value="HTTPS">HTTPS</option>
            <option value="HTTP">HTTP</option>
            <option value="TCP">TCP</option>
            <option value="DNS">DNS</option>
            <option value="SSL">SSL</option>
          </select>

          <select
            value={`${sort}:${order}`}
            onChange={(e) => {
              const [s, o] = e.target.value.split(':') as [string, 'asc' | 'desc'];
              setSort(s);
              setOrder(o);
            }}
            aria-label="Sort monitors"
            className="px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
          >
            <option value="created_at:desc">Newest First</option>
            <option value="name:asc">Name (A-Z)</option>
            <option value="status:asc">Status</option>
            <option value="latency:desc">Highest Latency</option>
            <option value="last_checked_at:desc">Recently Checked</option>
          </select>
        </div>

        {isAdmin && selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2 lg:pt-0 border-t lg:border-t-0 border-[#1b2b3f]">
            <span className="font-mono text-xs text-[#adc6ff]">{selectedIds.length} selected:</span>
            <button
              type="button"
              onClick={() => void handleBulk('check')}
              className="px-2.5 py-1.5 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] text-xs text-[#4edea3] border border-[#26364a]"
            >
              Run Check
            </button>
            <button
              type="button"
              onClick={() => void handleBulk('pause')}
              className="px-2.5 py-1.5 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] text-xs text-amber-300 border border-[#26364a]"
            >
              Pause
            </button>
            <button
              type="button"
              onClick={() => void handleBulk('resume')}
              className="px-2.5 py-1.5 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] text-xs text-[#adc6ff] border border-[#26364a]"
            >
              Resume
            </button>
            <button
              type="button"
              onClick={() => void handleBulk('delete')}
              className="px-2.5 py-1.5 rounded-lg bg-[#93000a]/50 hover:bg-[#93000a] text-xs text-[#ffb4ab] border border-[#ff5451]/40"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Monitors Table / Cards */}
      <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl overflow-hidden">
        {loading && !data ? (
          <div className="p-8 text-center font-mono text-xs text-[#8c909f]">Loading monitors...</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <p className="text-sm text-[#c2c6d6]">No monitors match your current filter criteria.</p>
            {isAdmin && (
              <Link
                to="/monitors/new"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#4d8eff] text-[#00285d] text-xs font-semibold"
              >
                Create Monitor
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#102034]/80 border-b border-[#1b2b3f] font-mono text-[10px] uppercase tracking-wider text-[#8c909f]">
                  {isAdmin && (
                    <th className="p-3 w-10">
                      <input
                        type="checkbox"
                        checked={allChecked}
                        onChange={(e) =>
                          setSelectedIds(e.target.checked ? items.map((m) => m.id) : [])
                        }
                        aria-label="Select all monitors on page"
                      />
                    </th>
                  )}
                  <th className="p-3">Monitor & Target</th>
                  <th className="p-3">Protocol</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Uptime / Pulse</th>
                  <th className="p-3 text-right">Response</th>
                  <th className="p-3 text-right">Last Checked</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b2b3f]/70 text-xs">
                {items.map((mon) => (
                  <tr key={mon.id} className="hover:bg-[#102034]/60 transition-colors">
                    {isAdmin && (
                      <td className="p-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(mon.id)}
                          onChange={(e) =>
                            setSelectedIds((prev) =>
                              e.target.checked ? [...prev, mon.id] : prev.filter((id) => id !== mon.id),
                            )
                          }
                          aria-label={`Select ${mon.name}`}
                        />
                      </td>
                    )}
                    <td className="p-3 min-w-[220px]">
                      <Link to={`/monitors/${mon.id}`} className="font-semibold text-[#d3e4fe] hover:text-[#adc6ff]">
                        {mon.name}
                      </Link>
                      <div className="font-mono text-[11px] text-[#8c909f] truncate max-w-xs">{mon.target}</div>
                      {mon.last_error && mon.status !== 'UP' && (
                        <div className="font-mono text-[10px] text-[#ffb4ab] mt-0.5 truncate max-w-xs">
                          {mon.last_error}
                        </div>
                      )}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <ProtocolBadge protocol={mon.protocol} />
                        <span className="font-mono text-[10px] text-[#8c909f]">{mon.interval_sec}s</span>
                      </div>
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <StatusPill status={mon.status} />
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono text-xs text-[#4edea3] tabular-nums w-14">
                          {mon.uptime_pct.toFixed(2)}%
                        </span>
                        <MiniSparkline checks={mon.recent_checks} />
                      </div>
                    </td>
                    <td className="p-3 text-right font-mono text-[#d3e4fe] tabular-nums whitespace-nowrap">
                      {mon.last_response_time_ms !== null ? `${mon.last_response_time_ms}ms` : '—'}
                    </td>
                    <td className="p-3 text-right font-mono text-[11px] text-[#8c909f] whitespace-nowrap">
                      {formatRelativeTime(mon.last_checked_at)}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1">
                        <Link
                          to={`/monitors/${mon.id}`}
                          className="p-1.5 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] text-[#adc6ff]"
                          title="View Details"
                        >
                          <span className="material-symbols-outlined text-[16px]">insights</span>
                        </Link>
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              disabled={busyId === mon.id}
                              onClick={() => void handleCheckNow(mon)}
                              className="p-1.5 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] text-[#4edea3] disabled:opacity-40"
                              title="Trigger Manual Check"
                            >
                              <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                            </button>
                            <button
                              type="button"
                              disabled={busyId === mon.id}
                              onClick={() => void handleTogglePause(mon)}
                              className="p-1.5 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] text-amber-300 disabled:opacity-40"
                              title={mon.enabled ? 'Pause Monitor' : 'Resume Monitor'}
                            >
                              <span className="material-symbols-outlined text-[16px]">
                                {mon.enabled ? 'pause' : 'play_circle'}
                              </span>
                            </button>
                            <Link
                              to={`/monitors/${mon.id}/edit`}
                              className="p-1.5 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] text-[#c2c6d6]"
                              title="Edit Monitor"
                            >
                              <span className="material-symbols-outlined text-[16px]">edit</span>
                            </Link>
                            <button
                              type="button"
                              disabled={busyId === mon.id}
                              onClick={() => void handleDelete(mon)}
                              className="p-1.5 rounded-lg bg-[#102034] hover:bg-[#93000a]/60 text-[#ffb4ab] disabled:opacity-40"
                              title="Delete Monitor"
                            >
                              <span className="material-symbols-outlined text-[16px]">delete</span>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {data && data.total_pages > 1 && (
          <div className="px-4 py-3 border-t border-[#1b2b3f] flex items-center justify-between text-xs font-mono text-[#8c909f]">
            <span>
              Showing page {data.page} of {data.total_pages} ({data.total} monitors)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded bg-[#102034] hover:bg-[#1b2b3f] disabled:opacity-40 text-[#d3e4fe]"
              >
                Prev
              </button>
              <button
                type="button"
                disabled={page >= data.total_pages}
                onClick={() => setPage((p) => Math.min(data.total_pages, p + 1))}
                className="px-2.5 py-1 rounded bg-[#102034] hover:bg-[#1b2b3f] disabled:opacity-40 text-[#d3e4fe]"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
