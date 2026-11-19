import crypto from 'node:crypto';
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { type AuthenticatedRequest, requireAdmin, requireAuth } from '../core/security.ts';
import { writeAuditLog } from '../db/database.ts';
import { runMonitorCheck } from '../monitoring/scheduler.ts';
import { telemetryWs } from '../ws.ts';

export type IncidentStatus = 'Investigating' | 'Identified' | 'Monitoring' | 'Resolved';

const ALLOWED_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  Investigating: ['Identified'],
  Identified: ['Monitoring'],
  Monitoring: ['Resolved'],
  Resolved: [],
};

const VALID_SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);

function enrichIncident(db: Database.Database, row: Record<string, unknown>) {
  const notes = db
    .prepare('SELECT * FROM incident_notes WHERE incident_id = ? ORDER BY created_at ASC')
    .all(row.id) as Array<Record<string, unknown>>;

  const monitor = row.monitor_id
    ? (db.prepare('SELECT id, name, protocol, target, status FROM monitors WHERE id = ?').get(row.monitor_id) as Record<
        string,
        unknown
      > | null)
    : null;

  const startedMs = new Date(String(row.started_at)).getTime();
  const endMs = row.resolved_at ? new Date(String(row.resolved_at)).getTime() : Date.now();
  const durationSec = Math.max(0, Math.floor((endMs - startedMs) / 1000));

  return {
    ...row,
    sync_public_status: Boolean(row.sync_public_status),
    duration_sec: durationSec,
    monitor,
    notes: notes.map((n) => ({ ...n, is_system: Boolean(n.is_system) })),
  };
}

