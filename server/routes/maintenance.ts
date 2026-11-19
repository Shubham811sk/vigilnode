import crypto from 'node:crypto';
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { type AuthenticatedRequest, requireAdmin, requireAuth } from '../core/security.ts';
import { writeAuditLog } from '../db/database.ts';
import { telemetryWs } from '../ws.ts';

function syncMaintenanceStatuses(db: Database.Database): void {
  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE maintenance_windows SET status = 'ACTIVE', updated_at = ?
    WHERE status = 'UPCOMING' AND start_time <= ? AND end_time > ?
  `).run(nowIso, nowIso, nowIso);
  db.prepare(`
    UPDATE maintenance_windows SET status = 'COMPLETED', updated_at = ?
    WHERE status IN ('UPCOMING', 'ACTIVE') AND end_time <= ?
  `).run(nowIso, nowIso);
}

function enrichMaintenance(db: Database.Database, row: Record<string, unknown>) {
  const monitors = db
    .prepare(
      `SELECT m.id, m.name, m.protocol, m.target, m.status
       FROM monitors m
       JOIN maintenance_monitors mm ON mm.monitor_id = m.id
       WHERE mm.maintenance_id = ?`,
    )
    .all(row.id) as Array<Record<string, unknown>>;

  return {
    ...row,
    suppress_alerts: Boolean(row.suppress_alerts),
    notify_subscribers: Boolean(row.notify_subscribers),
    monitors,
    affected_monitor_ids: monitors.map((m) => m.id),
  };
}

export function createMaintenanceRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/export.csv', requireAuth, (req, res) => {
    syncMaintenanceStatuses(db);
    const rows = db.prepare('SELECT * FROM maintenance_windows ORDER BY start_time DESC').all() as Array<Record<string, unknown>>;
    const header = 'code,title,status,start_time,end_time,suppress_alerts,created_by\n';
    const lines = rows.map((r) =>
      [
        r.code,
        `"${String(r.title).replace(/"/g, '""')}"`,
        r.status,
        r.start_time,
        r.end_time,
        r.suppress_alerts ? 'true' : 'false',
        `"${String(r.created_by).replace(/"/g, '""')}"`,
      ].join(','),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="vigilnode-maintenance-audit.csv"');
    res.send(header + lines.join('\n'));
  });

  router.get('/', requireAuth, (req, res) => {
    syncMaintenanceStatuses(db);
    const rows = db.prepare('SELECT * FROM maintenance_windows ORDER BY start_time DESC').all() as Array<Record<string, unknown>>;
    const enriched = rows.map((r) => enrichMaintenance(db, r));

    res.json({
      items: enriched,
      counts: {
        upcoming: rows.filter((r) => r.status === 'UPCOMING').length,
        active: rows.filter((r) => r.status === 'ACTIVE').length,
        completed: rows.filter((r) => r.status === 'COMPLETED').length,
        cancelled: rows.filter((r) => r.status === 'CANCELLED').length,
      },
    });
  });

  router.post('/', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const expected_impact = String(req.body?.expected_impact || 'Brief intermittent service degradation').trim();
    const startRaw = String(req.body?.start_time || '');
    const endRaw = String(req.body?.end_time || '');
    const suppress_alerts = req.body?.suppress_alerts === false ? 0 : 1;
    const notify_subscribers = req.body?.notify_subscribers === false ? 0 : 1;
    const monitorIds = Array.isArray(req.body?.affected_monitor_ids)
      ? req.body.affected_monitor_ids.map(String)
      : [];

    if (!title || title.length < 3) {
      res.status(400).json({ detail: 'Maintenance title must be at least 3 characters.' });
      return;
    }
    const startMs = new Date(startRaw).getTime();
    const endMs = new Date(endRaw).getTime();
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      res.status(400).json({ detail: 'Valid start_time and end_time are required, with end_time after start_time.' });
      return;
    }

    const nowMs = Date.now();
    const status = startMs <= nowMs && endMs > nowMs ? 'ACTIVE' : endMs <= nowMs ? 'COMPLETED' : 'UPCOMING';
    const id = `mw-${crypto.randomUUID().slice(0, 8)}`;
    const code = `#MNT-${Math.floor(4100 + Math.random() * 5800)}`;
    const nowIso = new Date().toISOString();

    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO maintenance_windows (id, code, title, description, expected_impact, start_time, end_time, status, suppress_alerts, notify_subscribers, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        code,
        title,
        description,
        expected_impact,
        new Date(startMs).toISOString(),
        new Date(endMs).toISOString(),
        status,
        suppress_alerts,
        notify_subscribers,
        req.user!.full_name,
        nowIso,
        nowIso,
      );

      const linkStmt = db.prepare('INSERT OR IGNORE INTO maintenance_monitors (maintenance_id, monitor_id) VALUES (?, ?)');
      for (const mId of monitorIds) {
        const exists = db.prepare('SELECT id FROM monitors WHERE id = ?').get(mId);
        if (exists) linkStmt.run(id, mId);
      }
    });
    tx();

    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: 'MAINTENANCE_CREATED',
      resource_type: 'maintenance',
      resource_id: id,
      details: { code, title, status, monitor_count: monitorIds.length },
      ip_address: req.ip || '127.0.0.1',
    });

    const created = db.prepare('SELECT * FROM maintenance_windows WHERE id = ?').get(id) as Record<string, unknown>;
    telemetryWs.broadcast({ event: 'MAINTENANCE_UPDATED', maintenance_id: id, status }, { publicSafe: true });
    res.status(201).json(enrichMaintenance(db, created));
  });

  router.put('/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const existing = db.prepare('SELECT * FROM maintenance_windows WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ detail: 'Maintenance window not found.' });
      return;
    }

    const title = String(req.body?.title ?? existing.title).trim();
    const description = String(req.body?.description ?? existing.description).trim();
    const expected_impact = String(req.body?.expected_impact ?? existing.expected_impact).trim();
    const startRaw = String(req.body?.start_time ?? existing.start_time);
    const endRaw = String(req.body?.end_time ?? existing.end_time);
    const suppress_alerts =
      req.body?.suppress_alerts !== undefined ? (req.body.suppress_alerts ? 1 : 0) : Number(existing.suppress_alerts);
    const notify_subscribers =
      req.body?.notify_subscribers !== undefined
        ? req.body.notify_subscribers
          ? 1
          : 0
        : Number(existing.notify_subscribers);

    const startMs = new Date(startRaw).getTime();
    const endMs = new Date(endRaw).getTime();
    if (!title || Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      res.status(400).json({ detail: 'Valid title, start_time, and end_time (after start_time) are required.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE maintenance_windows
        SET title = ?, description = ?, expected_impact = ?, start_time = ?, end_time = ?, suppress_alerts = ?, notify_subscribers = ?, updated_at = ?
        WHERE id = ?
      `).run(
        title,
        description,
        expected_impact,
        new Date(startMs).toISOString(),
        new Date(endMs).toISOString(),
        suppress_alerts,
        notify_subscribers,
        nowIso,
        req.params.id,
      );

      if (Array.isArray(req.body?.affected_monitor_ids)) {
        db.prepare('DELETE FROM maintenance_monitors WHERE maintenance_id = ?').run(req.params.id);
        const linkStmt = db.prepare('INSERT OR IGNORE INTO maintenance_monitors (maintenance_id, monitor_id) VALUES (?, ?)');
        for (const mId of req.body.affected_monitor_ids.map(String)) {
          const exists = db.prepare('SELECT id FROM monitors WHERE id = ?').get(mId);
          if (exists) linkStmt.run(req.params.id, mId);
        }
      }
    });
    tx();
    syncMaintenanceStatuses(db);

    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: 'MAINTENANCE_UPDATED',
      resource_type: 'maintenance',
      resource_id: req.params.id,
      ip_address: req.ip || '127.0.0.1',
    });

    const updated = db.prepare('SELECT * FROM maintenance_windows WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    telemetryWs.broadcast({ event: 'MAINTENANCE_UPDATED', maintenance_id: req.params.id }, { publicSafe: true });
    res.json(enrichMaintenance(db, updated));
  });

  router.post('/:id/start', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const existing = db.prepare('SELECT * FROM maintenance_windows WHERE id = ?').get(req.params.id) as
      | { id: string; end_time: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ detail: 'Maintenance window not found.' });
      return;
    }
    const nowIso = new Date().toISOString();
    const endIso =
      new Date(existing.end_time).getTime() <= Date.now()
        ? new Date(Date.now() + 3600_000).toISOString()
        : existing.end_time;
    db.prepare("UPDATE maintenance_windows SET status = 'ACTIVE', start_time = ?, end_time = ?, updated_at = ? WHERE id = ?").run(
      nowIso,
      endIso,
      nowIso,
      existing.id,
    );
    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: 'MAINTENANCE_STARTED',
      resource_type: 'maintenance',
      resource_id: existing.id,
      ip_address: req.ip || '127.0.0.1',
    });
    const updated = db.prepare('SELECT * FROM maintenance_windows WHERE id = ?').get(existing.id) as Record<string, unknown>;
    telemetryWs.broadcast({ event: 'MAINTENANCE_UPDATED', maintenance_id: existing.id, status: 'ACTIVE' }, { publicSafe: true });
    res.json(enrichMaintenance(db, updated));
  });

  router.post('/:id/cancel', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const existing = db.prepare('SELECT id FROM maintenance_windows WHERE id = ?').get(req.params.id);
    if (!existing) {
      res.status(404).json({ detail: 'Maintenance window not found.' });
      return;
    }
    const nowIso = new Date().toISOString();
    db.prepare("UPDATE maintenance_windows SET status = 'CANCELLED', updated_at = ? WHERE id = ?").run(nowIso, req.params.id);
    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: 'MAINTENANCE_CANCELLED',
      resource_type: 'maintenance',
      resource_id: req.params.id,
      ip_address: req.ip || '127.0.0.1',
    });
    const updated = db.prepare('SELECT * FROM maintenance_windows WHERE id = ?').get(req.params.id) as Record<string, unknown>;
    telemetryWs.broadcast({ event: 'MAINTENANCE_UPDATED', maintenance_id: req.params.id, status: 'CANCELLED' }, { publicSafe: true });
    res.json(enrichMaintenance(db, updated));
  });

  router.delete('/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const existing = db.prepare('SELECT id, title FROM maintenance_windows WHERE id = ?').get(req.params.id) as
      | { id: string; title: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ detail: 'Maintenance window not found.' });
      return;
    }
    db.prepare('DELETE FROM maintenance_windows WHERE id = ?').run(existing.id);
    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: 'MAINTENANCE_DELETED',
      resource_type: 'maintenance',
      resource_id: existing.id,
      details: { title: existing.title },
      ip_address: req.ip || '127.0.0.1',
    });
    telemetryWs.broadcast({ event: 'MAINTENANCE_UPDATED', maintenance_id: existing.id, action: 'deleted' }, { publicSafe: true });
    res.json({ message: 'Maintenance window deleted.' });
  });

  return router;
}
