import { Router } from 'express';
import type Database from 'better-sqlite3';
import { requireAuth } from '../core/security.ts';

function getWindowHours(range: string): number {
  const map: Record<string, number> = { '24h': 24, '7d': 168, '30d': 720, '90d': 2160 };
  return map[range.toLowerCase()] || 720;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return Math.round(sorted[idx] * 10) / 10;
}

export function createAnalyticsDashboardRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/dashboard', requireAuth, (req, res) => {
    const range = String(req.query.range || '30d');
    const hours = getWindowHours(range);
    const sinceIso = new Date(Date.now() - hours * 3600_000).toISOString();

    const monitors = db.prepare('SELECT * FROM monitors ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
    const total = monitors.length;
    const up = monitors.filter((m) => m.status === 'UP').length;
    const down = monitors.filter((m) => m.status === 'DOWN').length;
    const degraded = monitors.filter((m) => m.status === 'DEGRADED').length;
    const paused = monitors.filter((m) => m.status === 'PAUSED' || !m.enabled).length;
    const maintenance = monitors.filter((m) => m.status === 'MAINTENANCE').length;

    const checks = db
      .prepare('SELECT status, response_time_ms, checked_at FROM monitor_checks WHERE checked_at >= ? ORDER BY checked_at ASC')
      .all(sinceIso) as Array<{ status: string; response_time_ms: number; checked_at: string }>;

    const checkTotal = checks.length;
    const checkUp = checks.filter((c) => c.status === 'UP').length;
    const overallUptime = checkTotal > 0 ? Math.round((checkUp / checkTotal) * 10000) / 100 : 100;

    const latencies = checks.map((c) => Number(c.response_time_ms)).sort((a, b) => a - b);
    const avgLatency =
      latencies.length > 0 ? Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 10) / 10 : 0;
    const minLatency = latencies.length > 0 ? Math.round(latencies[0] * 10) / 10 : 0;
    const maxLatency = latencies.length > 0 ? Math.round(latencies[latencies.length - 1] * 10) / 10 : 0;

    // Protocol distribution
    const protocols = ['HTTPS', 'HTTP', 'TCP', 'DNS', 'SSL'];
    const protocolDistribution = protocols.map((proto) => {
      const pMonitors = monitors.filter((m) => m.protocol === proto);
      const pChecks = db
        .prepare(
          `SELECT mc.status FROM monitor_checks mc
           JOIN monitors m ON m.id = mc.monitor_id
           WHERE m.protocol = ? AND mc.checked_at >= ?`,
        )
        .all(proto, sinceIso) as Array<{ status: string }>;
      const pUp = pChecks.filter((c) => c.status === 'UP').length;
      const avail = pChecks.length > 0 ? Math.round((pUp / pChecks.length) * 10000) / 100 : 100;
      return {
        protocol: proto,
        count: pMonitors.length,
        up_count: pMonitors.filter((m) => m.status === 'UP').length,
        availability_pct: avail,
      };
    });

    // Time-series buckets (last 24 points)
    const bucketRows = db
      .prepare(
        `SELECT substr(checked_at, 1, 13) as bucket,
                COUNT(*) as total,
                SUM(CASE WHEN status = 'UP' THEN 1 ELSE 0 END) as up_cnt,
                AVG(response_time_ms) as avg_ms
         FROM monitor_checks
         WHERE checked_at >= ?
         GROUP BY bucket
         ORDER BY bucket ASC`,
      )
      .all(sinceIso) as Array<{ bucket: string; total: number; up_cnt: number; avg_ms: number }>;

    const recentIncidents = db
      .prepare(
        `SELECT i.*, m.name as monitor_name, m.protocol as monitor_protocol
         FROM incidents i
         LEFT JOIN monitors m ON m.id = i.monitor_id
         ORDER BY i.started_at DESC LIMIT 8`,
      )
      .all() as Array<Record<string, unknown>>;

    const recentChecks = db
      .prepare(
        `SELECT mc.*, m.name as monitor_name, m.protocol as monitor_protocol, m.target as monitor_target
         FROM monitor_checks mc
         JOIN monitors m ON m.id = mc.monitor_id
         ORDER BY mc.checked_at DESC LIMIT 15`,
      )
      .all() as Array<Record<string, unknown>>;

    const sslMonitors = monitors.filter((m) => m.ssl_expires_at !== null);
    const sslWarnings = sslMonitors.filter((m) => Number(m.ssl_days_remaining ?? 999) <= Number(m.ssl_warning_days ?? 14));

    res.json({
      range,
      summary: {
        total_monitors: total,
        up_monitors: up,
        down_monitors: down,
        degraded_monitors: degraded,
        paused_monitors: paused,
        maintenance_monitors: maintenance,
        overall_uptime_pct: overallUptime,
        avg_response_time_ms: avgLatency,
        p50_latency_ms: percentile(latencies, 0.5),
        p95_latency_ms: percentile(latencies, 0.95),
        min_latency_ms: minLatency,
        max_latency_ms: maxLatency,
        active_incidents: recentIncidents.filter((i) => i.status !== 'Resolved').length,
        ssl_total: sslMonitors.length,
        ssl_warnings: sslWarnings.map((m) => ({ id: m.id, name: m.name, days_remaining: m.ssl_days_remaining })),
      },
      monitors_preview: monitors.slice(0, 6).map((m) => ({
        id: m.id,
        name: m.name,
        target: m.target,
        protocol: m.protocol,
        status: m.status,
        last_response_time_ms: m.last_response_time_ms,
        last_checked_at: m.last_checked_at,
      })),
      protocol_distribution: protocolDistribution,
      response_series: bucketRows.slice(-24).map((b) => ({
        bucket: b.bucket,
        avg_ms: Math.round((b.avg_ms || 0) * 10) / 10,
        availability_pct: b.total > 0 ? Math.round((b.up_cnt / b.total) * 10000) / 100 : 100,
      })),
      recent_incidents: recentIncidents,
      recent_checks: recentChecks,
    });
  });

  router.get('/analytics', requireAuth, (req, res) => {
    const range = String(req.query.range || '30d');
    const hours = getWindowHours(range);
    const sinceIso = new Date(Date.now() - hours * 3600_000).toISOString();

    const allChecks = db
      .prepare('SELECT status, response_time_ms, error_message, checked_at FROM monitor_checks WHERE checked_at >= ? ORDER BY checked_at ASC')
      .all(sinceIso) as Array<{ status: string; response_time_ms: number; error_message: string; checked_at: string }>;

    const latencies = allChecks.map((c) => Number(c.response_time_ms)).sort((a, b) => a - b);
    const avgMs =
      latencies.length > 0 ? Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 10) / 10 : 0;

    const windowSummary = (wHours: number) => {
      const cutoff = new Date(Date.now() - wHours * 3600_000).toISOString();
      const rows = db
        .prepare('SELECT status FROM monitor_checks WHERE checked_at >= ?')
        .all(cutoff) as Array<{ status: string }>;
      const incCount = (
        db.prepare('SELECT COUNT(*) as cnt FROM incidents WHERE started_at >= ?').get(cutoff) as { cnt: number }
      ).cnt;
      const total = rows.length;
      const up = rows.filter((r) => r.status === 'UP').length;
      const down = total - up;
      return {
        uptime_pct: total > 0 ? Math.round((up / total) * 10000) / 100 : 100,
        checks_total: total,
        failed_checks: down,
        incidents_count: incCount,
      };
    };

    const protocols = ['HTTPS', 'HTTP', 'TCP', 'DNS', 'SSL'];
    const protocolStats = protocols.map((proto) => {
      const rows = db
        .prepare(
          `SELECT mc.status, mc.response_time_ms
           FROM monitor_checks mc
           JOIN monitors m ON m.id = mc.monitor_id
           WHERE m.protocol = ? AND mc.checked_at >= ?`,
        )
        .all(proto, sinceIso) as Array<{ status: string; response_time_ms: number }>;
      const lats = rows.map((r) => Number(r.response_time_ms)).sort((a, b) => a - b);
      const upCnt = rows.filter((r) => r.status === 'UP').length;
      return {
        protocol: proto,
        total_checks: rows.length,
        failed_checks: rows.length - upCnt,
        uptime_pct: rows.length > 0 ? Math.round((upCnt / rows.length) * 10000) / 100 : 100,
        p50_ms: percentile(lats, 0.5),
        p95_ms: percentile(lats, 0.95),
      };
    });

    // Daily trend series
    const dailySeries = db
      .prepare(
        `SELECT substr(checked_at, 1, 10) as day,
                COUNT(*) as total,
                SUM(CASE WHEN status = 'UP' THEN 1 ELSE 0 END) as up_cnt,
                AVG(response_time_ms) as avg_ms
         FROM monitor_checks
         WHERE checked_at >= ?
         GROUP BY day
         ORDER BY day ASC`,
      )
      .all(sinceIso) as Array<{ day: string; total: number; up_cnt: number; avg_ms: number }>;

    // Incident MTTA & MTTR
    const incRows = db
      .prepare('SELECT started_at, acknowledged_at, resolved_at FROM incidents WHERE started_at >= ?')
      .all(sinceIso) as Array<{ started_at: string; acknowledged_at: string | null; resolved_at: string | null }>;
    const acks = incRows
      .filter((i) => i.acknowledged_at)
      .map((i) => (new Date(i.acknowledged_at!).getTime() - new Date(i.started_at).getTime()) / 1000);
    const resolves = incRows
      .filter((i) => i.resolved_at)
      .map((i) => (new Date(i.resolved_at!).getTime() - new Date(i.started_at).getTime()) / 1000);
    const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

    // Flapping / unstable monitors (state transitions in checks)
    const monitors = db.prepare('SELECT id, name, target, protocol, status, last_error FROM monitors').all() as Array<{
      id: string;
      name: string;
      target: string;
      protocol: string;
      status: string;
      last_error: string;
    }>;

    const unstable = monitors
      .map((m) => {
        const mChecks = db
          .prepare('SELECT status, error_message FROM monitor_checks WHERE monitor_id = ? AND checked_at >= ? ORDER BY checked_at ASC')
          .all(m.id, sinceIso) as Array<{ status: string; error_message: string }>;
        let transitions = 0;
        for (let i = 1; i < mChecks.length; i++) {
          if (mChecks[i].status !== mChecks[i - 1].status) transitions += 1;
        }
        const upCnt = mChecks.filter((c) => c.status === 'UP').length;
        const uptimePct = mChecks.length > 0 ? Math.round((upCnt / mChecks.length) * 10000) / 100 : 100;
        const failedCheck = mChecks.find((c) => c.status !== 'UP');
        return {
          ...m,
          transitions,
          failed_checks: mChecks.length - upCnt,
          uptime_pct: uptimePct,
          predominant_error: failedCheck?.error_message || m.last_error || 'Nominal',
        };
      })
      .sort((a, b) => b.transitions - a.transitions || b.failed_checks - a.failed_checks);

    res.json({
      range,
      overview: {
        overall_uptime_pct:
          allChecks.length > 0
            ? Math.round((allChecks.filter((c) => c.status === 'UP').length / allChecks.length) * 10000) / 100
            : 100,
        avg_response_ms: avgMs,
        p50_ms: percentile(latencies, 0.5),
        p95_ms: percentile(latencies, 0.95),
        mtta_sec: avg(acks),
        mttr_sec: avg(resolves),
        total_checks: allChecks.length,
        total_failures: allChecks.filter((c) => c.status !== 'UP').length,
      },
      windows: {
        '24h': windowSummary(24),
        '7d': windowSummary(168),
        '30d': windowSummary(720),
        '90d': windowSummary(2160),
      },
      protocol_stats: protocolStats,
      daily_series: dailySeries.map((d) => ({
        day: d.day,
        uptime_pct: d.total > 0 ? Math.round((d.up_cnt / d.total) * 10000) / 100 : 100,
        avg_ms: Math.round((d.avg_ms || 0) * 10) / 10,
        total_checks: d.total,
      })),
      unstable_monitors: unstable.slice(0, 8),
    });
  });

  router.get('/analytics/export.csv', requireAuth, (req, res) => {
    const rows = db
      .prepare(
        `SELECT m.name, m.protocol, COUNT(mc.id) as total_checks,
                SUM(CASE WHEN mc.status = 'UP' THEN 1 ELSE 0 END) as up_checks,
                ROUND(AVG(mc.response_time_ms), 2) as avg_ms
         FROM monitors m
         LEFT JOIN monitor_checks mc ON mc.monitor_id = m.id
         GROUP BY m.id`,
      )
      .all() as Array<Record<string, unknown>>;

    const header = 'monitor_name,protocol,total_checks,up_checks,uptime_pct,avg_response_ms\n';
    const lines = rows.map((r) => {
      const total = Number(r.total_checks || 0);
      const up = Number(r.up_checks || 0);
      const pct = total > 0 ? ((up / total) * 100).toFixed(2) : '100.00';
      return [`"${String(r.name).replace(/"/g, '""')}"`, r.protocol, total, up, pct, r.avg_ms ?? 0].join(',');
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="vigilnode-availability-report.csv"');
    res.send(header + lines.join('\n'));
  });

  return router;
}
