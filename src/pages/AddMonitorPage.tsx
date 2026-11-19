import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ProtocolBadge, StatusPill } from '../components/StatusBadges';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { apiFetch } from '../lib/api';

type Protocol = 'HTTPS' | 'HTTP' | 'TCP' | 'DNS' | 'SSL';

interface FormState {
  name: string;
  target: string;
  protocol: Protocol;
  http_method: string;
  port: string;
  dns_record_type: 'A' | 'AAAA' | 'CNAME';
  expected_status: string;
  expected_keyword: string;
  expected_dns_answer: string;
  interval_sec: number;
  timeout_ms: number;
  retry_threshold: number;
  ssl_warning_days: number;
  enabled: boolean;
  is_public: boolean;
  tags: string;
}

const INITIAL_FORM: FormState = {
  name: '',
  target: '',
  protocol: 'HTTPS',
  http_method: 'GET',
  port: '443',
  dns_record_type: 'A',
  expected_status: '200',
  expected_keyword: '',
  expected_dns_answer: '',
  interval_sec: 60,
  timeout_ms: 5000,
  retry_threshold: 2,
  ssl_warning_days: 14,
  enabled: true,
  is_public: true,
  tags: '',
};

const INTERVAL_PRESETS = [
  { label: '15s', value: 15 },
  { label: '30s', value: 30 },
  { label: '60s', value: 60 },
  { label: '5m', value: 300 },
  { label: '15m', value: 900 },
  { label: '1h', value: 3600 },
];

