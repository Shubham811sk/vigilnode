const TOKEN_KEY = 'vigilnode_access_token';

export function getStoredToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setStoredToken(token: string): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export async function apiFetch<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };
  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`/api${endpoint}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const errPayload = (await res.json().catch(() => ({}))) as { detail?: string; message?: string };
    throw new Error(errPayload.detail || errPayload.message || `HTTP ${res.status}: ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }
  return (await res.text()) as unknown as T;
}

export async function downloadAuthenticatedFile(endpoint: string, filename: string): Promise<void> {
  const token = getStoredToken();
  const res = await fetch(`/api${endpoint}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const errPayload = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(errPayload.detail || `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function getWebSocketUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = getStoredToken();
  const qs = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${proto}//${window.location.host}/ws/telemetry${qs}`;
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

export function formatRelativeTime(iso?: string | null): string {
  if (!iso) return 'Never';
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(diffSec)) return iso;
  if (diffSec < 0) {
    const futureSec = Math.abs(diffSec);
    if (futureSec < 60) return `in ${futureSec}s`;
    if (futureSec < 3600) return `in ${Math.floor(futureSec / 60)}m`;
    if (futureSec < 86400) return `in ${Math.floor(futureSec / 3600)}h`;
    return `in ${Math.floor(futureSec / 86400)}d`;
  }
  if (diffSec < 10) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export function formatUtcTimestamp(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}
