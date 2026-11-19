import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { config } from '../core/config.ts';
import { dispatchAlertForEvent } from '../notifications/dispatcher.ts';
import { telemetryWs } from '../ws.ts';
import { executeProbe, type ProbeResult } from './prober.ts';

export interface MonitorRow {
  id: string;
  name: string;
  target: string;
  protocol: 'HTTP' | 'HTTPS' | 'TCP' | 'DNS' | 'SSL';
  http_method: string;
  port: number | null;
  dns_record_type: string | null;
  expected_status: string | null;
  expected_keyword: string | null;
  expected_dns_answer: string | null;
  headers_json: string;
  interval_sec: number;
  timeout_ms: number;
  retry_threshold: number;
  ssl_warning_days: number;
  status: 'UP' | 'DEGRADED' | 'DOWN' | 'PAUSED' | 'MAINTENANCE';
  enabled: number;
  is_public: number;
  tags_json: string;
  consecutive_failures: number;
  consecutive_successes: number;
  last_checked_at: string | null;
  last_response_time_ms: number | null;
  last_error: string | null;
}

const activeProbes = new Set<string>();
let schedulerTimer: NodeJS.Timeout | null = null;

export function isMonitorInActiveMaintenance(db: Database.Database, monitorId: string, nowIso: string): boolean {
  // Automatically transition UPCOMING -> ACTIVE and ACTIVE -> COMPLETED based on timestamps
  db.prepare(`
    UPDATE maintenance_windows
    SET status = 'ACTIVE', updated_at = ?
    WHERE status = 'UPCOMING' AND start_time <= ? AND end_time > ?
  `).run(nowIso, nowIso, nowIso);

  db.prepare(`
    UPDATE maintenance_windows
    SET status = 'COMPLETED', updated_at = ?
    WHERE status IN ('UPCOMING', 'ACTIVE') AND end_time <= ?
  `).run(nowIso, nowIso);

  const row = db.prepare(`
    SELECT mw.id FROM maintenance_windows mw
    JOIN maintenance_monitors mm ON mm.maintenance_id = mw.id
    WHERE mm.monitor_id = ?
      AND mw.status = 'ACTIVE'
      AND mw.suppress_alerts = 1
      AND mw.start_time <= ?
      AND mw.end_time > ?
    LIMIT 1
  `).get(monitorId, nowIso, nowIso);

  return Boolean(row);
}

