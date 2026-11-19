import crypto from 'node:crypto';
import { Router } from 'express';
import type Database from 'better-sqlite3';
import {
  type AuthenticatedRequest,
  requireAdmin,
  requireAuth,
  validateTargetSyntaxAndSsrf,
} from '../core/security.ts';
import { writeAuditLog } from '../db/database.ts';
import { executeProbe } from '../monitoring/prober.ts';
import { runMonitorCheck } from '../monitoring/scheduler.ts';
import { telemetryWs } from '../ws.ts';

const VALID_PROTOCOLS = new Set(['HTTP', 'HTTPS', 'TCP', 'DNS', 'SSL']);
const VALID_DNS_TYPES = new Set(['A', 'AAAA', 'CNAME']);

function parseJsonSafe<T>(val: unknown, fallback: T): T {
  if (typeof val !== 'string') return fallback;
  try {
    return JSON.parse(val) as T;
  } catch {
    return fallback;
  }
}

function formatMonitor(db: Database.Database, row: Record<string, unknown>) {
  const checks24 = db
    .prepare(
      `SELECT status, response_time_ms, checked_at FROM monitor_checks
       WHERE monitor_id = ? AND checked_at >= datetime('now', '-30 days')
       ORDER BY checked_at DESC LIMIT 90`,
    )
    .all(row.id) as Array<{ status: string; response_time_ms: number; checked_at: string }>;

  const total = checks24.length;
  const upCount = checks24.filter((c) => c.status === 'UP').length;
  const uptimePct = total > 0 ? Math.round((upCount / total) * 10000) / 100 : row.status === 'DOWN' ? 0 : 100;

  return {
    ...row,
    enabled: Boolean(row.enabled),
    is_public: Boolean(row.is_public),
    ssl_valid: row.ssl_valid === null ? null : Boolean(row.ssl_valid),
    headers: parseJsonSafe<Record<string, string>>(row.headers_json, {}),
    tags: parseJsonSafe<string[]>(row.tags_json, []),
    uptime_pct: uptimePct,
    recent_checks: checks24.slice(0, 30).reverse(),
  };
}

function validateMonitorPayload(body: Record<string, unknown>) {
  const name = String(body.name || '').trim();
  const target = String(body.target || '').trim();
  const protocol = String(body.protocol || 'HTTPS').toUpperCase() as 'HTTP' | 'HTTPS' | 'TCP' | 'DNS' | 'SSL';
  const interval_sec = Number(body.interval_sec ?? 60);
  const timeout_ms = Number(body.timeout_ms ?? 5000);
  const retry_threshold = Number(body.retry_threshold ?? 2);
  const ssl_warning_days = Number(body.ssl_warning_days ?? 14);
  const http_method = String(body.http_method || 'GET').toUpperCase();
  const dns_record_type = String(body.dns_record_type || 'A').toUpperCase();
  const expected_status = String(body.expected_status ?? (protocol === 'HTTP' || protocol === 'HTTPS' ? '200' : '')).trim();
  const expected_keyword = String(body.expected_keyword || '').trim();
  const expected_dns_answer = String(body.expected_dns_answer || '').trim();
  const is_public = body.is_public === false ? 0 : 1;
  const enabled = body.enabled === false ? 0 : 1;

  if (!name || name.length < 2) {
    throw new Error('Monitor name must be at least 2 characters.');
  }
  if (!VALID_PROTOCOLS.has(protocol)) {
    throw new Error('Protocol must be one of HTTP, HTTPS, TCP, DNS, or SSL.');
  }
  if (Number.isNaN(interval_sec) || interval_sec < 15 || interval_sec > 86400) {
    throw new Error('Check interval must be between 15 seconds and 86400 seconds (24 hours).');
  }
  if (Number.isNaN(timeout_ms) || timeout_ms < 500 || timeout_ms > 60000) {
    throw new Error('Timeout must be between 500ms and 60000ms.');
  }
  if (Number.isNaN(retry_threshold) || retry_threshold < 1 || retry_threshold > 10) {
    throw new Error('Retry threshold must be between 1 and 10.');
  }

  const parsedTarget = validateTargetSyntaxAndSsrf(protocol, target);
  let port = body.port !== undefined && body.port !== null && body.port !== '' ? Number(body.port) : parsedTarget.port ?? null;

  if (protocol === 'TCP') {
    if (!port || Number.isNaN(port) || port < 1 || port > 65535) {
      throw new Error('TCP monitors require a valid port between 1 and 65535.');
    }
  } else if (protocol === 'SSL') {
    port = port || 443;
  } else if (protocol === 'DNS') {
    if (!VALID_DNS_TYPES.has(dns_record_type)) {
      throw new Error('DNS record type must be A, AAAA, or CNAME.');
    }
    port = 53;
  } else {
    port = port || (protocol === 'HTTPS' ? 443 : 80);
  }

  const tags = Array.isArray(body.tags)
    ? body.tags.map((t) => String(t).trim()).filter(Boolean)
    : typeof body.tags === 'string'
      ? body.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

  const headers =
    body.headers && typeof body.headers === 'object' && !Array.isArray(body.headers)
      ? (body.headers as Record<string, string>)
      : {};

  return {
    name,
    target,
    protocol,
    http_method,
    port,
    dns_record_type,
    expected_status,
    expected_keyword,
    expected_dns_answer,
    headers_json: JSON.stringify(headers),
    interval_sec,
    timeout_ms,
    retry_threshold,
    ssl_warning_days,
    enabled,
    is_public,
    tags_json: JSON.stringify(tags),
  };
}

