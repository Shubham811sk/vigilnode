import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../lib/api';

type CategoryKey =
  | 'general'
  | 'monitoring'
  | 'incidents'
  | 'notifications'
  | 'public_status'
  | 'security'
  | 'retention';

const CATEGORIES: Array<{ key: CategoryKey; label: string; icon: string; desc: string }> = [
  { key: 'general', label: 'General Settings', icon: 'settings', desc: 'Branding, timezone, density & UI preferences' },
  { key: 'monitoring', label: 'Monitoring Engine', icon: 'dns', desc: 'Default intervals, timeouts, retries & flap limits' },
  { key: 'incidents', label: 'Incident Rules', icon: 'warning', desc: 'Auto-creation, recovery thresholds & public sync' },
  { key: 'notifications', label: 'Notifications', icon: 'notifications', desc: 'Maintenance alert suppression & cooldowns' },
  { key: 'public_status', label: 'Public Status Portal', icon: 'public', desc: 'Portal title, SLA target & subscriber options' },
  { key: 'security', label: 'Security & Auth', icon: 'shield', desc: 'RBAC, SSRF guard, session expiry & rate limits' },
  { key: 'retention', label: 'Data Retention', icon: 'database', desc: 'Check history, incidents & audit log retention' },
];

export default function SettingsPage() {
  const { isAdmin } = useAuth();
  const { showToast, confirmAction } = useToast();

  const [activeCat, setActiveCat] = useState<CategoryKey>('general');
  const [settings, setSettings] = useState<Record<string, Record<string, unknown>>>({});
  const [savedSnapshot, setSavedSnapshot] = useState<Record<string, Record<string, unknown>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Change password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPw, setChangingPw] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ settings: Record<string, Record<string, unknown>> }>('/settings');
      setSettings(res.settings);
      setSavedSnapshot(JSON.parse(JSON.stringify(res.settings)));
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load system settings', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const currentCfg = settings[activeCat] || {};
  const hasUnsaved = JSON.stringify(settings[activeCat]) !== JSON.stringify(savedSnapshot[activeCat]);

  const updateField = (field: string, value: unknown) => {
    setSettings((prev) => ({
      ...prev,
      [activeCat]: {
        ...(prev[activeCat] || {}),
        [field]: value,
      },
    }));
  };

  const handleSaveCategory = async () => {
    setSaving(true);
    try {
      const res = await apiFetch<{ config: Record<string, unknown> }>(`/settings/${activeCat}`, {
        method: 'PUT',
        body: JSON.stringify(currentCfg),
      });
      setSettings((prev) => ({ ...prev, [activeCat]: res.config }));
      setSavedSnapshot((prev) => ({ ...prev, [activeCat]: JSON.parse(JSON.stringify(res.config)) }));
      showToast(`Saved "${activeCat}" settings to database.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setSettings((prev) => ({
      ...prev,
      [activeCat]: JSON.parse(JSON.stringify(savedSnapshot[activeCat] || {})),
    }));
    showToast('Unsaved changes discarded.', 'info');
  };

  const handleResetDefaults = async () => {
    const ok = await confirmAction({
      title: 'Reset all settings to defaults?',
      message: 'This restores all 7 system configuration categories to their factory defaults.',
      confirmLabel: 'Reset Defaults',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await apiFetch<{ settings: Record<string, Record<string, unknown>>; message: string }>(
        '/settings/reset-defaults',
        { method: 'POST' },
      );
      setSettings(res.settings);
      setSavedSnapshot(JSON.parse(JSON.stringify(res.settings)));
      showToast(res.message, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Reset failed', 'error');
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangingPw(true);
    try {
      const res = await apiFetch<{ message: string }>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      showToast(res.message, 'success');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Password change failed', 'error');
    } finally {
      setChangingPw(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-wider text-[#adc6ff]">
            PERSISTENT SYSTEM CONFIGURATION
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#d3e4fe] mt-1">Application Settings</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/api/export/source.zip"
            download="vigilnode-full-source.zip"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#4d8eff] hover:bg-[#adc6ff] text-[#00285d] text-xs font-semibold transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">folder_zip</span>
            <span>Download Full Source (.zip)</span>
          </a>
          {isAdmin && (
            <button
              type="button"
              onClick={() => void handleResetDefaults()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#102034] hover:bg-[#93000a]/50 border border-[#26364a] text-xs font-medium text-[#ffb4ab]"
            >
              <span className="material-symbols-outlined text-[16px]">restart_alt</span>
              <span>Reset All to Defaults</span>
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="p-8 text-center font-mono text-xs text-[#8c909f]">Loading system settings...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Category Rail */}
          <div className="lg:col-span-4 space-y-1.5">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.key}
                type="button"
                onClick={() => setActiveCat(cat.key)}
                className={`w-full text-left p-3.5 rounded-xl border transition-colors flex items-start gap-3 ${
                  activeCat === cat.key
                    ? 'bg-[#1b2b3f] border-[#adc6ff]/50 text-[#d3e4fe]'
                    : 'bg-[#0b1c30] border-[#1b2b3f] text-[#c2c6d6] hover:bg-[#102034]'
                }`}
              >
                <span className="material-symbols-outlined text-[20px] text-[#adc6ff] mt-0.5">{cat.icon}</span>
                <div>
                  <div className="text-xs font-semibold">{cat.label}</div>
                  <div className="text-[11px] text-[#8c909f] mt-0.5">{cat.desc}</div>
                </div>
              </button>
            ))}
          </div>

          {/* Right Editor + Password Change */}
          <div className="lg:col-span-8 space-y-6">
            <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#1b2b3f]">
                <div>
                  <h2 className="text-base font-semibold text-[#d3e4fe]">
                    {CATEGORIES.find((c) => c.key === activeCat)?.label}
                  </h2>
                  <p className="text-xs text-[#8c909f]">
                    {CATEGORIES.find((c) => c.key === activeCat)?.desc}
                  </p>
                </div>
                {hasUnsaved && (
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                    UNSAVED CHANGES
                  </span>
                )}
              </div>

              <div className="space-y-3">
                {Object.entries(currentCfg).map(([key, val]) => {
                  const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                  if (typeof val === 'boolean') {
                    return (
                      <label
                        key={key}
                        className="flex items-center justify-between p-3 rounded-xl bg-[#102034] border border-[#1b2b3f] cursor-pointer"
                      >
                        <span className="text-xs font-medium text-[#d3e4fe]">{label}</span>
                        <input
                          type="checkbox"
                          disabled={!isAdmin}
                          checked={val}
                          onChange={(e) => updateField(key, e.target.checked)}
                          className="w-4 h-4 accent-[#4edea3]"
                        />
                      </label>
                    );
                  }
                  if (typeof val === 'number') {
                    return (
                      <div key={key} className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center p-3 rounded-xl bg-[#102034] border border-[#1b2b3f]">
                        <label className="text-xs font-medium text-[#d3e4fe]">{label}</label>
                        <input
                          type="number"
                          disabled={!isAdmin}
                          value={val}
                          onChange={(e) => updateField(key, Number(e.target.value))}
                          className="px-3 py-1.5 rounded-lg bg-[#000f21] border border-[#26364a] font-mono text-xs text-[#d3e4fe]"
                        />
                      </div>
                    );
                  }
                  if (Array.isArray(val)) {
                    return (
                      <div key={key} className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center p-3 rounded-xl bg-[#102034] border border-[#1b2b3f]">
                        <label className="text-xs font-medium text-[#d3e4fe]">{label} (CSV)</label>
                        <input
                          disabled={!isAdmin}
                          value={val.join(', ')}
                          onChange={(e) =>
                            updateField(
                              key,
                              e.target.value
                                .split(',')
                                .map((s) => Number(s.trim()))
                                .filter((n) => !Number.isNaN(n)),
                            )
                          }
                          className="px-3 py-1.5 rounded-lg bg-[#000f21] border border-[#26364a] font-mono text-xs text-[#d3e4fe]"
                        />
                      </div>
                    );
                  }
                  return (
                    <div key={key} className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-center p-3 rounded-xl bg-[#102034] border border-[#1b2b3f]">
                      <label className="text-xs font-medium text-[#d3e4fe]">{label}</label>
                      <input
                        disabled={!isAdmin}
                        value={String(val ?? '')}
                        onChange={(e) => updateField(key, e.target.value)}
                        className="px-3 py-1.5 rounded-lg bg-[#000f21] border border-[#26364a] font-mono text-xs text-[#d3e4fe]"
                      />
                    </div>
                  );
                })}
              </div>

              {isAdmin && (
                <div className="flex flex-wrap items-center justify-end gap-2 pt-3 border-t border-[#1b2b3f]">
                  {hasUnsaved && (
                    <button
                      type="button"
                      onClick={handleDiscard}
                      className="px-3.5 py-2 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] text-xs text-[#c2c6d6]"
                    >
                      Discard Changes
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleSaveCategory()}
                    className="px-4 py-2 rounded-lg bg-[#4d8eff] hover:bg-[#adc6ff] text-[#00285d] text-xs font-semibold"
                  >
                    {saving ? 'Saving...' : 'Save Configuration'}
                  </button>
                </div>
              )}
            </div>

            {/* Password Change Card (Available to current signed-in user) */}
            <form onSubmit={handlePasswordChange} className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-5 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-[#d3e4fe]">Account Security — Change Your Password</h2>
                <p className="text-xs text-[#8c909f]">Update your current operator credentials (minimum 8 characters)</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Current password"
                  className="px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
                />
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New password (min 8 chars)"
                  className="px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={changingPw}
                  className="px-4 py-2 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] border border-[#26364a] text-xs font-semibold text-[#4edea3]"
                >
                  {changingPw ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
