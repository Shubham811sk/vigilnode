import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HeartbeatBarStrip } from '../components/TelemetryCharts';
import { ProtocolBadge, SeverityBadge, StatusPill } from '../components/StatusBadges';
import { useAuth } from '../contexts/AuthContext';
import { useTelemetry } from '../contexts/TelemetryContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch, formatRelativeTime, formatUtcTimestamp } from '../lib/api';

interface PublicStatusPayload {
  portal: {
    title: string;
    subtitle: string;
    custom_domain: string;
    allow_subscriptions: boolean;
    sla_target_pct: number;
  };
  overall_status: 'OPERATIONAL' | 'DEGRADED' | 'OUTAGE';
  operational_count: number;
  degraded_count: number;
  outage_count: number;
  total_public_services: number;
  subscriber_count: number;
  services: Array<{
    id: string;
    name: string;
    protocol: string;
    public_endpoint: string;
    status: string;
    uptime_90d_pct: number;
    latency_ms: number | null;
    last_checked_at: string | null;
    ssl_days_remaining: number | null;
    daily_bars: Array<{ day: string; status: string; uptime_pct: number }>;
  }>;
  active_incidents: Array<{
    id: string;
    code: string;
    title: string;
    severity: string;
    status: string;
    summary: string;
    service_name: string | null;
    started_at: string;
    timeline: Array<{ phase: string; message: string; created_at: string }>;
  }>;
  resolved_incidents: Array<{
    id: string;
    code: string;
    title: string;
    severity: string;
    status: string;
    summary: string;
    service_name: string | null;
    started_at: string;
    resolved_at: string;
    timeline: Array<{ phase: string; message: string; created_at: string }>;
  }>;
  maintenance_windows: Array<{
    id: string;
    code: string;
    title: string;
    description: string;
    expected_impact: string;
    start_time: string;
    end_time: string;
    status: string;
  }>;
  generated_at: string;
}