export default function AddMonitorPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const { showToast } = useToast();

  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [loadedInitial, setLoadedInitial] = useState<FormState>(INITIAL_FORM);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [formError, setFormError] = useState('');
  const [testResult, setTestResult] = useState<{
    status: string;
    response_time_ms: number;
    status_code: number | null;
    error_message: string;
  } | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    apiFetch<{ monitor: Record<string, unknown> }>(`/monitors/${id}`)
      .then((res) => {
        const m = res.monitor;
        const next: FormState = {
          name: String(m.name || ''),
          target: String(m.target || ''),
          protocol: (String(m.protocol || 'HTTPS') as Protocol),
          http_method: String(m.http_method || 'GET'),
          port: m.port ? String(m.port) : '',
          dns_record_type: (String(m.dns_record_type || 'A') as 'A' | 'AAAA' | 'CNAME'),
          expected_status: String(m.expected_status || ''),
          expected_keyword: String(m.expected_keyword || ''),
          expected_dns_answer: String(m.expected_dns_answer || ''),
          interval_sec: Number(m.interval_sec || 60),
          timeout_ms: Number(m.timeout_ms || 5000),
          retry_threshold: Number(m.retry_threshold || 2),
          ssl_warning_days: Number(m.ssl_warning_days || 14),
          enabled: Boolean(m.enabled),
          is_public: Boolean(m.is_public),
          tags: Array.isArray(m.tags) ? m.tags.join(', ') : '',
        };
        setForm(next);
        setLoadedInitial(next);
      })
      .catch((err) => {
        showToast(err instanceof Error ? err.message : 'Failed to load monitor', 'error');
        navigate('/monitors');
      })
      .finally(() => setLoading(false));
  }, [id, navigate, showToast]);

  const handleProtocolChange = (proto: Protocol) => {
    const defaultPort = proto === 'HTTPS' || proto === 'SSL' ? '443' : proto === 'HTTP' ? '80' : proto === 'DNS' ? '53' : '5432';
    setForm((prev) => ({
      ...prev,
      protocol: proto,
      port: defaultPort,
      expected_status: proto === 'HTTP' || proto === 'HTTPS' ? prev.expected_status || '200' : '',
    }));
    setTestResult(null);
    setFormError('');
  };

  const buildPayload = () => ({
    name: form.name.trim(),
    target: form.target.trim(),
    protocol: form.protocol,
    http_method: form.http_method,
    port: form.port ? Number(form.port) : undefined,
    dns_record_type: form.dns_record_type,
    expected_status: form.expected_status.trim(),
    expected_keyword: form.expected_keyword.trim(),
    expected_dns_answer: form.expected_dns_answer.trim(),
    interval_sec: Number(form.interval_sec),
    timeout_ms: Number(form.timeout_ms),
    retry_threshold: Number(form.retry_threshold),
    ssl_warning_days: Number(form.ssl_warning_days),
    enabled: form.enabled,
    is_public: form.is_public,
    tags: form.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  });

  const validateClient = (): string | null => {
    if (form.name.trim().length < 2) return 'Monitor name must be at least 2 characters.';
    if (!form.target.trim()) return 'Target URL, hostname, or IP address is required.';
    if (form.interval_sec < 15 || form.interval_sec > 86400) return 'Check interval must be between 15s and 86400s.';
    if (form.timeout_ms < 500 || form.timeout_ms > 60000) return 'Timeout must be between 500ms and 60000ms.';
    if (form.protocol === 'TCP') {
      const p = Number(form.port);
      if (!p || p < 1 || p > 65535) return 'TCP monitors require a port between 1 and 65535.';
    }
    if ((form.protocol === 'HTTP' || form.protocol === 'HTTPS') && !/^https?:\/\//i.test(form.target.trim())) {
      return `${form.protocol} target must start with http:// or https://`;
    }
    return null;
  };

  const handleTestConnection = async () => {
    const clientErr = validateClient();
    if (clientErr) {
      setFormError(clientErr);
      return;
    }
    setFormError('');
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiFetch<{
        status: string;
        response_time_ms: number;
        status_code: number | null;
        error_message: string;
      }>('/monitors/test', {
        method: 'POST',
        body: JSON.stringify(buildPayload()),
      });
      setTestResult(res);
      showToast(`Test probe completed: ${res.status} (${res.response_time_ms}ms)`, res.status === 'UP' ? 'success' : 'warn');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Probe validation failed.');
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clientErr = validateClient();
    if (clientErr) {
      setFormError(clientErr);
      return;
    }
    setFormError('');
    setSaving(true);
    try {
      const payload = buildPayload();
      if (isEdit && id) {
        await apiFetch(`/monitors/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        showToast(`Monitor "${payload.name}" updated.`, 'success');
        navigate(`/monitors/${id}`);
      } else {
        const created = await apiFetch<{ id: string }>('/monitors', { method: 'POST', body: JSON.stringify(payload) });
        showToast(`Monitor "${payload.name}" created and telemetry scheduled.`, 'success');
        navigate(`/monitors/${created.id}`);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save monitor.');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-8 text-center space-y-3">
        <span className="material-symbols-outlined text-3xl text-amber-300">lock</span>
        <h2 className="text-lg font-semibold text-[#d3e4fe]">Administrator Role Required</h2>
        <p className="text-xs text-[#8c909f]">
          Read-Only Maintainers can inspect telemetry and export reports, but only Administrators can create or edit monitors.
        </p>
      </div>
    );
  }

  if (loading) {
    return <div className="p-8 text-center font-mono text-xs text-[#8c909f]">Loading monitor configuration...</div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-wider text-[#adc6ff]">
            {isEdit ? 'MODIFY PROBE CONFIGURATION' : 'SYNTHETIC PROBE PROVISIONING'}
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-[#d3e4fe] mt-1">
            {isEdit ? `Edit Monitor: ${form.name}` : 'Add New Monitor'}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="px-3 py-2 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] border border-[#26364a] text-xs text-[#c2c6d6]"
        >
          ← Back
        </button>
      </div>

      {formError && (
        <div className="p-3.5 rounded-xl bg-[#93000a]/40 border border-[#ff5451]/60 flex items-start gap-2.5 text-xs text-[#ffb4ab]">
          <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
          <span>{formError}</span>
        </div>
      )}

      {testResult && (
        <div className="p-4 rounded-xl bg-[#0b1c30] border border-[#26364a] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <StatusPill status={testResult.status} />
            <div className="text-xs">
              <div className="font-semibold text-[#d3e4fe]">
                Live Probe Result • <span className="font-mono">{testResult.response_time_ms}ms</span>
                {testResult.status_code ? ` • HTTP ${testResult.status_code}` : ''}
              </div>
              {testResult.error_message && (
                <div className="font-mono text-[11px] text-[#ffb4ab] mt-0.5">{testResult.error_message}</div>
              )}
            </div>
          </div>
          <ProtocolBadge protocol={form.protocol} />
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-[#0b1c30] border border-[#1b2b3f] rounded-xl p-6 space-y-6">
        {/* Protocol Selector */}
        <div>
          <label className="block text-xs font-semibold text-[#c2c6d6] mb-2">Monitoring Protocol</label>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {(['HTTPS', 'HTTP', 'TCP', 'DNS', 'SSL'] as Protocol[]).map((proto) => (
              <button
                key={proto}
                type="button"
                onClick={() => handleProtocolChange(proto)}
                className={`py-2.5 px-3 rounded-xl border font-mono text-xs font-semibold transition-all ${
                  form.protocol === proto
                    ? 'bg-[#4d8eff]/20 border-[#adc6ff] text-[#adc6ff]'
                    : 'bg-[#102034] border-[#1b2b3f] text-[#8c909f] hover:text-[#d3e4fe]'
                }`}
              >
                {proto === 'SSL' ? 'SSL/TLS' : proto}
              </button>
            ))}
          </div>
        </div>

        {/* Name & Target */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="mon-name" className="block text-xs font-medium text-[#c2c6d6] mb-1.5">
              Monitor Name *
            </label>
            <input
              id="mon-name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g., Primary Payment API"
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#000f21] border border-[#26364a] focus:border-[#adc6ff] focus:outline-none text-xs text-[#d3e4fe]"
            />
          </div>

          <div>
            <label htmlFor="mon-target" className="block text-xs font-medium text-[#c2c6d6] mb-1.5">
              {form.protocol === 'HTTP' || form.protocol === 'HTTPS'
                ? 'Target Endpoint URL *'
                : 'Target Hostname or Public IP *'}
            </label>
            <input
              id="mon-target"
              required
              value={form.target}
              onChange={(e) => setForm({ ...form, target: e.target.value })}
              placeholder={
                form.protocol === 'HTTPS'
                  ? 'https://api.example.com/health'
                  : form.protocol === 'HTTP'
                    ? 'http://example.com/status'
                    : form.protocol === 'TCP'
                      ? 'db.example.com'
                      : 'example.com'
              }
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#000f21] border border-[#26364a] focus:border-[#adc6ff] focus:outline-none text-xs text-[#d3e4fe] font-mono"
            />
            <p className="text-[10px] font-mono text-[#8c909f] mt-1">
              SSRF Guard active: private/loopback/metadata IPs are rejected.
            </p>
          </div>
        </div>

        {/* Protocol Specific Fields */}
        {(form.protocol === 'HTTP' || form.protocol === 'HTTPS') && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 rounded-xl bg-[#102034]/60 border border-[#1b2b3f]">
            <div>
              <label className="block text-xs font-medium text-[#c2c6d6] mb-1.5">HTTP Method</label>
              <select
                value={form.http_method}
                onChange={(e) => setForm({ ...form, http_method: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
              >
                <option value="GET">GET</option>
                <option value="HEAD">HEAD</option>
                <option value="POST">POST</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#c2c6d6] mb-1.5">Expected HTTP Status</label>
              <input
                value={form.expected_status}
                onChange={(e) => setForm({ ...form, expected_status: e.target.value })}
                placeholder="200 or 200,204"
                className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#c2c6d6] mb-1.5">Expected Body Keyword (Optional)</label>
              <input
                value={form.expected_keyword}
                onChange={(e) => setForm({ ...form, expected_keyword: e.target.value })}
                placeholder="ok / healthy"
                className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
              />
            </div>
          </div>
        )}

        {form.protocol === 'TCP' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-[#102034]/60 border border-[#1b2b3f]">
            <div>
              <label className="block text-xs font-medium text-[#c2c6d6] mb-1.5">TCP Port (1–65535) *</label>
              <input
                type="number"
                min={1}
                max={65535}
                required
                value={form.port}
                onChange={(e) => setForm({ ...form, port: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
              />
            </div>
          </div>
        )}

        {form.protocol === 'DNS' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-[#102034]/60 border border-[#1b2b3f]">
            <div>
              <label className="block text-xs font-medium text-[#c2c6d6] mb-1.5">DNS Record Type</label>
              <select
                value={form.dns_record_type}
                onChange={(e) => setForm({ ...form, dns_record_type: e.target.value as 'A' | 'AAAA' | 'CNAME' })}
                className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
              >
                <option value="A">A (IPv4 Address)</option>
                <option value="AAAA">AAAA (IPv6 Address)</option>
                <option value="CNAME">CNAME (Canonical Name)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#c2c6d6] mb-1.5">Expected Record Contains (Optional)</label>
              <input
                value={form.expected_dns_answer}
                onChange={(e) => setForm({ ...form, expected_dns_answer: e.target.value })}
                placeholder="e.g., 93.184.216.34"
                className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
              />
            </div>
          </div>
        )}

        {(form.protocol === 'SSL' || form.protocol === 'HTTPS') && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-[#102034]/60 border border-[#1b2b3f]">
            <div>
              <label className="block text-xs font-medium text-[#c2c6d6] mb-1.5">SSL Expiry Warning Threshold</label>
              <select
                value={form.ssl_warning_days}
                onChange={(e) => setForm({ ...form, ssl_warning_days: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
              >
                <option value={7}>7 Days Remaining</option>
                <option value={14}>14 Days Remaining</option>
                <option value={30}>30 Days Remaining</option>
                <option value={60}>60 Days Remaining</option>
              </select>
            </div>
            {form.protocol === 'SSL' && (
              <div>
                <label className="block text-xs font-medium text-[#c2c6d6] mb-1.5">TLS Port</label>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
                />
              </div>
            )}
          </div>
        )}

        {/* Timing & Reliability */}
        <div className="space-y-3">
          <label className="block text-xs font-medium text-[#c2c6d6]">Check Interval (seconds)</label>
          <div className="flex flex-wrap items-center gap-2">
            {INTERVAL_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setForm({ ...form, interval_sec: p.value })}
                className={`px-3 py-1.5 rounded-lg font-mono text-xs border ${
                  form.interval_sec === p.value
                    ? 'bg-[#4d8eff]/20 border-[#adc6ff] text-[#adc6ff]'
                    : 'bg-[#102034] border-[#1b2b3f] text-[#c2c6d6]'
                }`}
              >
                {p.label}
              </button>
            ))}
            <input
              type="number"
              min={15}
              max={86400}
              value={form.interval_sec}
              onChange={(e) => setForm({ ...form, interval_sec: Number(e.target.value) })}
              className="w-28 px-3 py-1.5 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
              aria-label="Custom interval seconds"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#c2c6d6] mb-1.5">Probe Timeout (ms)</label>
            <input
              type="number"
              min={500}
              max={60000}
              step={100}
              value={form.timeout_ms}
              onChange={(e) => setForm({ ...form, timeout_ms: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#c2c6d6] mb-1.5">Retry Threshold (Failures)</label>
            <input
              type="number"
              min={1}
              max={10}
              value={form.retry_threshold}
              onChange={(e) => setForm({ ...form, retry_threshold: Number(e.target.value) })}
              className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#c2c6d6] mb-1.5">Tags (Comma-separated)</label>
            <input
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="core, production, edge"
              className="w-full px-3 py-2 rounded-lg bg-[#000f21] border border-[#26364a] text-xs font-mono text-[#d3e4fe]"
            />
          </div>
        </div>

        {/* Toggles */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <label className="flex items-center justify-between p-3.5 rounded-xl bg-[#102034] border border-[#1b2b3f] cursor-pointer">
            <div>
              <div className="text-xs font-semibold text-[#d3e4fe]">Monitor Enabled</div>
              <div className="text-[11px] text-[#8c909f]">Start scheduling continuous synthetic checks immediately</div>
            </div>
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="w-4 h-4 accent-[#4edea3]"
            />
          </label>

          <label className="flex items-center justify-between p-3.5 rounded-xl bg-[#102034] border border-[#1b2b3f] cursor-pointer">
            <div>
              <div className="text-xs font-semibold text-[#d3e4fe]">Publish on Public Status Portal</div>
              <div className="text-[11px] text-[#8c909f]">Display sanitized operational state on /status</div>
            </div>
            <input
              type="checkbox"
              checked={form.is_public}
              onChange={(e) => setForm({ ...form, is_public: e.target.checked })}
              className="w-4 h-4 accent-[#4d8eff]"
            />
          </label>
        </div>

        {/* Action Buttons */}
        <div className="pt-4 border-t border-[#1b2b3f] flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleTestConnection()}
              disabled={testing}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] border border-[#4edea3]/40 text-xs font-semibold text-[#4edea3] disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">network_check</span>
              <span>{testing ? 'Probing Target...' : 'Test Connection'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setForm(isEdit ? loadedInitial : INITIAL_FORM);
                setTestResult(null);
                setFormError('');
              }}
              className="px-3.5 py-2 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] text-xs font-medium text-[#c2c6d6]"
            >
              Reset Form
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/monitors')}
              className="px-4 py-2 rounded-lg bg-[#102034] hover:bg-[#1b2b3f] text-xs font-medium text-[#c2c6d6]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#4d8eff] hover:bg-[#adc6ff] text-[#00285d] text-xs font-semibold disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[16px]">save</span>
              <span>{saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Save & Start Monitor'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