export async function runMonitorCheck(
  db: Database.Database,
  monitorId: string,
  options: { manual?: boolean; proberFn?: typeof executeProbe } = {},
): Promise<{
  monitor_id: string;
  monitor_name: string;
  status: string;
  response_time_ms: number;
  status_code: number | null;
  error_message: string;
  suppressed_by_maintenance: boolean;
  incident_id: string | null;
} | null> {
  if (activeProbes.has(monitorId)) {
    return null;
  }
  const monitor = db.prepare('SELECT * FROM monitors WHERE id = ?').get(monitorId) as MonitorRow | undefined;
  if (!monitor) return null;
  if (!monitor.enabled && !options.manual) return null;

  activeProbes.add(monitorId);
  try {
    let headers: Record<string, string> = {};
    try {
      headers = JSON.parse(monitor.headers_json || '{}');
    } catch {
      headers = {};
    }

    const probeExecutor = options.proberFn || executeProbe;
    const result: ProbeResult = await probeExecutor({
      protocol: monitor.protocol,
      target: monitor.target,
      http_method: monitor.http_method,
      port: monitor.port,
      dns_record_type: monitor.dns_record_type,
      expected_status: monitor.expected_status,
      expected_keyword: monitor.expected_keyword,
      expected_dns_answer: monitor.expected_dns_answer,
      headers,
      timeout_ms: monitor.timeout_ms,
      ssl_warning_days: monitor.ssl_warning_days,
    });

    const nowIso = new Date().toISOString();
    const inMaintenance = isMonitorInActiveMaintenance(db, monitor.id, nowIso);

    // Always record raw telemetry check even during maintenance!
    db.prepare(`
      INSERT INTO monitor_checks (monitor_id, status, response_time_ms, status_code, error_message, details_json, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      monitor.id,
      result.status,
      result.response_time_ms,
      result.status_code,
      result.error_message,
      JSON.stringify(result.details || {}),
      nowIso,
    );

    let nextConsecutiveFailures = monitor.consecutive_failures || 0;
    let nextConsecutiveSuccesses = monitor.consecutive_successes || 0;
    let nextMonitorStatus: MonitorRow['status'] = monitor.status;

    if (!monitor.enabled && options.manual) {
      nextMonitorStatus = 'PAUSED';
    } else if (result.status === 'DOWN') {
      nextConsecutiveFailures += 1;
      nextConsecutiveSuccesses = 0;
      if (inMaintenance) {
        nextMonitorStatus = 'MAINTENANCE';
      } else if (nextConsecutiveFailures >= (monitor.retry_threshold || 1)) {
        nextMonitorStatus = 'DOWN';
      } else {
        nextMonitorStatus = 'DEGRADED';
      }
    } else if (result.status === 'DEGRADED') {
      nextConsecutiveFailures = 0;
      nextConsecutiveSuccesses += 1;
      nextMonitorStatus = inMaintenance ? 'MAINTENANCE' : 'DEGRADED';
    } else {
      nextConsecutiveFailures = 0;
      nextConsecutiveSuccesses += 1;
      nextMonitorStatus = inMaintenance ? 'MAINTENANCE' : 'UP';
    }

    db.prepare(`
      UPDATE monitors SET
        status = ?,
        consecutive_failures = ?,
        consecutive_successes = ?,
        last_checked_at = ?,
        last_response_time_ms = ?,
        last_error = ?,
        ssl_expires_at = COALESCE(?, ssl_expires_at),
        ssl_days_remaining = COALESCE(?, ssl_days_remaining),
        ssl_issuer = COALESCE(?, ssl_issuer),
        ssl_subject = COALESCE(?, ssl_subject),
        ssl_valid = COALESCE(?, ssl_valid),
        updated_at = ?
      WHERE id = ?
    `).run(
      nextMonitorStatus,
      nextConsecutiveFailures,
      nextConsecutiveSuccesses,
      nowIso,
      result.response_time_ms,
      result.error_message,
      result.ssl?.expires_at ?? null,
      result.ssl?.days_remaining ?? null,
      result.ssl?.issuer ?? null,
      result.ssl?.subject ?? null,
      result.ssl ? (result.ssl.valid ? 1 : 0) : null,
      nowIso,
      monitor.id,
    );

    let activeIncidentId: string | null = null;
    const existingIncident = db
      .prepare("SELECT * FROM incidents WHERE monitor_id = ? AND status != 'Resolved' ORDER BY started_at DESC LIMIT 1")
      .get(monitor.id) as { id: string; code: string; status: string; title: string } | undefined;

    // Incident auto-creation & deduplication
    if (nextMonitorStatus === 'DOWN' && !inMaintenance) {
      if (!existingIncident) {
        const incId = `inc-${crypto.randomUUID().slice(0, 6)}`;
        const codeNum = Math.floor(9000 + Math.random() * 999);
        const code = `#INC-${codeNum}`;
        const incTitle = `${monitor.name} Outage — ${result.error_message || 'Check Failed'}`.slice(0, 140);
        db.prepare(`
          INSERT INTO incidents (id, code, monitor_id, title, severity, status, summary, root_cause, diagnostic_payload, assigned_to, sync_public_status, started_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'CRITICAL', 'Investigating', ?, '', ?, 'Shubham Bind', 1, ?, ?, ?)
        `).run(
          incId,
          code,
          monitor.id,
          incTitle,
          `Automated prober detected ${nextConsecutiveFailures} consecutive failures on ${monitor.protocol} target.`,
          JSON.stringify({
            protocol: monitor.protocol,
            status_code: result.status_code,
            error: result.error_message,
            response_time_ms: result.response_time_ms,
          }),
          nowIso,
          nowIso,
          nowIso,
        );
        db.prepare(`
          INSERT INTO incident_notes (incident_id, phase, message, author_name, author_role, is_system, created_at)
          VALUES (?, 'Investigating', ?, 'VigilNode Scheduler', 'SYSTEM', 1, ?)
        `).run(incId, `Auto-detected failure: ${result.error_message}`, nowIso);

        activeIncidentId = incId;
        telemetryWs.broadcast(
          {
            event: 'INCIDENT_CREATED',
            incident_id: incId,
            code,
            monitor_id: monitor.id,
            title: incTitle,
          },
          { publicSafe: Boolean(monitor.is_public) },
        );

        await dispatchAlertForEvent(
          db,
          {
            event_type: 'MONITOR_DOWN',
            severity: 'CRITICAL',
            title: incTitle,
            message: `Monitor "${monitor.name}" (${monitor.protocol}) failed: ${result.error_message}`,
            monitor_id: monitor.id,
            incident_id: incId,
          },
          false,
        );
      } else {
        activeIncidentId = existingIncident.id;
      }
    } else if (result.status === 'DOWN' && inMaintenance) {
      await dispatchAlertForEvent(
        db,
        {
          event_type: 'MONITOR_DOWN_MAINTENANCE',
          severity: 'INFO',
          title: `${monitor.name} check failed during maintenance`,
          message: result.error_message,
          monitor_id: monitor.id,
        },
        true,
      );
    } else if (nextMonitorStatus === 'UP' && existingIncident && nextConsecutiveSuccesses >= 2) {
      // Auto-resolve active incident on recovery verification
      db.prepare(`
        UPDATE incidents SET status = 'Resolved', resolved_at = ?, updated_at = ?,
        root_cause = COALESCE(NULLIF(root_cause, ''), 'Automated synthetic recovery verified across consecutive probes.')
        WHERE id = ?
      `).run(nowIso, nowIso, existingIncident.id);

      db.prepare(`
        INSERT INTO incident_notes (incident_id, phase, message, author_name, author_role, is_system, created_at)
        VALUES (?, 'Resolved', ?, 'VigilNode Scheduler', 'SYSTEM', 1, ?)
      `).run(
        existingIncident.id,
        `Service recovered: ${monitor.protocol} probe returned healthy (${result.response_time_ms}ms).`,
        nowIso,
      );

      telemetryWs.broadcast(
        {
          event: 'INCIDENT_UPDATED',
          incident_id: existingIncident.id,
          status: 'Resolved',
          monitor_id: monitor.id,
        },
        { publicSafe: Boolean(monitor.is_public) },
      );

      await dispatchAlertForEvent(
        db,
        {
          event_type: 'MONITOR_RECOVERED',
          severity: 'INFO',
          title: `${monitor.name} Recovered`,
          message: `Incident ${existingIncident.code} auto-resolved after consecutive healthy checks (${result.response_time_ms}ms).`,
          monitor_id: monitor.id,
          incident_id: existingIncident.id,
        },
        inMaintenance,
      );
    }

    telemetryWs.broadcast(
      {
        event: 'PROBE_RESULT',
        monitor_id: monitor.id,
        monitor_name: monitor.name,
        protocol: monitor.protocol,
        status: nextMonitorStatus,
        response_time_ms: result.response_time_ms,
        status_code: result.status_code,
        error_message: result.error_message,
        checked_at: nowIso,
      },
      { publicSafe: Boolean(monitor.is_public) },
    );

    return {
      monitor_id: monitor.id,
      monitor_name: monitor.name,
      status: nextMonitorStatus,
      response_time_ms: result.response_time_ms,
      status_code: result.status_code,
      error_message: result.error_message,
      suppressed_by_maintenance: inMaintenance,
      incident_id: activeIncidentId,
    };
  } finally {
    activeProbes.delete(monitorId);
  }
}

export async function runDueSchedulerTick(db: Database.Database): Promise<void> {
  const nowMs = Date.now();
  const enabledMonitors = db
    .prepare('SELECT id, interval_sec, last_checked_at FROM monitors WHERE enabled = 1')
    .all() as Array<{ id: string; interval_sec: number; last_checked_at: string | null }>;

  const due = enabledMonitors.filter((m) => {
    if (activeProbes.has(m.id)) return false;
    if (!m.last_checked_at) return true;
    const lastMs = new Date(m.last_checked_at).getTime();
    return Number.isNaN(lastMs) || nowMs - lastMs >= m.interval_sec * 1000;
  });

  if (due.length === 0) return;

  const limit = config.probeConcurrencyLimit;
  for (let i = 0; i < due.length; i += limit) {
    const batch = due.slice(i, i + limit);
    await Promise.allSettled(batch.map((m) => runMonitorCheck(db, m.id)));
  }
}

export function startScheduler(db: Database.Database): void {
  if (!config.enableScheduler || schedulerTimer) return;
  schedulerTimer = setInterval(() => {
    void runDueSchedulerTick(db);
  }, 5000);
}

export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