export default function PublicStatusPage() {
  const { user, isAdmin } = useAuth();
  const { showToast } = useToast();

  const [data, setData] = useState<PublicStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);

  // Subscription
  const [subChannel, setSubChannel] = useState<'email' | 'slack' | 'discord' | 'telegram'>('email');
  const [subDest, setSubDest] = useState('');
  const [submittingSub, setSubmittingSub] = useState(false);
  const [unsubToken, setUnsubToken] = useState('');

  // Share menu
  const [shareOpen, setShareOpen] = useState(false);

  // Admin customizer
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [portalTitle, setPortalTitle] = useState('');
  const [portalSubtitle, setPortalSubtitle] = useState('');
  const [allowSubs, setAllowSubs] = useState(true);
  const [savingBrand, setSavingBrand] = useState(false);

  const loadStatus = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiFetch<PublicStatusPayload>('/public/status');
      setData(res);
      setPortalTitle(res.portal.title);
      setPortalSubtitle(res.portal.subtitle);
      setAllowSubs(res.portal.allow_subscriptions);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load public status portal', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadStatus(false);
  }, [loadStatus]);

  useTelemetry((msg) => {
    if (
      msg.event === 'PROBE_RESULT' ||
      msg.event === 'INCIDENT_CREATED' ||
      msg.event === 'INCIDENT_UPDATED' ||
      msg.event === 'MAINTENANCE_UPDATED'
    ) {
      void loadStatus(true);
    }
  });

  const currentUrl = typeof window !== 'undefined' ? window.location.href : 'https://status.vigilnode.local/status';

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      showToast('Public status URL copied to clipboard.', 'success');
    } catch {
      showToast(`Share URL: ${currentUrl}`, 'info');
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: data?.portal.title || 'VigilNode System Status',
          text: `Live Service Availability: ${data?.overall_status || 'OPERATIONAL'} (${data?.operational_count ?? 0}/${data?.total_public_services ?? 0} operational)`,
          url: currentUrl,
        });
        return;
      } catch {
        // user cancelled or unsupported in iframe -> fall back to copy
      }
    }
    await handleCopyUrl();
  };

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingSub(true);
    try {
      const res = await apiFetch<{ message: string; unsubscribe_token?: string }>('/public/subscribe', {
        method: 'POST',
        body: JSON.stringify({ channel: subChannel, destination: subDest.trim() }),
      });
      showToast(res.message, 'success');
      if (res.unsubscribe_token) setUnsubToken(res.unsubscribe_token);
      setSubDest('');
      await loadStatus(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Subscription failed', 'error');
    } finally {
      setSubmittingSub(false);
    }
  };

  const handleUnsubscribe = async () => {
    if (!unsubToken) return;
    try {
      const res = await apiFetch<{ message: string }>('/public/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ token: unsubToken }),
      });
      showToast(res.message, 'info');
      setUnsubToken('');
      await loadStatus(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unsubscribe failed', 'error');
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBrand(true);
    try {
      await apiFetch('/settings/public_status', {
        method: 'PUT',
        body: JSON.stringify({
          portal_title: portalTitle.trim(),
          portal_subtitle: portalSubtitle.trim(),
          allow_subscriptions: allowSubs,
        }),
      });
      showToast('Public status portal configuration saved.', 'success');
      setCustomizerOpen(false);
      await loadStatus(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update portal settings', 'error');
    } finally {
      setSavingBrand(false);
    }
  };

  const shareMessage = encodeURIComponent(
    `${data?.portal.title || 'VigilNode System Status'} — ${data?.overall_status || 'OPERATIONAL'} (${currentUrl})`,
  );
  const mailSubject = encodeURIComponent(`${data?.portal.title || 'VigilNode'} Live Status`);

  return (
    <div className="min-h-screen bg-[#031427] text-[#d3e4fe]">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[#000f21]/90 backdrop-blur-xl border-b border-[#1b2b3f]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#4d8eff]/20 border border-[#adc6ff]/30 flex items-center justify-center shrink-0">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" className="opacity-40" />
                <path d="M3 12h4l2.5-5 4 10 2.5-5H21" stroke="#4edea3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#d3e4fe] truncate">
                {data?.portal.title || 'VigilNode System Status'}
              </div>
              <div className="font-mono text-[10px] text-[#4edea3]">PUBLIC LIVE AVAILABILITY PORTAL</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Share Menu Trigger */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShareOpen((o) => !o)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] border border-[#26364a] text-xs font-medium text-[#adc6ff]"
              >
                <span className="material-symbols-outlined text-[16px]">share</span>
                <span>Share</span>
              </button>
              {shareOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-[#0b1c30] border border-[#26364a] rounded-xl shadow-2xl p-2 z-50 space-y-1">
                  <button
                    type="button"
                    onClick={() => {
                      void handleCopyUrl();
                      setShareOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-[#d3e4fe] hover:bg-[#102034]"
                  >
                    <span className="material-symbols-outlined text-[16px]">content_copy</span>
                    <span>Copy Status Link</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleNativeShare();
                      setShareOpen(false);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-[#d3e4fe] hover:bg-[#102034]"
                  >
                    <span className="material-symbols-outlined text-[16px]">ios_share</span>
                    <span>System Share</span>
                  </button>
                  <a
                    href={`https://wa.me/?text=${shareMessage}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-[#4edea3] hover:bg-[#102034]"
                  >
                    <span className="material-symbols-outlined text-[16px]">chat</span>
                    <span>Share via WhatsApp</span>
                  </a>
                  <a
                    href={`mailto:?subject=${mailSubject}&body=${shareMessage}`}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-[#adc6ff] hover:bg-[#102034]"
                  >
                    <span className="material-symbols-outlined text-[16px]">mail</span>
                    <span>Share via Email</span>
                  </a>
                </div>
              )}
            </div>

            {isAdmin && (
              <button
                type="button"
                onClick={() => setCustomizerOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] border border-[#26364a] text-xs text-[#d3e4fe]"
              >
                <span className="material-symbols-outlined text-[16px]">tune</span>
                <span className="hidden sm:inline">Customize</span>
              </button>
            )}

            <Link
              to={user ? '/' : '/login'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4d8eff] hover:bg-[#adc6ff] text-[#00285d] text-xs font-semibold"
            >
              <span className="material-symbols-outlined text-[16px]">
                {user ? 'dashboard' : 'login'}
              </span>
              <span>{user ? 'Admin Console' : 'Operator Sign In'}</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {loading && !data ? (
          <div className="p-10 text-center font-mono text-xs text-[#8c909f]">Loading public availability telemetry...</div>
        ) : (
          <>
            {/* Overall Health Hero Banner */}
            <section
              className={`rounded-2xl border p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                data?.overall_status === 'OPERATIONAL'
                  ? 'bg-[#00a572]/15 border-[#4edea3]/40'
                  : data?.overall_status === 'DEGRADED'
                    ? 'bg-amber-500/15 border-amber-400/40'
                    : 'bg-[#93000a]/35 border-[#ff5451]/60'
              }`}
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`w-3 h-3 rounded-full ${
                      data?.overall_status === 'OPERATIONAL'
                        ? 'bg-[#4edea3] animate-pulse'
                        : data?.overall_status === 'DEGRADED'
                          ? 'bg-amber-400'
                          : 'bg-[#ff5451] animate-ping'
                    }`}
                  />
                  <h1 className="text-xl sm:text-2xl font-semibold text-[#d3e4fe]">
                    {data?.overall_status === 'OPERATIONAL'
                      ? 'All Systems Operational'
                      : data?.overall_status === 'DEGRADED'
                        ? 'Partial Service Degradation'
                        : 'Active Service Disruption Detected'}
                  </h1>
                </div>
                <p className="text-xs text-[#c2c6d6] max-w-2xl">{data?.portal.subtitle}</p>
                <div className="font-mono text-[11px] text-[#8c909f]">
                  Updated: {formatUtcTimestamp(data?.generated_at)} • SLA Target: {data?.portal.sla_target_pct}%
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 shrink-0 text-center font-mono">
                <div className="px-4 py-2.5 rounded-xl bg-[#000f21]/70 border border-[#1b2b3f]">
                  <div className="text-xl font-bold text-[#4edea3] tabular-nums">{data?.operational_count ?? 0}</div>
                  <div className="text-[10px] text-[#8c909f]">OPERATIONAL</div>
                </div>
                <div className="px-4 py-2.5 rounded-xl bg-[#000f21]/70 border border-[#1b2b3f]">
                  <div className="text-xl font-bold text-amber-300 tabular-nums">{data?.degraded_count ?? 0}</div>
                  <div className="text-[10px] text-[#8c909f]">DEGRADED</div>
                </div>
                <div className="px-4 py-2.5 rounded-xl bg-[#000f21]/70 border border-[#1b2b3f]">
                  <div className="text-xl font-bold text-[#ffb4ab] tabular-nums">{data?.outage_count ?? 0}</div>
                  <div className="text-[10px] text-[#8c909f]">OUTAGE</div>
                </div>
              </div>
            </section>

            {/* Active Incidents */}
            {(data?.active_incidents.length ?? 0) > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-[#ffb4ab] uppercase tracking-wider font-mono">
                  Active Incidents ({data!.active_incidents.length})
                </h2>
                {data!.active_incidents.map((inc) => (
                  <div key={inc.id} className="bg-[#0b1c30] border border-[#ff5451]/50 rounded-xl p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-[#adc6ff]">{inc.code}</span>
                        <SeverityBadge severity={inc.severity} />
                        <StatusPill status={inc.status} />
                      </div>
                      <span className="font-mono text-[11px] text-[#8c909f]">
                        Started {formatRelativeTime(inc.started_at)}
                      </span>
                    </div>
                    <h3 className="text-base font-semibold text-[#d3e4fe]">{inc.title}</h3>
                    <p className="text-xs text-[#c2c6d6]">{inc.summary}</p>
                    {inc.timeline.length > 0 && (
                      <div className="pt-3 border-t border-[#1b2b3f] space-y-2">
                        {inc.timeline.map((t, idx) => (
                          <div key={idx} className="text-xs flex flex-wrap items-baseline gap-2">
                            <span className="font-mono text-[10px] text-[#adc6ff]">[{t.phase}]</span>
                            <span className="text-[#d3e4fe]">{t.message}</span>
                            <span className="font-mono text-[10px] text-[#8c909f]">
                              {formatUtcTimestamp(t.created_at)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </section>
            )}

            {/* Scheduled Maintenance */}
            {(data?.maintenance_windows.length ?? 0) > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-[#adc6ff] uppercase tracking-wider font-mono">
                  Scheduled Maintenance ({data!.maintenance_windows.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {data!.maintenance_windows.map((mw) => (
                    <div key={mw.id} className="bg-[#0b1c30] border border-[#26364a] rounded-xl p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs text-[#adc6ff]">{mw.code}</span>
                        <StatusPill status={mw.status} />
                      </div>
                      <h3 className="text-sm font-semibold text-[#d3e4fe]">{mw.title}</h3>
                      <p className="text-xs text-[#c2c6d6]">{mw.description}</p>
                      <div className="font-mono text-[11px] text-[#8c909f] pt-1">
                        {formatUtcTimestamp(mw.start_time)} → {formatUtcTimestamp(mw.end_time)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Public Service Roster with 90-Day Bars */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#d3e4fe] uppercase tracking-wider font-mono">
                  Core Service Availability ({data?.total_public_services ?? 0} Public Monitors)
                </h2>
                <span className="font-mono text-[11px] text-[#8c909f]">90-Day Daily History</span>
              </div>

              <div className="space-y-3">
                {(data?.services || []).map((svc) => (
                  <div key={svc.id} className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <ProtocolBadge protocol={svc.protocol} />
                        <div>
                          <div className="text-sm font-semibold text-[#d3e4fe]">{svc.name}</div>
                          <div className="font-mono text-[11px] text-[#8c909f]">{svc.public_endpoint}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {svc.latency_ms !== null && (
                          <span className="font-mono text-xs text-[#c2c6d6] tabular-nums">{svc.latency_ms}ms</span>
                        )}
                        {svc.ssl_days_remaining !== null && (
                          <span className="font-mono text-[11px] text-[#4edea3] bg-[#102034] px-2 py-0.5 rounded">
                            TLS {svc.ssl_days_remaining}d
                          </span>
                        )}
                        <span className="font-mono text-xs font-semibold text-[#4edea3] tabular-nums">
                          {svc.uptime_90d_pct.toFixed(2)}%
                        </span>
                        <StatusPill status={svc.status} />
                      </div>
                    </div>
                    <HeartbeatBarStrip bars={svc.daily_bars} slots={60} />
                  </div>
                ))}
              </div>
            </section>

            {/* Recent Resolved Incidents */}
            {(data?.resolved_incidents.length ?? 0) > 0 && (
              <section className="space-y-3">
                <h2 className="text-sm font-semibold text-[#d3e4fe] uppercase tracking-wider font-mono">
                  Recent Incident Disclosures
                </h2>
                <div className="space-y-3">
                  {data!.resolved_incidents.map((inc) => (
                    <div key={inc.id} className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-4 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-[#adc6ff]">{inc.code}</span>
                          <span className="text-sm font-semibold text-[#d3e4fe]">{inc.title}</span>
                        </div>
                        <StatusPill status={inc.status} />
                      </div>
                      <p className="text-xs text-[#c2c6d6]">{inc.summary}</p>
                      <div className="font-mono text-[10px] text-[#8c909f]">
                        Resolved: {formatUtcTimestamp(inc.resolved_at)} • Service: {inc.service_name || 'Platform'}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Subscribe to Updates */}
            {data?.portal.allow_subscriptions && (
              <section className="bg-[#0b1c30] border border-[#1b2b3f] rounded-2xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-[#d3e4fe]">Subscribe to Live Status Updates</h2>
                    <p className="text-xs text-[#8c909f]">
                      Receive instant notifications when incidents arise, transition, or resolve ({data.subscriber_count}{' '}
                      subscribers).
                    </p>
                  </div>
                </div>

                <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row gap-3">
                  <select
                    value={subChannel}
                    onChange={(e) => setSubChannel(e.target.value as 'email' | 'slack' | 'discord' | 'telegram')}
                    className="px-3 py-2.5 rounded-xl bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
                  >
                    <option value="email">Email</option>
                    <option value="slack">Slack Handle</option>
                    <option value="discord">Discord Handle</option>
                    <option value="telegram">Telegram Handle</option>
                  </select>
                  <input
                    required
                    value={subDest}
                    onChange={(e) => setSubDest(e.target.value)}
                    placeholder={subChannel === 'email' ? 'engineer@company.com' : '@channel_or_handle'}
                    className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
                  />
                  <button
                    type="submit"
                    disabled={submittingSub}
                    className="px-5 py-2.5 rounded-xl bg-[#4d8eff] hover:bg-[#adc6ff] text-[#00285d] text-xs font-semibold whitespace-nowrap"
                  >
                    {submittingSub ? 'Subscribing...' : 'Subscribe to Alerts'}
                  </button>
                </form>

                {unsubToken && (
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-[#102034] border border-[#26364a] text-xs">
                    <span className="font-mono text-[#4edea3]">Subscribed! Instant 1-click unsubscribe available:</span>
                    <button
                      type="button"
                      onClick={() => void handleUnsubscribe()}
                      className="px-3 py-1 rounded-lg bg-[#93000a]/50 hover:bg-[#93000a] text-[#ffb4ab] font-mono text-[11px]"
                    >
                      Unsubscribe Now
                    </button>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>

      <footer className="max-w-5xl mx-auto px-4 sm:px-6 py-6 border-t border-[#1b2b3f] flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-[#8c909f]">
        <span>VigilNode — MCA Capstone Project • Project Owner: Shubham Bind</span>
        <span>Sanitized Public Availability Telemetry</span>
      </footer>

      {/* Admin Portal Customizer Modal */}
      {customizerOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0b1c30] border border-[#26364a] rounded-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#d3e4fe]">Customize Public Status Portal</h3>
              <button type="button" onClick={() => setCustomizerOpen(false)} className="text-[#8c909f]">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleSaveBranding} className="space-y-3">
              <div>
                <label className="block text-xs text-[#c2c6d6] mb-1">Portal Title</label>
                <input
                  value={portalTitle}
                  onChange={(e) => setPortalTitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs text-[#d3e4fe]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#c2c6d6] mb-1">Portal Subtitle</label>
                <textarea
                  rows={2}
                  value={portalSubtitle}
                  onChange={(e) => setPortalSubtitle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs text-[#d3e4fe]"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-[#c2c6d6]">
                <input
                  type="checkbox"
                  checked={allowSubs}
                  onChange={(e) => setAllowSubs(e.target.checked)}
                  className="accent-[#4edea3]"
                />
                <span>Allow Public Alert Subscriptions</span>
              </label>
              <div className="flex justify-end gap-2 pt-2 border-t border-[#1b2b3f]">
                <button
                  type="button"
                  onClick={() => setCustomizerOpen(false)}
                  className="px-3.5 py-2 rounded-lg bg-[#102034] text-xs text-[#c2c6d6]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingBrand}
                  className="px-4 py-2 rounded-lg bg-[#4d8eff] text-[#00285d] text-xs font-semibold"
                >
                  {savingBrand ? 'Saving...' : 'Save Portal Branding'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
