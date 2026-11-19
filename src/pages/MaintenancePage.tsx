import React, { useCallback, useEffect, useState } from 'react';
import { ProtocolBadge, StatusPill } from '../components/StatusBadges';
import { useAuth } from '../contexts/AuthContext';
import { useTelemetry } from '../contexts/TelemetryContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch, downloadAuthenticatedFile, formatUtcTimestamp } from '../lib/api';

interface MaintenanceItem {
  id: string;
  code: string;
  title: string;
  description: string;
  expected_impact: string;
  start_time: string;
  end_time: string;
  status: 'UPCOMING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  suppress_alerts: boolean;
  notify_subscribers: boolean;
  created_by: string;
  monitors: Array<{ id: string; name: string; protocol: string }>;
  affected_monitor_ids: string[];
}

interface MaintenanceResponse {
  items: MaintenanceItem[];
  counts: { upcoming: number; active: number; completed: number; cancelled: number };
}

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function MaintenancePage() {
  const { isAdmin } = useAuth();
  const { showToast, confirmAction } = useToast();

  const [data, setData] = useState<MaintenanceResponse | null>(null);
  const [monitors, setMonitors] = useState<Array<{ id: string; name: string; protocol: string }>>([]);
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [expectedImpact, setExpectedImpact] = useState('Brief intermittent service degradation');
  const [startLocal, setStartLocal] = useState('');
  const [endLocal, setEndLocal] = useState('');
  const [suppressAlerts, setSuppressAlerts] = useState(true);
  const [notifySubscribers, setNotifySubscribers] = useState(true);
  const [selectedMonitorIds, setSelectedMonitorIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiFetch<MaintenanceResponse>('/maintenance');
      setData(res);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load maintenance windows', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadData(false);
    apiFetch<{ items: Array<{ id: string; name: string; protocol: string }> }>('/monitors?limit=100')
      .then((res) => setMonitors(res.items))
      .catch(() => undefined);
  }, [loadData]);

  useTelemetry((msg) => {
    if (msg.event === 'MAINTENANCE_UPDATED') void loadData(true);
  });

  const openCreateModal = () => {
    const start = new Date(Date.now() + 2 * 3600_000);
    const end = new Date(Date.now() + 3 * 3600_000);
    setEditingId(null);
    setTitle('');
    setDescription('');
    setExpectedImpact('Brief intermittent service degradation');
    setStartLocal(toDatetimeLocalValue(start.toISOString()));
    setEndLocal(toDatetimeLocalValue(end.toISOString()));
    setSuppressAlerts(true);
    setNotifySubscribers(true);
    setSelectedMonitorIds(monitors.slice(0, 2).map((m) => m.id));
    setModalOpen(true);
  };

  const openEditModal = (mw: MaintenanceItem) => {
    setEditingId(mw.id);
    setTitle(mw.title);
    setDescription(mw.description);
    setExpectedImpact(mw.expected_impact);
    setStartLocal(toDatetimeLocalValue(mw.start_time));
    setEndLocal(toDatetimeLocalValue(mw.end_time));
    setSuppressAlerts(mw.suppress_alerts);
    setNotifySubscribers(mw.notify_subscribers);
    setSelectedMonitorIds(mw.affected_monitor_ids);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        expected_impact: expectedImpact.trim(),
        start_time: new Date(startLocal).toISOString(),
        end_time: new Date(endLocal).toISOString(),
        suppress_alerts: suppressAlerts,
        notify_subscribers: notifySubscribers,
        affected_monitor_ids: selectedMonitorIds,
      };
      if (editingId) {
        await apiFetch(`/maintenance/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
        showToast('Maintenance window updated.', 'success');
      } else {
        await apiFetch('/maintenance', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Maintenance window scheduled.', 'success');
      }
      setModalOpen(false);
      await loadData(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save maintenance window', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (id: string, action: 'start' | 'cancel' | 'delete', label: string) => {
    if (action === 'delete' || action === 'cancel') {
      const ok = await confirmAction({
        title: `${action === 'delete' ? 'Delete' : 'Cancel'} "${label}"?`,
        message:
          action === 'delete'
            ? 'This permanently removes the maintenance window record.'
            : 'Alert suppression for this window will end immediately.',
        confirmLabel: action === 'delete' ? 'Delete' : 'Cancel Window',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      if (action === 'delete') {
        await apiFetch(`/maintenance/${id}`, { method: 'DELETE' });
      } else {
        await apiFetch(`/maintenance/${id}/${action}`, { method: 'POST' });
      }
      showToast(`Maintenance window ${action === 'start' ? 'activated' : action === 'cancel' ? 'cancelled' : 'deleted'}.`, 'success');
      await loadData(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Action failed', 'error');
    }
  };

  // Build simple current-month calendar days
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const calendarCells = Array.from({ length: firstWeekday + daysInMonth }, (_, idx) => {
    if (idx < firstWeekday) return null;
    const dayNum = idx - firstWeekday + 1;
    const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const matching = (data?.items || []).filter(
      (mw) => mw.start_time.slice(0, 10) <= dayStr && mw.end_time.slice(0, 10) >= dayStr && mw.status !== 'CANCELLED',
    );
    return { dayNum, dayStr, matching };
  });

  const activeOrUpcoming = (data?.items || []).filter((m) => m.status === 'UPCOMING' || m.status === 'ACTIVE');
  const historical = (data?.items || []).filter((m) => m.status === 'COMPLETED' || m.status === 'CANCELLED');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-wider text-[#adc6ff]">
            ALERT SUPPRESSION WITHOUT TELEMETRY LOSS
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#d3e4fe] mt-1">Scheduled Maintenance</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex bg-[#0b1c30] border border-[#1b2b3f] rounded-lg p-1">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`px-3 py-1 rounded text-xs font-medium ${
                viewMode === 'list' ? 'bg-[#4d8eff] text-[#00285d] font-semibold' : 'text-[#c2c6d6]'
              }`}
            >
              List View
            </button>
            <button
              type="button"
              onClick={() => setViewMode('calendar')}
              className={`px-3 py-1 rounded text-xs font-medium ${
                viewMode === 'calendar' ? 'bg-[#4d8eff] text-[#00285d] font-semibold' : 'text-[#c2c6d6]'
              }`}
            >
              Calendar
            </button>
          </div>
          <button
            type="button"
            onClick={() =>
              void downloadAuthenticatedFile('/maintenance/export.csv', 'vigilnode-maintenance-audit.csv').catch((e) =>
                showToast(e.message, 'error'),
              )
            }
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] border border-[#26364a] text-xs text-[#d3e4fe]"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            <span>Export CSV</span>
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#4d8eff] hover:bg-[#adc6ff] text-[#00285d] text-xs font-semibold"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              <span>Schedule Window</span>
            </button>
          )}
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4">
          <div className="font-mono text-[10px] uppercase text-[#8c909f]">Upcoming</div>
          <div className="text-2xl font-semibold text-amber-300 tabular-nums mt-1">{data?.counts.upcoming ?? 0}</div>
        </div>
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4">
          <div className="font-mono text-[10px] uppercase text-[#8c909f]">In Progress (Active)</div>
          <div className="text-2xl font-semibold text-[#adc6ff] tabular-nums mt-1">{data?.counts.active ?? 0}</div>
        </div>
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4">
          <div className="font-mono text-[10px] uppercase text-[#8c909f]">Completed</div>
          <div className="text-2xl font-semibold text-[#4edea3] tabular-nums mt-1">{data?.counts.completed ?? 0}</div>
        </div>
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4">
          <div className="font-mono text-[10px] uppercase text-[#8c909f]">Telemetry Behavior</div>
          <div className="text-xs font-mono text-[#c2c6d6] mt-2">Probes continue • Alerts muted</div>
        </div>
      </div>

      {viewMode === 'calendar' ? (
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#d3e4fe]">
              {now.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })} (UTC)
            </h2>
            <span className="font-mono text-[11px] text-[#8c909f]">Scheduled & Active Windows</span>
          </div>
          <div className="grid grid-cols-7 gap-2 text-center font-mono text-[10px] text-[#8c909f]">
            {['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {calendarCells.map((cell, idx) =>
              cell ? (
                <div
                  key={cell.dayStr}
                  className="min-h-[82px] p-2 rounded-lg bg-[#102034] border border-[#1b2b3f] flex flex-col gap-1"
                >
                  <span className="font-mono text-[11px] text-[#c2c6d6]">{cell.dayNum}</span>
                  {cell.matching.map((mw) => (
                    <div
                      key={mw.id}
                      className="px-1.5 py-0.5 rounded bg-[#4d8eff]/25 border border-[#adc6ff]/40 font-mono text-[9px] text-[#adc6ff] truncate"
                      title={mw.title}
                    >
                      {mw.code} {mw.title}
                    </div>
                  ))}
                </div>
              ) : (
                <div key={`empty-${idx}`} className="min-h-[82px] rounded-lg bg-[#000f21]/40" />
              ),
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active & Queued Windows */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-[#d3e4fe]">
              Active & Upcoming Windows ({activeOrUpcoming.length})
            </h2>
            {loading && !data ? (
              <div className="p-6 text-center font-mono text-xs text-[#8c909f]">Loading maintenance windows...</div>
            ) : activeOrUpcoming.length === 0 ? (
              <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-6 text-center text-xs text-[#8c909f]">
                No active or upcoming maintenance windows scheduled.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {activeOrUpcoming.map((mw) => (
                  <div key={mw.id} className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-5 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-[#adc6ff] font-semibold">{mw.code}</span>
                      <StatusPill status={mw.status} />
                    </div>
                    <h3 className="text-base font-semibold text-[#d3e4fe]">{mw.title}</h3>
                    <p className="text-xs text-[#c2c6d6]">{mw.description || 'No description provided.'}</p>
                    <div className="p-3 rounded-lg bg-[#102034] border border-[#1b2b3f] font-mono text-[11px] space-y-1">
                      <div className="text-[#4edea3]">Start: {formatUtcTimestamp(mw.start_time)}</div>
                      <div className="text-[#c2c6d6]">End: {formatUtcTimestamp(mw.end_time)}</div>
                      <div className="text-[#8c909f]">Impact: {mw.expected_impact}</div>
                      <div className="text-amber-300">
                        Alert Suppression: {mw.suppress_alerts ? 'Armed (Telemetry Preserved)' : 'Disabled'}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {mw.monitors.map((m) => (
                        <span
                          key={m.id}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#102034] border border-[#26364a] text-[11px] text-[#d3e4fe]"
                        >
                          <ProtocolBadge protocol={m.protocol} />
                          <span>{m.name}</span>
                        </span>
                      ))}
                    </div>
                    {isAdmin && (
                      <div className="flex flex-wrap gap-2 pt-2 border-t border-[#1b2b3f]">
                        {mw.status === 'UPCOMING' && (
                          <button
                            type="button"
                            onClick={() => void handleAction(mw.id, 'start', mw.title)}
                            className="px-3 py-1.5 rounded-lg bg-[#4edea3] text-[#003824] text-xs font-semibold"
                          >
                            Start Now
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openEditModal(mw)}
                          className="px-3 py-1.5 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] text-xs text-[#d3e4fe]"
                        >
                          Edit / Reschedule
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleAction(mw.id, 'cancel', mw.title)}
                          className="px-3 py-1.5 rounded-lg bg-[#93000a]/50 hover:bg-[#93000a] text-xs text-[#ffb4ab]"
                        >
                          Cancel Window
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Historical Maintenance */}
          <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#1b2b3f] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#d3e4fe]">Historical Maintenance Log ({historical.length})</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#102034]/60 border-b border-[#1b2b3f] font-mono text-[10px] uppercase text-[#8c909f]">
                    <th className="p-3">Code</th>
                    <th className="p-3">Title</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Window (UTC)</th>
                    <th className="p-3">Operator</th>
                    {isAdmin && <th className="p-3 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1b2b3f]/60">
                  {historical.map((mw) => (
                    <tr key={mw.id} className="hover:bg-[#102034]/50">
                      <td className="p-3 font-mono text-[#adc6ff]">{mw.code}</td>
                      <td className="p-3 font-medium text-[#d3e4fe]">{mw.title}</td>
                      <td className="p-3">
                        <StatusPill status={mw.status} />
                      </td>
                      <td className="p-3 font-mono text-[11px] text-[#c2c6d6]">
                        {formatUtcTimestamp(mw.start_time)} → {formatUtcTimestamp(mw.end_time)}
                      </td>
                      <td className="p-3 text-[#8c909f]">{mw.created_by}</td>
                      {isAdmin && (
                        <td className="p-3 text-right">
                          <button
                            type="button"
                            onClick={() => void handleAction(mw.id, 'delete', mw.title)}
                            className="px-2.5 py-1 rounded bg-[#102034] hover:bg-[#93000a]/60 text-[#ffb4ab] text-xs"
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0b1c30] border border-[#26364a] rounded-xl max-w-xl w-full p-5 max-h-[90vh] overflow-y-auto space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#d3e4fe]">
                {editingId ? 'Edit Maintenance Window' : 'Schedule Maintenance Window'}
              </h3>
              <button type="button" onClick={() => setModalOpen(false)} className="text-[#8c909f] hover:text-[#d3e4fe]">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-3.5">
              <div>
                <label className="block text-xs text-[#c2c6d6] mb-1">Window Title *</label>
                <input
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Primary DB Engine Minor Upgrade"
                  className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs text-[#d3e4fe]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#c2c6d6] mb-1">Description</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs text-[#d3e4fe]"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#c2c6d6] mb-1">Start Time *</label>
                  <input
                    type="datetime-local"
                    required
                    value={startLocal}
                    onChange={(e) => setStartLocal(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#c2c6d6] mb-1">End Time *</label>
                  <input
                    type="datetime-local"
                    required
                    value={endLocal}
                    onChange={(e) => setEndLocal(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-[#c2c6d6] mb-1">Expected Impact</label>
                <input
                  value={expectedImpact}
                  onChange={(e) => setExpectedImpact(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs text-[#d3e4fe]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#c2c6d6] mb-1.5">Affected Monitors</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 rounded-lg bg-[#000f21] border border-[#26364a]">
                  {monitors.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-xs text-[#d3e4fe] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedMonitorIds.includes(m.id)}
                        onChange={(e) =>
                          setSelectedMonitorIds((prev) =>
                            e.target.checked ? [...prev, m.id] : prev.filter((id) => id !== m.id),
                          )
                        }
                        className="accent-[#4edea3]"
                      />
                      <span className="truncate">{m.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-4 pt-1">
                <label className="flex items-center gap-2 text-xs text-[#c2c6d6] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={suppressAlerts}
                    onChange={(e) => setSuppressAlerts(e.target.checked)}
                    className="accent-[#4edea3]"
                  />
                  <span>Suppress outage alerts & auto-incidents during window</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-[#c2c6d6] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notifySubscribers}
                    onChange={(e) => setNotifySubscribers(e.target.checked)}
                    className="accent-[#4d8eff]"
                  />
                  <span>Display on Public Status Portal</span>
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-[#1b2b3f]">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-3.5 py-2 rounded-lg bg-[#102034] text-xs text-[#c2c6d6]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-[#4d8eff] text-[#00285d] text-xs font-semibold"
                >
                  {saving ? 'Saving...' : editingId ? 'Update Window' : 'Create Window'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