export function createMonitorsRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/export.csv', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT * FROM monitors ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
    const header = 'id,name,protocol,target,port,status,enabled,interval_sec,last_response_time_ms,last_checked_at\n';
    const lines = rows.map((r) =>
      [
        r.id,
        `"${String(r.name).replace(/"/g, '""')}"`,
        r.protocol,
        `"${String(r.target).replace(/"/g, '""')}"`,
        r.port ?? '',
        r.status,
        r.enabled ? 'true' : 'false',
        r.interval_sec,
        r.last_response_time_ms ?? '',
        r.last_checked_at ?? '',
      ].join(','),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="vigilnode-monitors.csv"');
    res.send(header + lines.join('\n'));
  });

  router.get('/', requireAuth, (req, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const status = String(req.query.status || 'ALL').toUpperCase();
    const protocol = String(req.query.protocol || 'ALL').toUpperCase();
    const tag = String(req.query.tag || '').trim().toLowerCase();
    const sortBy = String(req.query.sort || 'created_at');
    const sortDir = String(req.query.order || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 20));

    const allowedSort: Record<string, string> = {
      name: 'name',
      status: 'status',
      protocol: 'protocol',
      latency: 'last_response_time_ms',
      last_checked_at: 'last_checked_at',
      created_at: 'created_at',
    };
    const orderCol = allowedSort[sortBy] || 'created_at';

    const allRows = db
      .prepare(`SELECT * FROM monitors ORDER BY ${orderCol} ${sortDir}`)
      .all() as Array<Record<string, unknown>>;

    const filtered = allRows.filter((row) => {
      if (status !== 'ALL' && String(row.status).toUpperCase() !== status) return false;
      if (protocol !== 'ALL' && String(row.protocol).toUpperCase() !== protocol) return false;
      if (tag) {
        const tags = parseJsonSafe<string[]>(row.tags_json, []).map((t) => t.toLowerCase());
        if (!tags.some((t) => t.includes(tag))) return false;
      }
      if (search) {
        const hay = `${row.name} ${row.target} ${row.protocol} ${row.tags_json}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    const total = filtered.length;
    const offset = (page - 1) * limit;
    const paged = filtered.slice(offset, offset + limit).map((r) => formatMonitor(db, r));

    const summary = {
      total: allRows.length,
      up: allRows.filter((r) => r.status === 'UP').length,
      degraded: allRows.filter((r) => r.status === 'DEGRADED').length,
      down: allRows.filter((r) => r.status === 'DOWN').length,
      paused: allRows.filter((r) => r.status === 'PAUSED' || !r.enabled).length,
      maintenance: allRows.filter((r) => r.status === 'MAINTENANCE').length,
    };

    res.json({
      items: paged,
      total,
      page,
      limit,
      total_pages: Math.max(1, Math.ceil(total / limit)),
      summary,
    });
  });

  router.post('/test', requireAuth, requireAdmin, async (req, res) => {
    try {
      const cfg = validateMonitorPayload({ name: req.body?.name || 'Test Target', ...req.body });
      const result = await executeProbe({
        protocol: cfg.protocol,
        target: cfg.target,
        http_method: cfg.http_method,
        port: cfg.port,
        dns_record_type: cfg.dns_record_type,
        expected_status: cfg.expected_status,
        expected_keyword: cfg.expected_keyword,
        expected_dns_answer: cfg.expected_dns_answer,
        headers: parseJsonSafe(cfg.headers_json, {}),
        timeout_ms: cfg.timeout_ms,
        ssl_warning_days: cfg.ssl_warning_days,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ detail: err instanceof Error ? err.message : 'Invalid probe configuration' });
    }
  });

  router.post('/', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    try {
      const validated = validateMonitorPayload(req.body || {});
      const dup = db
        .prepare('SELECT id FROM monitors WHERE lower(target) = lower(?) AND protocol = ? AND COALESCE(port, 0) = COALESCE(?, 0)')
        .get(validated.target, validated.protocol, validated.port);
      if (dup) {
        res.status(409).json({
          detail: `Duplicate monitor: ${validated.protocol} monitor for "${validated.target}" already exists.`,
        });
        return;
      }

      const id = `mon-${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO monitors (
          id, name, target, protocol, http_method, port, dns_record_type,
          expected_status, expected_keyword, expected_dns_answer, headers_json,
          interval_sec, timeout_ms, retry_threshold, ssl_warning_days,
          status, enabled, is_public, tags_json, created_by, created_at, updated_at
        ) VALUES (
          @id, @name, @target, @protocol, @http_method, @port, @dns_record_type,
          @expected_status, @expected_keyword, @expected_dns_answer, @headers_json,
          @interval_sec, @timeout_ms, @retry_threshold, @ssl_warning_days,
          @status, @enabled, @is_public, @tags_json, @created_by, @now, @now
        )
      `).run({
        ...validated,
        id,
        status: validated.enabled ? 'UP' : 'PAUSED',
        created_by: req.user!.id,
        now,
      });

      writeAuditLog(db, {
        user_id: req.user!.id,
        user_email: req.user!.email,
        user_role: req.user!.role,
        action: 'MONITOR_CREATED',
        resource_type: 'monitor',
        resource_id: id,
        details: { name: validated.name, protocol: validated.protocol, target: validated.target },
        ip_address: req.ip || '127.0.0.1',
      });

      if (validated.enabled && req.body?.run_initial_check !== false) {
        await runMonitorCheck(db, id, { manual: true });
      }

      const created = db.prepare('SELECT * FROM monitors WHERE id = ?').get(id) as Record<string, unknown>;
      telemetryWs.broadcast({ event: 'MONITOR_UPDATED', monitor_id: id, action: 'created' });
      res.status(201).json(formatMonitor(db, created));
    } catch (err) {
      res.status(400).json({ detail: err instanceof Error ? err.message : 'Failed to create monitor' });
    }
  });

  router.post('/bulk', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    const action = String(req.body?.action || '').toLowerCase();
    if (ids.length === 0 || !['pause', 'resume', 'delete', 'check'].includes(action)) {
      res.status(400).json({ detail: 'Valid monitor ids and action (pause|resume|delete|check) are required.' });
      return;
    }

    const now = new Date().toISOString();
    if (action === 'pause') {
      const stmt = db.prepare("UPDATE monitors SET enabled = 0, status = 'PAUSED', updated_at = ? WHERE id = ?");
      for (const id of ids) stmt.run(now, id);
    } else if (action === 'resume') {
      const stmt = db.prepare("UPDATE monitors SET enabled = 1, status = 'UP', updated_at = ? WHERE id = ?");
      for (const id of ids) stmt.run(now, id);
    } else if (action === 'delete') {
      const stmt = db.prepare('DELETE FROM monitors WHERE id = ?');
      for (const id of ids) stmt.run(id);
    } else if (action === 'check') {
      await Promise.allSettled(ids.map((id: string) => runMonitorCheck(db, id, { manual: true })));
    }

    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: `MONITOR_BULK_${action.toUpperCase()}`,
      resource_type: 'monitor',
      details: { count: ids.length, ids },
      ip_address: req.ip || '127.0.0.1',
    });
    telemetryWs.broadcast({ event: 'MONITOR_UPDATED', action: `bulk_${action}`, ids });
    res.json({ message: `Bulk action "${action}" completed for ${ids.length} monitor(s).` });
  });

  router.get('/:id/export.csv', requireAuth, (req, res) => {
    const monitor = db.prepare('SELECT id, name FROM monitors WHERE id = ?').get(req.params.id) as
      | { id: string; name: string }
      | undefined;
    if (!monitor) {
      res.status(404).json({ detail: 'Monitor not found.' });
      return;
    }
    const checks = db
      .prepare('SELECT checked_at, status, response_time_ms, status_code, error_message FROM monitor_checks WHERE monitor_id = ? ORDER BY checked_at DESC LIMIT 1000')
      .all(monitor.id) as Array<Record<string, unknown>>;

    const header = 'checked_at,status,response_time_ms,status_code,error_message\n';
    const lines = checks.map((c) =>
      [c.checked_at, c.status, c.response_time_ms, c.status_code ?? '', `"${String(c.error_message || '').replace(/"/g, '""')}"`].join(','),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="monitor-${monitor.id}-checks.csv"`);
    res.send(header + lines.join('\n'));
  });

  router.get('/:id', requireAuth, (req, res) => {
    const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!monitor) {
      res.status(404).json({ detail: 'Monitor not found.' });
      return;
    }

    const range = String(req.query.range || '24h').toLowerCase();
    const hoursMap: Record<string, number> = { '24h': 24, '7d': 168, '30d': 720, '90d': 2160 };
    const hours = hoursMap[range] || 24;
    const sinceIso = new Date(Date.now() - hours * 3600_000).toISOString();

    const checks = db
      .prepare('SELECT * FROM monitor_checks WHERE monitor_id = ? AND checked_at >= ? ORDER BY checked_at DESC LIMIT 250')
      .all(monitor.id, sinceIso) as Array<Record<string, unknown>>;

    const calcUptime = (windowHours: number) => {
      const cutoff = new Date(Date.now() - windowHours * 3600_000).toISOString();
      const row = db
        .prepare(
          `SELECT COUNT(*) as total, SUM(CASE WHEN status = 'UP' THEN 1 ELSE 0 END) as up_count
           FROM monitor_checks WHERE monitor_id = ? AND checked_at >= ?`,
        )
        .get(monitor.id, cutoff) as { total: number; up_count: number | null };
      if (!row || row.total === 0) return monitor.status === 'DOWN' ? 0 : 100;
      return Math.round(((row.up_count || 0) / row.total) * 10000) / 100;
    };

    const latencies = checks.map((c) => Number(c.response_time_ms)).sort((a, b) => a - b);
    const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : 0;
    const p95 = latencies.length > 0 ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : 0;
    const avgLatency =
      latencies.length > 0 ? Math.round((latencies.reduce((s, n) => s + n, 0) / latencies.length) * 10) / 10 : 0;

    const errors = db
      .prepare("SELECT * FROM monitor_checks WHERE monitor_id = ? AND status != 'UP' ORDER BY checked_at DESC LIMIT 50")
      .all(monitor.id) as Array<Record<string, unknown>>;

    const incidents = db
      .prepare('SELECT * FROM incidents WHERE monitor_id = ? ORDER BY started_at DESC LIMIT 30')
      .all(monitor.id) as Array<Record<string, unknown>>;

    // 90-day daily availability bars
    const dailyRows = db
      .prepare(
        `SELECT substr(checked_at, 1, 10) as day,
                COUNT(*) as total,
                SUM(CASE WHEN status = 'UP' THEN 1 ELSE 0 END) as up_cnt
         FROM monitor_checks
         WHERE monitor_id = ? AND checked_at >= datetime('now', '-90 days')
         GROUP BY day
         ORDER BY day ASC`,
      )
      .all(monitor.id) as Array<{ day: string; total: number; up_cnt: number }>;

    res.json({
      monitor: formatMonitor(db, monitor),
      availability: {
        '24h': calcUptime(24),
        '7d': calcUptime(168),
        '30d': calcUptime(720),
        '90d': calcUptime(2160),
      },
      latency_stats: { avg_ms: avgLatency, p50_ms: p50, p95_ms: p95 },
      checks: checks.map((c) => ({ ...c, details: parseJsonSafe(c.details_json, {}) })),
      errors,
      incidents,
      daily_bars: dailyRows.map((d) => ({
        day: d.day,
        uptime_pct: d.total > 0 ? Math.round((d.up_cnt / d.total) * 10000) / 100 : 100,
      })),
    });
  });

  router.put('/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const existing = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ detail: 'Monitor not found.' });
      return;
    }

    try {
      const validated = validateMonitorPayload({
        ...existing,
        headers: parseJsonSafe(existing.headers_json, {}),
        tags: parseJsonSafe(existing.tags_json, []),
        ...req.body,
      });

      const dup = db
        .prepare(
          'SELECT id FROM monitors WHERE lower(target) = lower(?) AND protocol = ? AND COALESCE(port, 0) = COALESCE(?, 0) AND id != ?',
        )
        .get(validated.target, validated.protocol, validated.port, req.params.id);
      if (dup) {
        res.status(409).json({ detail: 'Another monitor with the same protocol, target, and port already exists.' });
        return;
      }

      const now = new Date().toISOString();
      const nextStatus = validated.enabled ? (existing.status === 'PAUSED' ? 'UP' : existing.status) : 'PAUSED';
      db.prepare(`
        UPDATE monitors SET
          name = @name,
          target = @target,
          protocol = @protocol,
          http_method = @http_method,
          port = @port,
          dns_record_type = @dns_record_type,
          expected_status = @expected_status,
          expected_keyword = @expected_keyword,
          expected_dns_answer = @expected_dns_answer,
          headers_json = @headers_json,
          interval_sec = @interval_sec,
          timeout_ms = @timeout_ms,
          retry_threshold = @retry_threshold,
          ssl_warning_days = @ssl_warning_days,
          enabled = @enabled,
          is_public = @is_public,
          tags_json = @tags_json,
          status = @status,
          updated_at = @now
        WHERE id = @id
      `).run({ ...validated, id: req.params.id, status: nextStatus, now });

      writeAuditLog(db, {
        user_id: req.user!.id,
        user_email: req.user!.email,
        user_role: req.user!.role,
        action: 'MONITOR_UPDATED',
        resource_type: 'monitor',
        resource_id: req.params.id,
        ip_address: req.ip || '127.0.0.1',
      });

      const updated = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id) as Record<string, unknown>;
      telemetryWs.broadcast({ event: 'MONITOR_UPDATED', monitor_id: req.params.id, action: 'updated' });
      res.json(formatMonitor(db, updated));
    } catch (err) {
      res.status(400).json({ detail: err instanceof Error ? err.message : 'Failed to update monitor' });
    }
  });

  router.delete('/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const existing = db.prepare('SELECT id, name FROM monitors WHERE id = ?').get(req.params.id) as
      | { id: string; name: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ detail: 'Monitor not found.' });
      return;
    }
    db.prepare('DELETE FROM monitors WHERE id = ?').run(existing.id);
    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: 'MONITOR_DELETED',
      resource_type: 'monitor',
      resource_id: existing.id,
      details: { name: existing.name },
      ip_address: req.ip || '127.0.0.1',
    });
    telemetryWs.broadcast({ event: 'MONITOR_UPDATED', monitor_id: existing.id, action: 'deleted' });
    res.json({ message: `Monitor "${existing.name}" deleted.` });
  });

  router.post('/:id/toggle-pause', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const existing = db.prepare('SELECT * FROM monitors WHERE id = ?').get(req.params.id) as
      | { id: string; name: string; enabled: number; status: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ detail: 'Monitor not found.' });
      return;
    }
    const nextEnabled = existing.enabled ? 0 : 1;
    const nextStatus = nextEnabled ? 'UP' : 'PAUSED';
    const now = new Date().toISOString();
    db.prepare('UPDATE monitors SET enabled = ?, status = ?, updated_at = ? WHERE id = ?').run(
      nextEnabled,
      nextStatus,
      now,
      existing.id,
    );

    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: nextEnabled ? 'MONITOR_RESUMED' : 'MONITOR_PAUSED',
      resource_type: 'monitor',
      resource_id: existing.id,
      ip_address: req.ip || '127.0.0.1',
    });

    const updated = db.prepare('SELECT * FROM monitors WHERE id = ?').get(existing.id) as Record<string, unknown>;
    telemetryWs.broadcast({ event: 'MONITOR_UPDATED', monitor_id: existing.id, status: nextStatus });
    res.json(formatMonitor(db, updated));
  });

  router.post('/:id/check-now', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const existing = db.prepare('SELECT id FROM monitors WHERE id = ?').get(req.params.id);
    if (!existing) {
      res.status(404).json({ detail: 'Monitor not found.' });
      return;
    }
    const result = await runMonitorCheck(db, req.params.id, { manual: true });
    if (!result) {
      res.status(409).json({ detail: 'A probe check for this monitor is already in progress.' });
      return;
    }
    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: 'MONITOR_MANUAL_CHECK',
      resource_type: 'monitor',
      resource_id: req.params.id,
      details: { status: result.status, response_time_ms: result.response_time_ms },
      ip_address: req.ip || '127.0.0.1',
    });
    res.json(result);
  });

  return router;
}
