import React, { useCallback, useEffect, useState } from 'react';
import { SeverityBadge, StatusPill } from '../components/StatusBadges';
import { useAuth } from '../contexts/AuthContext';
import { useTelemetry } from '../contexts/TelemetryContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch, formatUtcTimestamp } from '../lib/api';

interface ChannelItem {
  id: string;
  channel_type: 'EMAIL_SMTP' | 'TELEGRAM' | 'DISCORD' | 'SLACK';
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  last_test_at: string | null;
  last_test_status: string | null;
  last_test_message: string | null;
}

interface AlertRule {
  id: string;
  name: string;
  severity: string;
  trigger_type: string;
  trigger_description: string;
  retry_threshold: number;
  cooldown_minutes: number;
  channels: string[];
  enabled: boolean;
}

interface NotificationLog {
  id: string;
  channel_type: string;
  event_type: string;
  recipient_preview: string;
  payload_preview: string;
  status: string;
  http_status: number | null;
  error_message: string;
  created_at: string;
}

interface IntegrationsResponse {
  channels: ChannelItem[];
  rules: AlertRule[];
  logs: NotificationLog[];
}

export default function AlertsIntegrationsPage() {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();

  const [data, setData] = useState<IntegrationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [logFilter, setLogFilter] = useState('ALL');
  const [testingId, setTestingId] = useState<string | null>(null);

  // Channel Config Modal
  const [editingCh, setEditingCh] = useState<ChannelItem | null>(null);
  const [cfgDraft, setCfgDraft] = useState<Record<string, string>>({});
  const [savingCh, setSavingCh] = useState(false);

  // Sandbox Dry-Run Simulator
  const [simChannelId, setSimChannelId] = useState('ch-slack');
  const [simTitle, setSimTitle] = useState('[DRY-RUN] Primary API Gateway Latency Spike');
  const [simMessage, setSimMessage] = useState('Simulated sandbox dispatch verifying routing format without hitting external providers.');
  const [simulating, setSimulating] = useState(false);

  // Add Rule Modal
  const [ruleOpen, setRuleOpen] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [ruleSeverity, setRuleSeverity] = useState('HIGH');
  const [ruleDesc, setRuleDesc] = useState('');
  const [ruleRetries, setRuleRetries] = useState(2);
  const [ruleChannels, setRuleChannels] = useState<string[]>(['EMAIL_SMTP', 'SLACK']);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiFetch<IntegrationsResponse>('/integrations');
      setData(res);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load integrations', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  useTelemetry((msg) => {
    if (msg.event === 'NOTIFICATION_DISPATCHED') void loadData(true);
  });

  const openConfigModal = (ch: ChannelItem) => {
    setEditingCh(ch);
    const strDraft: Record<string, string> = {};
    for (const [k, v] of Object.entries(ch.config)) {
      strDraft[k] = v === null || v === undefined ? '' : String(v);
    }
    setCfgDraft(strDraft);
  };

  const handleSaveChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCh) return;
    setSavingCh(true);
    try {
      const payloadCfg: Record<string, unknown> = { ...cfgDraft };
      if (editingCh.channel_type === 'EMAIL_SMTP' && cfgDraft.smtp_port) {
        payloadCfg.smtp_port = Number(cfgDraft.smtp_port);
      }
      await apiFetch(`/integrations/channels/${editingCh.id}`, {
        method: 'PUT',
        body: JSON.stringify({ config: payloadCfg }),
      });
      showToast(`${editingCh.name} configuration saved.`, 'success');
      setEditingCh(null);
      await loadData(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save configuration', 'error');
    } finally {
      setSavingCh(false);
    }
  };

  const handleToggleChannel = async (ch: ChannelItem) => {
    try {
      await apiFetch(`/integrations/channels/${ch.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !ch.enabled }),
      });
      showToast(`${ch.name} ${!ch.enabled ? 'enabled' : 'disabled'}.`, 'success');
      await loadData(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to toggle channel', 'error');
    }
  };

  const handleRealTest = async (ch: ChannelItem) => {
    setTestingId(ch.id);
    try {
      const res = await apiFetch<{ message: string }>(`/integrations/channels/${ch.id}/test`, {
        method: 'POST',
        body: JSON.stringify({ dry_run: false }),
      });
      showToast(res.message, 'success');
      await loadData(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Provider delivery failed', 'error');
      await loadData(true);
    } finally {
      setTestingId(null);
    }
  };

  const handleDryRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setSimulating(true);
    try {
      const res = await apiFetch<{ message: string }>(`/integrations/channels/${simChannelId}/test`, {
        method: 'POST',
        body: JSON.stringify({ dry_run: true, title: simTitle, message: simMessage }),
      });
      showToast(res.message, 'info');
      await loadData(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Simulation failed', 'error');
    } finally {
      setSimulating(false);
    }
  };

  const handleToggleRule = async (rule: AlertRule) => {
    try {
      await apiFetch(`/integrations/rules/${rule.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      showToast(`Rule "${rule.name}" ${!rule.enabled ? 'enabled' : 'paused'}.`, 'success');
      await loadData(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update rule', 'error');
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/integrations/rules', {
        method: 'POST',
        body: JSON.stringify({
          name: ruleName.trim(),
          severity: ruleSeverity,
          trigger_description: ruleDesc.trim() || 'Custom monitor failure routing rule',
          retry_threshold: ruleRetries,
          channels: ruleChannels,
        }),
      });
      setRuleOpen(false);
      setRuleName('');
      setRuleDesc('');
      showToast('Alert routing rule created.', 'success');
      await loadData(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create rule', 'error');
    }
  };

  const handleRetryLog = async (logId: string) => {
    try {
      const res = await apiFetch<{ status: string; error_message?: string }>(`/integrations/logs/${logId}/retry`, {
        method: 'POST',
      });
      showToast(
        res.status === 'SENT' ? 'Notification retry succeeded.' : `Retry failed: ${res.error_message}`,
        res.status === 'SENT' ? 'success' : 'error',
      );
      await loadData(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Retry failed', 'error');
    }
  };

  const filteredLogs = (data?.logs || []).filter((l) => logFilter === 'ALL' || l.channel_type === logFilter);

  const channelMeta: Record<string, { icon: string; subtitle: string }> = {
    EMAIL_SMTP: { icon: 'mail', subtitle: 'Gmail SMTP • smtp.gmail.com:587 STARTTLS' },
    TELEGRAM: { icon: 'send', subtitle: 'Telegram Bot API • api.telegram.org' },
    DISCORD: { icon: 'forum', subtitle: 'Discord Incoming Webhook' },
    SLACK: { icon: 'tag', subtitle: 'Slack Incoming Webhook' },
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-wider text-[#adc6ff]">
            REAL EXTERNAL NOTIFICATION DISPATCH PIPELINE
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#d3e4fe] mt-1">Alerts & Integrations</h1>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setRuleOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#4d8eff] hover:bg-[#adc6ff] text-[#00285d] text-xs font-semibold"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            <span>Add Alert Rule</span>
          </button>
        )}
      </div>

      {/* 4 Notification Channels Grid */}
      {loading && !data ? (
        <div className="p-8 text-center font-mono text-xs text-[#8c909f]">Loading integration channels...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(data?.channels || []).map((ch) => {
            const meta = channelMeta[ch.channel_type] || { icon: 'notifications', subtitle: ch.channel_type };
            return (
              <div key={ch.id} className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#102034] border border-[#26364a] flex items-center justify-center text-[#adc6ff]">
                      <span className="material-symbols-outlined">{meta.icon}</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-semibold text-[#d3e4fe]">{ch.name}</h2>
                        <span
                          className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${
                            ch.enabled ? 'bg-[#00a572]/20 text-[#4edea3]' : 'bg-[#1b2b3f] text-[#8c909f]'
                          }`}
                        >
                          {ch.enabled ? 'ACTIVE' : 'DISABLED'}
                        </span>
                      </div>
                      <div className="font-mono text-[11px] text-[#8c909f]">{meta.subtitle}</div>
                    </div>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => void handleToggleChannel(ch)}
                      className={`px-2.5 py-1 rounded-lg font-mono text-[11px] border ${
                        ch.enabled
                          ? 'bg-[#00a572]/15 border-[#4edea3]/40 text-[#4edea3]'
                          : 'bg-[#102034] border-[#26364a] text-[#8c909f]'
                      }`}
                    >
                      {ch.enabled ? 'Enabled' : 'Enable'}
                    </button>
                  )}
                </div>

                <div className="p-3 rounded-lg bg-[#102034] border border-[#1b2b3f] font-mono text-[11px] space-y-1">
                  {Object.entries(ch.config).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-2">
                      <span className="text-[#8c909f]">{k}:</span>
                      <span className="text-[#d3e4fe] truncate max-w-[230px]">{String(v || 'Not configured')}</span>
                    </div>
                  ))}
                </div>

                {ch.last_test_status && (
                  <div
                    className={`p-2.5 rounded-lg font-mono text-[11px] border ${
                      ch.last_test_status === 'SENT'
                        ? 'bg-[#00a572]/15 border-[#4edea3]/30 text-[#4edea3]'
                        : ch.last_test_status === 'DRY_RUN'
                          ? 'bg-[#4d8eff]/15 border-[#adc6ff]/30 text-[#adc6ff]'
                          : 'bg-[#93000a]/30 border-[#ff5451]/40 text-[#ffb4ab]'
                    }`}
                  >
                    Last Dispatch ({ch.last_test_status}): {ch.last_test_message}
                  </div>
                )}

                {isAdmin && (
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={testingId === ch.id}
                      onClick={() => void handleRealTest(ch)}
                      className="flex-1 py-2 px-3 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] border border-[#26364a] text-xs font-medium text-[#4edea3] disabled:opacity-40"
                    >
                      {testingId === ch.id ? 'Dispatching...' : 'Send Real Test'}
                    </button>
                    <button
                      type="button"
                      onClick={() => openConfigModal(ch)}
                      className="py-2 px-3.5 rounded-lg bg-[#1b2b3f] hover:bg-[#26364a] text-xs font-medium text-[#d3e4fe]"
                    >
                      Configure
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Alert Rules + Sandbox Simulator */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#d3e4fe]">Alert Routing Rules ({data?.rules.length ?? 0})</h2>
            <span className="font-mono text-[10px] text-[#8c909f]">AUTO-EVALUATED BY SCHEDULER</span>
          </div>
          <div className="space-y-2.5">
            {(data?.rules || []).map((r) => (
              <div key={r.id} className="p-3.5 rounded-xl bg-[#102034] border border-[#1b2b3f] flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={r.severity} />
                    <span className="text-xs font-semibold text-[#d3e4fe]">{r.name}</span>
                  </div>
                  <p className="text-xs text-[#8c909f]">{r.trigger_description}</p>
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 font-mono text-[10px]">
                    <span className="text-[#c2c6d6]">Retries: {r.retry_threshold}</span>
                    <span>•</span>
                    <span className="text-[#c2c6d6]">Cooldown: {r.cooldown_minutes}m</span>
                    <span>•</span>
                    {r.channels.map((c) => (
                      <span key={c} className="px-1.5 py-0.5 rounded bg-[#1b2b3f] text-[#adc6ff]">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => void handleToggleRule(r)}
                    className={`px-2.5 py-1 rounded font-mono text-[11px] border shrink-0 ${
                      r.enabled
                        ? 'bg-[#00a572]/15 border-[#4edea3]/40 text-[#4edea3]'
                        : 'bg-[#0b1c30] border-[#26364a] text-[#8c909f]'
                    }`}
                  >
                    {r.enabled ? 'ON' : 'OFF'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Dry-Run Sandbox Simulator */}
        <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-5 space-y-4">
          <div>
            <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[#4d8eff]/20 text-[#adc6ff]">
              ISOLATED DRY-RUN SANDBOX
            </span>
            <h2 className="text-sm font-semibold text-[#d3e4fe] mt-2">Payload & Routing Simulator</h2>
            <p className="text-xs text-[#8c909f] mt-0.5">
              Logs a dry-run dispatch record without calling external endpoints or altering monitor statuses.
            </p>
          </div>
          <form onSubmit={handleDryRun} className="space-y-3">
            <div>
              <label className="block text-xs text-[#c2c6d6] mb-1">Target Channel</label>
              <select
                value={simChannelId}
                onChange={(e) => setSimChannelId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
              >
                {(data?.channels || []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#c2c6d6] mb-1">Alert Title</label>
              <input
                value={simTitle}
                onChange={(e) => setSimTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs text-[#d3e4fe]"
              />
            </div>
            <div>
              <label className="block text-xs text-[#c2c6d6] mb-1">Simulated Payload</label>
              <textarea
                rows={3}
                value={simMessage}
                onChange={(e) => setSimMessage(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
              />
            </div>
            <button
              type="submit"
              disabled={!isAdmin || simulating}
              className="w-full py-2 rounded-lg bg-[#4d8eff] hover:bg-[#adc6ff] disabled:opacity-40 text-[#00285d] text-xs font-semibold"
            >
              {simulating ? 'Simulating...' : 'Run Dry-Run Simulation'}
            </button>
          </form>
        </div>
      </div>

      {/* Delivery Logs Table */}
      <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#1b2b3f] flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#d3e4fe]">Notification Delivery Logs</h2>
          <div className="flex flex-wrap gap-1.5">
            {['ALL', 'EMAIL_SMTP', 'TELEGRAM', 'DISCORD', 'SLACK'].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setLogFilter(f)}
                className={`px-2.5 py-1 rounded font-mono text-[10px] ${
                  logFilter === f ? 'bg-[#4d8eff] text-[#00285d] font-semibold' : 'bg-[#102034] text-[#c2c6d6]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-[#102034]/60 border-b border-[#1b2b3f] font-mono text-[10px] uppercase text-[#8c909f]">
                <th className="p-3">Time (UTC)</th>
                <th className="p-3">Channel</th>
                <th className="p-3">Event</th>
                <th className="p-3">Status</th>
                <th className="p-3">Payload / Error</th>
                {isAdmin && <th className="p-3 text-right">Retry</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1b2b3f]/60">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center font-mono text-[#8c909f]">
                    No notification delivery logs recorded yet.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((l) => (
                  <tr key={l.id} className="hover:bg-[#102034]/50">
                    <td className="p-3 font-mono text-[11px] text-[#8c909f] whitespace-nowrap">
                      {formatUtcTimestamp(l.created_at)}
                    </td>
                    <td className="p-3 font-mono text-[#adc6ff]">{l.channel_type}</td>
                    <td className="p-3 font-mono text-[#d3e4fe]">{l.event_type}</td>
                    <td className="p-3">
                      <StatusPill status={l.status} />
                    </td>
                    <td className="p-3 font-mono text-[11px] max-w-md truncate">
                      {l.error_message ? (
                        <span className="text-[#ffb4ab]">{l.error_message}</span>
                      ) : (
                        <span className="text-[#c2c6d6]">{l.payload_preview}</span>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="p-3 text-right">
                        {l.status === 'FAILED' && (
                          <button
                            type="button"
                            onClick={() => void handleRetryLog(l.id)}
                            className="px-2.5 py-1 rounded bg-[#102034] hover:bg-[#1b2b3f] text-xs text-[#4edea3]"
                          >
                            Retry
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Configure Channel Modal */}
      {editingCh && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0b1c30] border border-[#26364a] rounded-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#d3e4fe]">Configure {editingCh.name}</h3>
              <button type="button" onClick={() => setEditingCh(null)} className="text-[#8c909f] hover:text-[#d3e4fe]">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleSaveChannel} className="space-y-3">
              {Object.entries(cfgDraft).map(([k, val]) => {
                const isSecret = /pass|token|secret|webhook/i.test(k);
                return (
                  <div key={k}>
                    <label className="block font-mono text-[11px] text-[#c2c6d6] mb-1">{k}</label>
                    <input
                      type={isSecret ? 'password' : 'text'}
                      value={val}
                      onChange={(e) => setCfgDraft({ ...cfgDraft, [k]: e.target.value })}
                      placeholder={isSecret ? 'Enter new secret (leave masked to keep existing)' : ''}
                      className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
                    />
                  </div>
                );
              })}
              <div className="flex justify-end gap-2 pt-2 border-t border-[#1b2b3f]">
                <button
                  type="button"
                  onClick={() => setEditingCh(null)}
                  className="px-3.5 py-2 rounded-lg bg-[#102034] text-xs text-[#c2c6d6]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCh}
                  className="px-4 py-2 rounded-lg bg-[#4d8eff] text-[#00285d] text-xs font-semibold"
                >
                  {savingCh ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Alert Rule Modal */}
      {ruleOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0b1c30] border border-[#26364a] rounded-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#d3e4fe]">Create Alert Routing Rule</h3>
              <button type="button" onClick={() => setRuleOpen(false)} className="text-[#8c909f] hover:text-[#d3e4fe]">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleCreateRule} className="space-y-3">
              <div>
                <label className="block text-xs text-[#c2c6d6] mb-1">Rule Name *</label>
                <input
                  required
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="e.g., Production Latency SLA Breach"
                  className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs text-[#d3e4fe]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#c2c6d6] mb-1">Severity</label>
                  <select
                    value={ruleSeverity}
                    onChange={(e) => setRuleSeverity(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
                  >
                    <option value="CRITICAL">CRITICAL</option>
                    <option value="HIGH">HIGH</option>
                    <option value="MEDIUM">MEDIUM</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[#c2c6d6] mb-1">Retry Threshold</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={ruleRetries}
                    onChange={(e) => setRuleRetries(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-[#c2c6d6] mb-1">Trigger Description</label>
                <input
                  value={ruleDesc}
                  onChange={(e) => setRuleDesc(e.target.value)}
                  placeholder="Describe condition triggering this dispatch..."
                  className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs text-[#d3e4fe]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#c2c6d6] mb-1">Target Channels</label>
                <div className="grid grid-cols-2 gap-2">
                  {['EMAIL_SMTP', 'TELEGRAM', 'DISCORD', 'SLACK'].map((ch) => (
                    <label key={ch} className="flex items-center gap-2 text-xs font-mono text-[#d3e4fe]">
                      <input
                        type="checkbox"
                        checked={ruleChannels.includes(ch)}
                        onChange={(e) =>
                          setRuleChannels((prev) =>
                            e.target.checked ? [...prev, ch] : prev.filter((c) => c !== ch),
                          )
                        }
                        className="accent-[#4edea3]"
                      />
                      <span>{ch}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-[#1b2b3f]">
                <button
                  type="button"
                  onClick={() => setRuleOpen(false)}
                  className="px-3.5 py-2 rounded-lg bg-[#102034] text-xs text-[#c2c6d6]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-[#4d8eff] text-[#00285d] text-xs font-semibold"
                >
                  Save Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
