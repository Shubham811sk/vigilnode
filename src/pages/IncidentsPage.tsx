import React, { useCallback, useEffect, useState } from 'react';
import { ProtocolBadge, SeverityBadge, StatusPill } from '../components/StatusBadges';
import { useAuth } from '../contexts/AuthContext';
import { useTelemetry } from '../contexts/TelemetryContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch, formatDuration, formatRelativeTime, formatUtcTimestamp } from '../lib/api';

type LifecycleStage = 'Investigating' | 'Identified' | 'Monitoring' | 'Resolved';

const STAGES: LifecycleStage[] = ['Investigating', 'Identified', 'Monitoring', 'Resolved'];
const NEXT_STAGE: Record<LifecycleStage, LifecycleStage | null> = {
  Investigating: 'Identified',
  Identified: 'Monitoring',
  Monitoring: 'Resolved',
  Resolved: null,
};

interface IncidentNote {
  id: number;
  phase: string;
  message: string;
  author_name: string;
  author_role: string;
  created_at: string;
}

interface IncidentItem {
  id: string;
  code: string;
  monitor_id: string | null;
  title: string;
  severity: string;
  status: LifecycleStage;
  summary: string;
  root_cause: string;
  assigned_to: string;
  sync_public_status: boolean;
  started_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  duration_sec: number;
  monitor: { id: string; name: string; protocol: string; target: string; status: string } | null;
  notes: IncidentNote[];
}

interface IncidentsResponse {
  items: IncidentItem[];
  counts: {
    total: number;
    active: number;
    investigating: number;
    identified: number;
    monitoring: number;
    resolved: number;
  };
  metrics: {
    mtta_sec: number;
    mttr_sec: number;
  };
}

