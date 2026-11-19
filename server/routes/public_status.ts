import crypto from 'node:crypto';
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { createRateLimiter, isPrivateOrReservedIp } from '../core/security.ts';

function isPublicSafeHost(target: string): boolean {
  const lower = target.toLowerCase();
  if (lower.includes('.internal') || lower.includes('.local') || lower.includes('localhost')) {
    return false;
  }
  const bare = lower.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
  if (isPrivateOrReservedIp(bare)) return false;
  return true;
}

export function createPublicStatusRouter(db: Database.Database): Router {
  const router = Router();
  const publicLimiter = createRateLimiter(60_000, 120, 'public-status');
  const subscribeLimiter = createRateLimiter(60_000, 15, 'public-subscribe');

  router.get('/status', publicLimiter, (req, res) => {
    const cfgRow = db.prepare("SELECT config_json FROM system_settings WHERE category = 'public_status'").get() as
      | { config_json: string }
      | undefined;
    const portalCfg = cfgRow ? (JSON.parse(cfgRow.config_json) as Record<string, unknown>) : {};

    // Strictly expose ONLY monitors flagged is_public = 1 and strip private targets/credentials/internal payloads
    const rawMonitors = db
      .prepare('SELECT id, name, protocol, target, status, last_checked_at, last_response_time_ms, ssl_days_remaining, ssl_valid FROM monitors WHERE is_public = 1 ORDER BY created_at ASC')
      .all() as Array<{
      id: string;
      name: string;
      protocol: string;
      target: string;
      status: string;
      last_checked_at: string | null;
      last_response_time_ms: number | null;
      ssl_days_remaining: number | null;
      ssl_valid: number | null;
    }>;

    const services = rawMonitors.map((m) => {
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
        .all(m.id) as Array<{ day: string; total: number; up_cnt: number }>;

      const totalChecks = dailyRows.reduce((s, d) => s + d.total, 0);
      const upChecks = dailyRows.reduce((s, d) => s + d.up_cnt, 0);
      const uptimePct = totalChecks > 0 ? Math.round((upChecks / totalChecks) * 10000) / 100 : m.status === 'DOWN' ? 0 : 100;

      // Sanitize endpoint label so private IPs/internal hostnames are never leaked
      let publicEndpointLabel = `${m.protocol} Service`;
      if (isPublicSafeHost(m.target)) {
        try {
          if (m.target.startsWith('http')) {
            publicEndpointLabel = new URL(m.target).hostname;
          } else {
            publicEndpointLabel = m.target.split('/')[0];
          }
        } catch {
          publicEndpointLabel = `${m.protocol} Endpoint`;
        }
      }

      return {
        id: m.id,
        name: m.name,
        protocol: m.protocol,
        public_endpoint: publicEndpointLabel,
        status: m.status,
        uptime_90d_pct: uptimePct,
        latency_ms: portalCfg.show_latency_metrics !== false ? m.last_response_time_ms : null,
        last_checked_at: m.last_checked_at,
        ssl_days_remaining: m.protocol === 'SSL' || m.protocol === 'HTTPS' ? m.ssl_days_remaining : null,
        daily_bars: dailyRows.map((d) => ({
          day: d.day,
          status: d.up_cnt === d.total ? 'UP' : d.up_cnt > 0 ? 'DEGRADED' : 'DOWN',
          uptime_pct: d.total > 0 ? Math.round((d.up_cnt / d.total) * 10000) / 100 : 100,
        })),
      };
    });

    const activeIncidentsRaw = db
      .prepare(
        `SELECT i.id, i.code, i.title, i.severity, i.status, i.summary, i.started_at, i.updated_at, m.name as service_name
         FROM incidents i
         LEFT JOIN monitors m ON m.id = i.monitor_id
         WHERE i.sync_public_status = 1 AND i.status != 'Resolved'
         ORDER BY i.started_at DESC`,
      )
      .all() as Array<Record<string, unknown>>;

    const resolvedIncidentsRaw =
      portalCfg.show_resolved_incidents !== false
        ? (db
            .prepare(
              `SELECT i.id, i.code, i.title, i.severity, i.status, i.summary, i.started_at, i.resolved_at, m.name as service_name
               FROM incidents i
               LEFT JOIN monitors m ON m.id = i.monitor_id
               WHERE i.sync_public_status = 1 AND i.status = 'Resolved'
               ORDER BY i.resolved_at DESC LIMIT 10`,
            )
            .all() as Array<Record<string, unknown>>)
        : [];

    const attachPublicNotes = (inc: Record<string, unknown>) => {
      const notes = db
        .prepare('SELECT phase, message, created_at FROM incident_notes WHERE incident_id = ? ORDER BY created_at ASC')
        .all(inc.id);
      return { ...inc, timeline: notes };
    };

    const maintenanceWindows = db
      .prepare(
        `SELECT id, code, title, description, expected_impact, start_time, end_time, status
         FROM maintenance_windows
         WHERE status IN ('UPCOMING', 'ACTIVE')
         ORDER BY start_time ASC`,
      )
      .all() as Array<Record<string, unknown>>;

    const hasOutage = services.some((s) => s.status === 'DOWN') || activeIncidentsRaw.length > 0;
    const hasDegraded = services.some((s) => s.status === 'DEGRADED' || s.status === 'MAINTENANCE');
    const overallStatus = hasOutage ? 'OUTAGE' : hasDegraded ? 'DEGRADED' : 'OPERATIONAL';

    const subCount = (db.prepare('SELECT COUNT(*) as cnt FROM status_subscribers').get() as { cnt: number }).cnt;

    res.json({
      portal: {
        title: portalCfg.portal_title || 'VigilNode System Status',
        subtitle:
          portalCfg.portal_subtitle ||
          'Continuous automated multi-protocol availability monitoring across HTTP/S, TCP, DNS & SSL endpoints',
        custom_domain: portalCfg.custom_domain || 'status.vigilnode.local',
        allow_subscriptions: portalCfg.allow_subscriptions !== false,
        sla_target_pct: portalCfg.sla_target_pct ?? 99.9,
      },
      overall_status: overallStatus,
      operational_count: services.filter((s) => s.status === 'UP').length,
      degraded_count: services.filter((s) => s.status === 'DEGRADED' || s.status === 'MAINTENANCE').length,
      outage_count: services.filter((s) => s.status === 'DOWN').length,
      total_public_services: services.length,
      subscriber_count: subCount,
      services,
      active_incidents: activeIncidentsRaw.map(attachPublicNotes),
      resolved_incidents: resolvedIncidentsRaw.map(attachPublicNotes),
      maintenance_windows: maintenanceWindows,
      generated_at: new Date().toISOString(),
    });
  });

  router.post('/subscribe', subscribeLimiter, (req, res) => {
    const channel = String(req.body?.channel || 'email').toLowerCase();
    const destination = String(req.body?.destination || req.body?.email || '').trim();

    if (!destination) {
      res.status(400).json({ detail: 'Subscription email or handle is required.' });
      return;
    }
    if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) {
      res.status(400).json({ detail: 'Please provide a valid email address.' });
      return;
    }

    const existing = db.prepare('SELECT id FROM status_subscribers WHERE lower(destination) = lower(?)').get(destination);
    if (existing) {
      res.json({ message: 'You are already subscribed to VigilNode status updates.', already_subscribed: true });
      return;
    }

    const id = `sub-${crypto.randomUUID().slice(0, 8)}`;
    const token = crypto.randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO status_subscribers (id, channel, destination, verified, unsubscribe_token, created_at) VALUES (?, ?, ?, 1, ?, ?)',
    ).run(id, channel, destination, token, now);

    res.status(201).json({
      id,
      channel,
      destination,
      unsubscribe_token: token,
      message: `Subscribed ${destination} to live VigilNode status updates.`,
    });
  });

  router.post('/unsubscribe', subscribeLimiter, (req, res) => {
    const token = String(req.body?.token || '').trim();
    if (!token) {
      res.status(400).json({ detail: 'Unsubscribe token is required.' });
      return;
    }
    const deleted = db.prepare('DELETE FROM status_subscribers WHERE unsubscribe_token = ?').run(token);
    if (deleted.changes === 0) {
      res.status(404).json({ detail: 'Subscription not found or already removed.' });
      return;
    }
    res.json({ message: 'Unsubscribed successfully.' });
  });

  return router;
}
