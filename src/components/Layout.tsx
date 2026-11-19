import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTelemetry } from '../contexts/TelemetryContext';
import { apiFetch, formatRelativeTime } from '../lib/api';

interface NavCounts {
  upMonitors: number;
  totalMonitors: number;
  activeIncidents: number;
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isAdmin, logout } = useAuth();
  const { connected, recentEvents } = useTelemetry();
  const location = useLocation();
  const navigate = useNavigate();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState('');
  const [counts, setCounts] = useState<NavCounts>({ upMonitors: 0, totalMonitors: 0, activeIncidents: 0 });
  const [quickMonitors, setQuickMonitors] = useState<Array<{ id: string; name: string; protocol: string; target: string }>>([]);

  useEffect(() => {
    setMobileMenuOpen(false);
    setNotifOpen(false);
    setProfileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const loadCounts = async () => {
      if (!user) return;
      try {
        const dash = await apiFetch<{
          summary: { up_monitors: number; total_monitors: number; active_incidents: number };
          monitors_preview: Array<{ id: string; name: string; protocol: string; target: string }>;
        }>('/dashboard?range=24h');
        setCounts({
          upMonitors: dash.summary.up_monitors,
          totalMonitors: dash.summary.total_monitors,
          activeIncidents: dash.summary.active_incidents,
        });
        setQuickMonitors(dash.monitors_preview || []);
      } catch {
        // ignore nav count errors
      }
    };
    void loadCounts();
    const timer = window.setInterval(() => void loadCounts(), 15000);
    return () => window.clearInterval(timer);
  }, [user, recentEvents.length]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setCmdOpen(false);
        setNotifOpen(false);
        setProfileOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const navOverview = [
    { to: '/', label: 'Dashboard', icon: 'grid_view' },
    {
      to: '/monitors',
      label: 'Monitors',
      icon: 'dns',
      badge: `${counts.upMonitors} Up`,
      badgeTone: 'bg-[#1b2b3f] text-[#4edea3]',
    },
    ...(isAdmin ? [{ to: '/monitors/new', label: 'Add Monitor', icon: 'add_circle' }] : []),
    { to: '/monitor-details', label: 'Monitor Details', icon: 'insights' },
    {
      to: '/incidents',
      label: 'Incidents',
      icon: 'warning',
      iconClass: counts.activeIncidents > 0 ? 'text-[#ffb4ab]' : '',
      badge: counts.activeIncidents > 0 ? `${counts.activeIncidents} Active` : '0',
      badgeTone: counts.activeIncidents > 0 ? 'bg-[#93000a] text-[#ffb4ab]' : 'bg-[#1b2b3f] text-[#8c909f]',
    },
    { to: '/maintenance', label: 'Maintenance', icon: 'event_repeat' },
  ];

  const navOperations = [
    { to: '/alerts', label: 'Alerts & Integrations', icon: 'notifications_active' },
    { to: '/status', label: 'Public Status Page', icon: 'public', externalIcon: true },
    { to: '/analytics', label: 'Analytics', icon: 'query_stats' },
    { to: '/users', label: 'User Management', icon: 'manage_accounts' },
    { to: '/settings', label: 'Settings', icon: 'tune' },
  ];

  const initials = (user?.full_name || 'VN')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const renderSidebarContent = () => (
    <div className="flex flex-col justify-between h-full">
      <div className="flex flex-col flex-1 overflow-y-auto">
        {/* Brand Header */}
        <div className="h-16 px-4 flex items-center justify-between bg-[#000f21]/90 border-b border-[#1b2b3f]/70 shrink-0">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#4d8eff]/20 border border-[#adc6ff]/30 flex items-center justify-center text-[#adc6ff]">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" className="opacity-40" />
                <path d="M3 12h4l2.5-5 4 10 2.5-5H21" stroke="#4edea3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-[#d3e4fe] tracking-tight leading-none">VigilNode</span>
              <span className="font-mono text-[10px] text-[#adc6ff] mt-1">Telemetry Portal</span>
            </div>
          </Link>
          <div className="flex items-center gap-1.5 bg-[#102034] px-2 py-0.5 rounded-lg border border-[#1b2b3f]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#4edea3] animate-pulse" />
            <span className="font-mono text-[10px] font-semibold text-[#4edea3] uppercase">Active</span>
          </div>
        </div>

        {/* Engine Status Box */}
        <div className="px-3 py-3">
          <div className="flex items-center justify-between px-2.5 py-1.5 bg-[#102034] rounded-lg border border-[#1b2b3f]">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="material-symbols-outlined text-[#4edea3] text-[15px]">schedule</span>
              <span className="font-mono text-[11px] text-[#c2c6d6] truncate">Scheduler Engine</span>
            </div>
            <span className="font-mono text-[10px] text-[#4edea3] bg-[#1b2b3f] px-1.5 py-0.5 rounded">LIVE</span>
          </div>
        </div>

        {/* Navigation Sections */}
        <div className="px-4 pt-1 pb-1.5">
          <span className="text-[10px] font-semibold text-[#8c909f] uppercase tracking-wider">Monitor Overview</span>
        </div>
        <nav className="flex flex-col gap-0.5 px-2.5">
          {navOverview.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center justify-between px-2.5 py-2 rounded-lg text-[13px] transition-colors ${
                  isActive
                    ? 'bg-[#1b2b3f] text-[#adc6ff] font-semibold shadow-inner'
                    : 'text-[#c2c6d6] hover:bg-[#102034] hover:text-[#d3e4fe]'
                }`
              }
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`material-symbols-outlined text-[18px] ${item.iconClass || ''}`}>{item.icon}</span>
                <span className="truncate">{item.label}</span>
              </div>
              {item.badge && (
                <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${item.badgeTone}`}>{item.badge}</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 pt-4 pb-1.5">
          <span className="text-[10px] font-semibold text-[#8c909f] uppercase tracking-wider">Operations</span>
        </div>
        <nav className="flex flex-col gap-0.5 px-2.5 pb-4">
          {navOperations.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center justify-between px-2.5 py-2 rounded-lg text-[13px] transition-colors ${
                  isActive
                    ? 'bg-[#1b2b3f] text-[#adc6ff] font-semibold shadow-inner'
                    : 'text-[#c2c6d6] hover:bg-[#102034] hover:text-[#d3e4fe]'
                }`
              }
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
                <span className="truncate">{item.label}</span>
              </div>
              {item.externalIcon && (
                <span className="material-symbols-outlined text-[14px] text-[#8c909f]">open_in_new</span>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Footer Identity */}
      <div className="p-3 bg-[#000f21]/90 border-t border-[#1b2b3f]/70">
        <div className="flex items-center gap-2.5 p-2 rounded-lg bg-[#0b1c30]">
          <div className="w-8 h-8 rounded bg-[#4d8eff]/20 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[#adc6ff] text-[18px]">terminal</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              <span className="font-mono text-[11px] text-[#d3e4fe] truncate">Shubham Bind</span>
              <span className="text-[9px] px-1 py-0.5 rounded bg-[#1b2b3f] text-[#4edea3] uppercase font-semibold">
                {user?.role === 'ADMIN' ? 'Admin' : 'Viewer'}
              </span>
            </div>
            <div className="font-mono text-[10px] text-[#8c909f] truncate">MCA Capstone Project</div>
          </div>
        </div>
      </div>
    </div>
  );

  const allQuickTargets = [
    ...navOverview.map((n) => ({ label: n.label, sub: 'Navigation Page', to: n.to })),
    ...navOperations.map((n) => ({ label: n.label, sub: 'Operations Page', to: n.to })),
    ...quickMonitors.map((m) => ({ label: m.name, sub: `${m.protocol} • ${m.target}`, to: `/monitors/${m.id}` })),
  ].filter((item) => !cmdQuery || `${item.label} ${item.sub}`.toLowerCase().includes(cmdQuery.toLowerCase()));

  return (
    <div className="min-h-screen bg-[#031427] text-[#d3e4fe]">
      {/* Desktop Fixed Sidebar */}
      <aside className="hidden lg:block fixed left-0 top-0 h-full w-64 bg-[#0b1c30] border-r border-[#1b2b3f] z-40">
        {renderSidebarContent()}
      </aside>

      {/* Mobile Slide-Over Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-72 max-w-[85vw] h-full bg-[#0b1c30] border-r border-[#1b2b3f] z-10">
            {renderSidebarContent()}
          </aside>
        </div>
      )}

      {/* Main Column */}
      <div className="lg:pl-64 flex flex-col min-h-screen">
        {/* Sticky Topbar */}
        <header className="sticky top-0 h-16 bg-[#000f21]/85 backdrop-blur-xl border-b border-[#1b2b3f] z-30 flex items-center justify-between px-4 lg:px-6 gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-[#102034] text-[#d3e4fe]"
              aria-label="Open menu"
            >
              <span className="material-symbols-outlined">menu</span>
            </button>

            {/* Quick Search Trigger */}
            <button
              type="button"
              onClick={() => setCmdOpen(true)}
              className="flex-1 max-w-md h-9 px-3 bg-[#102034] hover:bg-[#1b2b3f] rounded-lg border border-[#1b2b3f] flex items-center justify-between text-xs text-[#8c909f] transition-colors"
            >
              <span className="flex items-center gap-2 truncate">
                <span className="material-symbols-outlined text-[16px]">search</span>
                <span className="truncate">Quick search monitors, incidents...</span>
              </span>
              <kbd className="hidden sm:inline font-mono text-[10px] bg-[#1b2b3f] text-[#c2c6d6] px-1.5 py-0.5 rounded">
                ⌘K
              </kbd>
            </button>

            <div className="hidden xl:flex items-center gap-2 bg-[#102034] px-3 py-1.5 rounded-lg border border-[#1b2b3f]">
              <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-[#4edea3]' : 'bg-amber-400'}`} />
              <span className="font-mono text-[11px] text-[#c2c6d6]">
                Telemetry Stream:{' '}
                <strong className={connected ? 'text-[#4edea3]' : 'text-amber-300'}>
                  {connected ? 'CONNECTED' : 'RECONNECTING'}
                </strong>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <span
              className={`hidden sm:inline-flex items-center gap-1.5 font-mono text-[11px] px-2.5 py-1 rounded-lg border ${
                isAdmin
                  ? 'bg-[#00a572]/15 border-[#4edea3]/30 text-[#4edea3]'
                  : 'bg-[#4d8eff]/15 border-[#adc6ff]/30 text-[#adc6ff]'
              }`}
            >
              <span className="material-symbols-outlined text-[14px]">
                {isAdmin ? 'admin_panel_settings' : 'visibility'}
              </span>
              {user?.role || 'GUEST'}
            </span>

            {/* Notifications Bell */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((o) => !o)}
                className="relative min-w-[40px] min-h-[40px] rounded-lg bg-[#102034] hover:bg-[#1b2b3f] flex items-center justify-center text-[#c2c6d6] border border-[#1b2b3f]"
                aria-label="Live Telemetry Notifications"
              >
                <span className="material-symbols-outlined text-[20px]">notifications</span>
                {(counts.activeIncidents > 0 || recentEvents.length > 0) && (
                  <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[#ff5451]" />
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-[#0b1c30] border border-[#26364a] rounded-xl shadow-2xl p-3 z-50">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#1b2b3f]">
                    <span className="text-xs font-semibold text-[#d3e4fe]">Recent Live Telemetry Events</span>
                    <span className="font-mono text-[10px] text-[#4edea3]">{recentEvents.length} events</span>
                  </div>
                  {recentEvents.length === 0 ? (
                    <p className="text-xs text-[#8c909f] py-3 text-center">No recent WebSocket events in this session.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-64 overflow-y-auto">
                      {recentEvents.slice(0, 8).map((ev, idx) => (
                        <div key={idx} className="p-2 rounded-lg bg-[#102034] text-xs border border-[#1b2b3f]">
                          <div className="flex items-center justify-between font-mono text-[10px] text-[#adc6ff]">
                            <span>{ev.event}</span>
                            <span className="text-[#8c909f]">{formatRelativeTime(ev.timestamp)}</span>
                          </div>
                          <div className="text-[#d3e4fe] mt-0.5 truncate">
                            {String(ev.monitor_name || ev.title || ev.channel_type || 'Telemetry update')}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Profile Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setProfileOpen((o) => !o)}
                className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg hover:bg-[#102034] transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-[#4d8eff] to-[#adc6ff] text-[#00285d] font-mono text-xs font-bold flex items-center justify-center shrink-0">
                  {initials}
                </div>
                <div className="hidden md:flex flex-col text-left">
                  <span className="text-xs font-semibold text-[#d3e4fe] leading-tight">
                    {user?.full_name || 'Guest'}
                  </span>
                  <span className="font-mono text-[10px] text-[#8c909f] leading-tight">{user?.title || 'Public'}</span>
                </div>
                <span className="material-symbols-outlined text-[16px] text-[#8c909f]">expand_more</span>
              </button>
              {profileOpen && (
                <div className="absolute right-0 mt-2 w-60 bg-[#0b1c30] border border-[#26364a] rounded-xl shadow-2xl p-2 z-50 space-y-1">
                  <div className="px-2.5 py-2 border-b border-[#1b2b3f]">
                    <div className="text-xs font-semibold text-[#d3e4fe]">{user?.full_name}</div>
                    <div className="font-mono text-[11px] text-[#8c909f] truncate">{user?.email}</div>
                  </div>
                  <Link
                    to="/settings"
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-[#c2c6d6] hover:bg-[#102034]"
                  >
                    <span className="material-symbols-outlined text-[16px]">tune</span>
                    Application Settings
                  </Link>
                  <Link
                    to="/status"
                    className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-[#c2c6d6] hover:bg-[#102034]"
                  >
                    <span className="material-symbols-outlined text-[16px]">public</span>
                    Public Status Portal
                  </Link>
                  <button
                    type="button"
                    onClick={logout}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-[#ffb4ab] hover:bg-[#93000a]/30"
                  >
                    <span className="material-symbols-outlined text-[16px]">logout</span>
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 p-4 lg:p-6 pb-24 lg:pb-10 max-w-[1600px] w-full mx-auto">{children}</main>
      </div>

      {/* Mobile Fixed Bottom Navigation Bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#000f21]/95 backdrop-blur-md border-t border-[#1b2b3f] grid grid-cols-5 h-16">
        {[
          { to: '/', label: 'Dash', icon: 'grid_view' },
          { to: '/monitors', label: 'Monitors', icon: 'dns' },
          { to: '/incidents', label: 'Incidents', icon: 'warning' },
          { to: '/analytics', label: 'Analytics', icon: 'query_stats' },
          { to: '/settings', label: 'Settings', icon: 'tune' },
        ].map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 min-h-[44px] ${
                isActive ? 'text-[#4edea3]' : 'text-[#8c909f]'
              }`
            }
          >
            <span className="material-symbols-outlined text-[20px]">{tab.icon}</span>
            <span className="text-[10px] font-medium tracking-tight">{tab.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Cmd+K Command Palette Modal */}
      {cmdOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-20 p-4"
          onClick={() => setCmdOpen(false)}
        >
          <div
            className="bg-[#0b1c30] border border-[#26364a] rounded-xl max-w-lg w-full shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[#1b2b3f]">
              <span className="material-symbols-outlined text-[#8c909f] text-[18px]">search</span>
              <input
                autoFocus
                value={cmdQuery}
                onChange={(e) => setCmdQuery(e.target.value)}
                placeholder="Jump to page or monitor..."
                className="flex-1 bg-transparent text-sm text-[#d3e4fe] placeholder-[#8c909f] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setCmdOpen(false)}
                className="font-mono text-[10px] text-[#8c909f] bg-[#102034] px-1.5 py-0.5 rounded"
              >
                ESC
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto p-2 space-y-1">
              {allQuickTargets.map((item, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    navigate(item.to);
                    setCmdOpen(false);
                    setCmdQuery('');
                  }}
                  className="w-full text-left px-3 py-2 rounded-lg hover:bg-[#1b2b3f] flex items-center justify-between gap-2 transition-colors"
                >
                  <span className="text-xs font-medium text-[#d3e4fe] truncate">{item.label}</span>
                  <span className="font-mono text-[10px] text-[#8c909f] truncate">{item.sub}</span>
                </button>
              ))}
              {allQuickTargets.length === 0 && (
                <p className="text-xs text-[#8c909f] text-center py-6">No matching routes or monitors.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