export default function IncidentsPage() {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();

  const [data, setData] = useState<IncidentsResponse | null>(null);
  const [monitors, setMonitors] = useState<Array<{ id: string; name: string; protocol: string }>>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const [noteInput, setNoteInput] = useState('');
  const [rootCauseInput, setRootCauseInput] = useState('');
  const [triggerProbe, setTriggerProbe] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newSeverity, setNewSeverity] = useState('CRITICAL');
  const [newMonitorId, setNewMonitorId] = useState('');
  const [newSummary, setNewSummary] = useState('');
  const [newSyncPublic, setNewSyncPublic] = useState(true);

  const loadIncidents = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const qs = new URLSearchParams({ status: statusFilter, severity: severityFilter, search });
      const res = await apiFetch<IncidentsResponse>(`/incidents?${qs.toString()}`);
      setData(res);
      if (res.items.length > 0 && (!selectedId || !res.items.some((i) => i.id === selectedId))) {
        const firstActive = res.items.find((i) => i.status !== 'Resolved') || res.items[0];
        setSelectedId(firstActive.id);
        setRootCauseInput(firstActive.root_cause || '');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load incidents', 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, severityFilter, search, selectedId, showToast]);

  useEffect(() => {
    void loadIncidents(false);
  }, [loadIncidents]);

  useEffect(() => {
    apiFetch<{ items: Array<{ id: string; name: string; protocol: string }> }>('/monitors?limit=100')
      .then((res) => setMonitors(res.items))
      .catch(() => undefined);
  }, []);

  useTelemetry((msg) => {
    if (msg.event === 'INCIDENT_CREATED' || msg.event === 'INCIDENT_UPDATED') {
      void loadIncidents(true);
    }
  });

  const selected = data?.items.find((i) => i.id === selectedId) || null;

  const handleSelectIncident = (inc: IncidentItem) => {
    setSelectedId(inc.id);
    setRootCauseInput(inc.root_cause || '');
  };

  const handleAdvanceLifecycle = async () => {
    if (!selected) return;
    const nextStage = NEXT_STAGE[selected.status];
    if (!nextStage) return;

    setSubmitting(true);
    try {
      await apiFetch(`/incidents/${selected.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: nextStage,
          message: noteInput.trim() || `Transitioned incident lifecycle to ${nextStage}.`,
          root_cause: rootCauseInput.trim(),
          trigger_probe: triggerProbe,
        }),
      });
      setNoteInput('');
      showToast(`Incident ${selected.code} moved to ${nextStage}.`, 'success');
      await loadIncidents(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lifecycle transition rejected', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || !noteInput.trim()) return;
    setSubmitting(true);
    try {
      await apiFetch(`/incidents/${selected.id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ message: noteInput.trim() }),
      });
      setNoteInput('');
      showToast('Investigation note appended to timeline.', 'success');
      await loadIncidents(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to post note', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeclareIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const created = await apiFetch<IncidentItem>('/incidents', {
        method: 'POST',
        body: JSON.stringify({
          title: newTitle.trim(),
          severity: newSeverity,
          monitor_id: newMonitorId || null,
          summary: newSummary.trim(),
          sync_public_status: newSyncPublic,
        }),
      });
      setCreateOpen(false);
      setNewTitle('');
      setNewSummary('');
      setSelectedId(created.id);
      showToast(`Incident ${created.code} declared in Investigating state.`, 'success');
      await loadIncidents(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to declare incident', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-wider text-[#adc6ff]">
            STRICT LIFECYCLE: INVESTIGATING → IDENTIFIED → MONITORING → RESOLVED
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#d3e4fe] mt-1">Incident Management & Triage</h1>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#93000a] hover:bg-[#ff5451] text-white text-xs font-semibold transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">add_alert</span>
            <span>Declare Incident</span>
          </button>
        )}
      </div>

      {/* KPI Metrics Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4">
          <div className="font-mono text-[10px] uppercase text-[#8c909f]">Active Incidents</div>
          <div className="text-2xl font-semibold text-[#ffb4ab] tabular-nums mt-1">{data?.counts.active ?? 0}</div>
        </div>
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4">
          <div className="font-mono text-[10px] uppercase text-[#8c909f]">Resolved Incidents</div>
          <div className="text-2xl font-semibold text-[#4edea3] tabular-nums mt-1">{data?.counts.resolved ?? 0}</div>
        </div>
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4">
          <div className="font-mono text-[10px] uppercase text-[#8c909f]">MTTA (Mean Time to Ack)</div>
          <div className="text-2xl font-semibold text-[#adc6ff] tabular-nums mt-1">
            {formatDuration(data?.metrics.mtta_sec ?? 0)}
          </div>
        </div>
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4">
          <div className="font-mono text-[10px] uppercase text-[#8c909f]">MTTR (Mean Time to Resolve)</div>
          <div className="text-2xl font-semibold text-[#d3e4fe] tabular-nums mt-1">
            {formatDuration(data?.metrics.mttr_sec ?? 0)}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-3.5 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search incidents by code, title, or monitor..."
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs text-[#d3e4fe]"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter incident status"
          className="px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
        >
          <option value="ALL">All Lifecycle States ({data?.counts.total ?? 0})</option>
          <option value="ACTIVE">Active Only ({data?.counts.active ?? 0})</option>
          <option value="Investigating">Investigating</option>
          <option value="Identified">Identified</option>
          <option value="Monitoring">Monitoring</option>
          <option value="Resolved">Resolved</option>
        </select>
        <select
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
          aria-label="Filter incident severity"
          className="px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
        >
          <option value="ALL">All Severities</option>
          <option value="CRITICAL">CRITICAL</option>
          <option value="HIGH">HIGH</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="LOW">LOW</option>
        </select>
      </div>

      {/* Split Master-Detail Triage Console */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left List */}
        <div className="xl:col-span-5 space-y-2.5">
          {loading && !data ? (
            <div className="p-6 text-center font-mono text-xs text-[#8c909f]">Loading incidents...</div>
          ) : (data?.items || []).length === 0 ? (
            <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-8 text-center text-xs text-[#8c909f]">
              No incidents match your current filter.
            </div>
          ) : (
            data!.items.map((inc) => (
              <button
                key={inc.id}
                type="button"
                onClick={() => handleSelectIncident(inc)}
                className={`w-full text-left p-4 rounded-xl border transition-all ${
                  selected?.id === inc.id
                    ? 'bg-[#1b2b3f] border-[#adc6ff]/60'
                    : 'bg-[#0b1c30] border-[#1b2b3f] hover:bg-[#102034]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-[#adc6ff] font-semibold">{inc.code}</span>
                    <SeverityBadge severity={inc.severity} />
                  </div>
                  <StatusPill status={inc.status} />
                </div>
                <div className="text-sm font-semibold text-[#d3e4fe] mt-2">{inc.title}</div>
                <div className="flex flex-wrap items-center justify-between gap-2 mt-2 font-mono text-[11px] text-[#8c909f]">
                  <span>{inc.monitor ? `${inc.monitor.name} (${inc.monitor.protocol})` : 'System Incident'}</span>
                  <span>
                    Duration: {formatDuration(inc.duration_sec)} • {formatRelativeTime(inc.started_at)}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Right Detail & Triage */}
        <div className="xl:col-span-7">
          {selected ? (
            <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-5 space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3 pb-4 border-b border-[#1b2b3f]">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-[#adc6ff] font-bold">{selected.code}</span>
                    <SeverityBadge severity={selected.severity} />
                    <StatusPill status={selected.status} />
                  </div>
                  <h2 className="text-lg font-semibold text-[#d3e4fe] mt-1.5">{selected.title}</h2>
                  <p className="text-xs text-[#c2c6d6] mt-1">{selected.summary || 'No summary provided.'}</p>
                </div>
                <div className="text-right font-mono text-[11px] text-[#8c909f]">
                  <div>Started: {formatUtcTimestamp(selected.started_at)}</div>
                  <div>Duration: {formatDuration(selected.duration_sec)}</div>
                  {selected.monitor && (
                    <div className="mt-1 inline-flex items-center gap-1.5 text-[#adc6ff]">
                      <ProtocolBadge protocol={selected.monitor.protocol} />
                      <span>{selected.monitor.name}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Strict 4-Stage Progress Stepper */}
              <div>
                <div className="font-mono text-[10px] uppercase text-[#8c909f] mb-2">
                  Incident Lifecycle Progress (Sequential Order Enforced)
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {STAGES.map((stage, idx) => {
                    const currentIdx = STAGES.indexOf(selected.status);
                    const done = idx <= currentIdx;
                    const active = idx === currentIdx;
                    return (
                      <div
                        key={stage}
                        className={`p-2.5 rounded-lg border font-mono text-[11px] text-center ${
                          active
                            ? 'bg-[#4d8eff]/20 border-[#adc6ff] text-[#adc6ff] font-semibold'
                            : done
                              ? 'bg-[#00a572]/15 border-[#4edea3]/40 text-[#4edea3]'
                              : 'bg-[#102034] border-[#1b2b3f] text-[#8c909f]'
                        }`}
                      >
                        {idx + 1}. {stage}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Admin Triage Controls */}
              {isAdmin && (
                <form onSubmit={handleAddNote} className="p-4 rounded-xl bg-[#102034] border border-[#1b2b3f] space-y-3">
                  <div className="text-xs font-semibold text-[#d3e4fe]">Post Investigation Update / Advance State</div>
                  <textarea
                    rows={2}
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                    placeholder="Document root cause findings, mitigation steps, or operator verification..."
                    className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs text-[#d3e4fe]"
                  />
                  {selected.status !== 'Resolved' && (
                    <input
                      value={rootCauseInput}
                      onChange={(e) => setRootCauseInput(e.target.value)}
                      placeholder="Root Cause Summary (saved upon resolution)"
                      className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs text-[#d3e4fe]"
                    />
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {selected.monitor_id ? (
                      <label className="flex items-center gap-2 text-xs text-[#c2c6d6] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={triggerProbe}
                          onChange={(e) => setTriggerProbe(e.target.checked)}
                          className="accent-[#4edea3]"
                        />
                        <span>Trigger fresh synthetic probe on advance</span>
                      </label>
                    ) : (
                      <span />
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="submit"
                        disabled={submitting || !noteInput.trim()}
                        className="px-3.5 py-2 rounded-lg bg-[#1b2b3f] hover:bg-[#26364a] disabled:opacity-40 text-xs font-medium text-[#d3e4fe]"
                      >
                        Add Timeline Note
                      </button>

                      {NEXT_STAGE[selected.status] && (
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => void handleAdvanceLifecycle()}
                          className="px-4 py-2 rounded-lg bg-[#4edea3] hover:bg-[#4edea3]/90 disabled:opacity-50 text-[#003824] text-xs font-semibold"
                        >
                          Advance to {NEXT_STAGE[selected.status]} →
                        </button>
                      )}
                    </div>
                  </div>
                </form>
              )}

              {selected.root_cause && (
                <div className="p-3 rounded-lg bg-[#102034] border border-[#26364a] text-xs">
                  <span className="font-mono text-[10px] uppercase text-[#4edea3]">Root Cause: </span>
                  <span className="text-[#d3e4fe]">{selected.root_cause}</span>
                </div>
              )}

              {/* Chronological Timeline */}
              <div>
                <h3 className="text-xs font-semibold text-[#c2c6d6] uppercase tracking-wider mb-3">
                  Incident Timeline ({selected.notes.length} entries)
                </h3>
                <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                  {selected.notes.map((n) => (
                    <div key={n.id} className="p-3 rounded-lg bg-[#102034] border border-[#1b2b3f] text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <StatusPill status={n.phase} />
                          <span className="font-medium text-[#d3e4fe]">{n.author_name}</span>
                        </div>
                        <span className="font-mono text-[10px] text-[#8c909f]">{formatUtcTimestamp(n.created_at)}</span>
                      </div>
                      <p className="text-[#c2c6d6] mt-1.5 leading-relaxed">{n.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-10 text-center text-xs text-[#8c909f]">
              Select an incident from the list to inspect its timeline and triage controls.
            </div>
          )}
        </div>
      </div>

      {/* Declare Incident Modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0b1c30] border border-[#26364a] rounded-xl max-w-lg w-full p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#d3e4fe]">Declare New Incident</h3>
              <button type="button" onClick={() => setCreateOpen(false)} className="text-[#8c909f] hover:text-[#d3e4fe]">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleDeclareIncident} className="space-y-3.5">
              <div>
                <label className="block text-xs text-[#c2c6d6] mb-1">Incident Title *</label>
                <input
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g., Elevated 502 errors on API Gateway"
                  className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs text-[#d3e4fe]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#c2c6d6] mb-1">Severity</label>
                  <select
                    value={newSeverity}
                    onChange={(e) => setNewSeverity(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
                  >
                    <option value="CRITICAL">CRITICAL</option>
                    <option value="HIGH">HIGH</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="LOW">LOW</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#c2c6d6] mb-1">Affected Monitor</label>
                  <select
                    value={newMonitorId}
                    onChange={(e) => setNewMonitorId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs text-[#d3e4fe]"
                  >
                    <option value="">General / Platform-Wide</option>
                    {monitors.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.protocol})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-[#c2c6d6] mb-1">Initial Investigation Summary</label>
                <textarea
                  rows={3}
                  value={newSummary}
                  onChange={(e) => setNewSummary(e.target.value)}
                  placeholder="Describe symptoms and initial observations..."
                  className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs text-[#d3e4fe]"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-[#c2c6d6] cursor-pointer">
                <input
                  type="checkbox"
                  checked={newSyncPublic}
                  onChange={(e) => setNewSyncPublic(e.target.checked)}
                  className="accent-[#4d8eff]"
                />
                <span>Publish on Public Status Portal (/status)</span>
              </label>
              <div className="flex justify-end gap-2 pt-2 border-t border-[#1b2b3f]">
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="px-3.5 py-2 rounded-lg bg-[#102034] text-xs text-[#c2c6d6]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-lg bg-[#93000a] hover:bg-[#ff5451] text-white text-xs font-semibold"
                >
                  Declare Incident
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