export function createIncidentsRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/', requireAuth, (req, res) => {
    const statusFilter = String(req.query.status || 'ALL');
    const severityFilter = String(req.query.severity || 'ALL').toUpperCase();
    const search = String(req.query.search || '').trim().toLowerCase();

    const rows = db.prepare('SELECT * FROM incidents ORDER BY started_at DESC').all() as Array<Record<string, unknown>>;
    const enriched = rows.map((r) => enrichIncident(db, r));

    const filtered = enriched.filter((inc: Record<string, unknown>) => {
      if (statusFilter === 'ACTIVE' && inc.status === 'Resolved') return false;
      if (statusFilter !== 'ALL' && statusFilter !== 'ACTIVE' && String(inc.status) !== statusFilter) return false;
      if (severityFilter !== 'ALL' && String(inc.severity).toUpperCase() !== severityFilter) return false;
      if (search) {
        const monName = (inc.monitor as { name?: string } | null)?.name || '';
        const hay = `${inc.code} ${inc.title} ${inc.summary} ${monName}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    // Compute MTTA & MTTR from persisted records
    const ackDurations = rows
      .filter((r) => r.acknowledged_at)
      .map((r) => (new Date(String(r.acknowledged_at)).getTime() - new Date(String(r.started_at)).getTime()) / 1000);
    const resolveDurations = rows
      .filter((r) => r.resolved_at)
      .map((r) => (new Date(String(r.resolved_at)).getTime() - new Date(String(r.started_at)).getTime()) / 1000);

    const avg = (arr: number[]) => (arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

    res.json({
      items: filtered,
      counts: {
        total: rows.length,
        active: rows.filter((r) => r.status !== 'Resolved').length,
        investigating: rows.filter((r) => r.status === 'Investigating').length,
        identified: rows.filter((r) => r.status === 'Identified').length,
        monitoring: rows.filter((r) => r.status === 'Monitoring').length,
        resolved: rows.filter((r) => r.status === 'Resolved').length,
      },
      metrics: {
        mtta_sec: avg(ackDurations),
        mttr_sec: avg(resolveDurations),
      },
    });
  });

  router.post('/', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const title = String(req.body?.title || '').trim();
    const severity = String(req.body?.severity || 'CRITICAL').toUpperCase();
    const monitor_id = req.body?.monitor_id ? String(req.body.monitor_id) : null;
    const summary = String(req.body?.summary || '').trim();
    const sync_public_status = req.body?.sync_public_status === false ? 0 : 1;

    if (!title || title.length < 3) {
      res.status(400).json({ detail: 'Incident title must be at least 3 characters.' });
      return;
    }
    if (!VALID_SEVERITIES.has(severity)) {
      res.status(400).json({ detail: 'Severity must be CRITICAL, HIGH, MEDIUM, or LOW.' });
      return;
    }
    if (monitor_id) {
      const mExists = db.prepare('SELECT id FROM monitors WHERE id = ?').get(monitor_id);
      if (!mExists) {
        res.status(404).json({ detail: 'Related monitor not found.' });
        return;
      }
    }

    const id = `inc-${crypto.randomUUID().slice(0, 8)}`;
    const code = `#INC-${Math.floor(1000 + Math.random() * 8999)}`;
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO incidents (id, code, monitor_id, title, severity, status, summary, root_cause, diagnostic_payload, assigned_to, sync_public_status, started_at, acknowledged_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'Investigating', ?, '', '{}', ?, ?, ?, ?, ?, ?)
    `).run(id, code, monitor_id, title, severity, summary, req.user!.full_name, sync_public_status, now, now, now, now);

    db.prepare(`
      INSERT INTO incident_notes (incident_id, phase, message, author_name, author_role, is_system, created_at)
      VALUES (?, 'Investigating', ?, ?, ?, 0, ?)
    `).run(id, summary || 'Incident manually declared by administrator.', req.user!.full_name, req.user!.role, now);

    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: 'INCIDENT_CREATED',
      resource_type: 'incident',
      resource_id: id,
      details: { code, title, severity },
      ip_address: req.ip || '127.0.0.1',
    });

    const created = db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as Record<string, unknown>;
    telemetryWs.broadcast({ event: 'INCIDENT_CREATED', incident_id: id, code, title }, { publicSafe: Boolean(sync_public_status) });
    res.status(201).json(enrichIncident(db, created));
  });

  router.get('/:id', requireAuth, (req, res) => {
    const row = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined;
    if (!row) {
      res.status(404).json({ detail: 'Incident not found.' });
      return;
    }
    res.json(enrichIncident(db, row));
  });

  router.patch('/:id/status', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const existing = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as
      | {
          id: string;
          status: IncidentStatus;
          monitor_id: string | null;
          acknowledged_at: string | null;
          sync_public_status: number;
          root_cause: string;
        }
      | undefined;

    if (!existing) {
      res.status(404).json({ detail: 'Incident not found.' });
      return;
    }

    const nextStatus = String(req.body?.status || '') as IncidentStatus;
    const message = String(req.body?.message || '').trim();
    const rootCause = req.body?.root_cause !== undefined ? String(req.body.root_cause).trim() : existing.root_cause;
    const syncPublic = req.body?.sync_public_status !== undefined ? (req.body.sync_public_status ? 1 : 0) : existing.sync_public_status;

    const allowedNext = ALLOWED_TRANSITIONS[existing.status] || [];
    if (!allowedNext.includes(nextStatus)) {
      res.status(400).json({
        detail: `Invalid lifecycle transition from "${existing.status}" to "${nextStatus}". Strict lifecycle order is: Investigating -> Identified -> Monitoring -> Resolved.${allowedNext.length > 0 ? ` Allowed next state: ${allowedNext.join(', ')}.` : ' This incident is already Resolved.'}`,
      });
      return;
    }

    const now = new Date().toISOString();
    const ackAt = existing.acknowledged_at || now;
    const resolvedAt = nextStatus === 'Resolved' ? now : null;

    db.prepare(`
      UPDATE incidents
      SET status = ?, root_cause = ?, sync_public_status = ?, acknowledged_at = ?, resolved_at = COALESCE(?, resolved_at), updated_at = ?
      WHERE id = ?
    `).run(nextStatus, rootCause, syncPublic, ackAt, resolvedAt, now, existing.id);

    db.prepare(`
      INSERT INTO incident_notes (incident_id, phase, message, author_name, author_role, is_system, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `).run(
      existing.id,
      nextStatus,
      message || `Incident transitioned from ${existing.status} to ${nextStatus}.`,
      req.user!.full_name,
      req.user!.role,
      now,
    );

    if (req.body?.trigger_probe && existing.monitor_id) {
      await runMonitorCheck(db, existing.monitor_id, { manual: true });
    }

    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: 'INCIDENT_STATUS_CHANGED',
      resource_type: 'incident',
      resource_id: existing.id,
      details: { from: existing.status, to: nextStatus },
      ip_address: req.ip || '127.0.0.1',
    });

    const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(existing.id) as Record<string, unknown>;
    telemetryWs.broadcast(
      { event: 'INCIDENT_UPDATED', incident_id: existing.id, status: nextStatus },
      { publicSafe: Boolean(syncPublic) },
    );
    res.json(enrichIncident(db, updated));
  });

  router.post('/:id/notes', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const existing = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as
      | { id: string; status: string; sync_public_status: number }
      | undefined;
    if (!existing) {
      res.status(404).json({ detail: 'Incident not found.' });
      return;
    }

    const message = String(req.body?.message || '').trim();
    if (!message) {
      res.status(400).json({ detail: 'Investigation note message is required.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO incident_notes (incident_id, phase, message, author_name, author_role, is_system, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)
    `).run(existing.id, existing.status, message, req.user!.full_name, req.user!.role, now);

    db.prepare('UPDATE incidents SET updated_at = ? WHERE id = ?').run(now, existing.id);

    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: 'INCIDENT_NOTE_ADDED',
      resource_type: 'incident',
      resource_id: existing.id,
      ip_address: req.ip || '127.0.0.1',
    });

    const updated = db.prepare('SELECT * FROM incidents WHERE id = ?').get(existing.id) as Record<string, unknown>;
    telemetryWs.broadcast(
      { event: 'INCIDENT_UPDATED', incident_id: existing.id, status: existing.status },
      { publicSafe: Boolean(existing.sync_public_status) },
    );
    res.status(201).json(enrichIncident(db, updated));
  });

  return router;
}
