import crypto from 'node:crypto';
import { Router } from 'express';
import type Database from 'better-sqlite3';
import {
  type AuthenticatedRequest,
  hashPassword,
  requireAdmin,
  requireAuth,
  type UserRole,
} from '../core/security.ts';
import { writeAuditLog } from '../db/database.ts';

const VALID_ROLES = new Set<UserRole>(['ADMIN', 'READ_ONLY_MAINTAINER']);

const DEFAULT_SETTINGS: Record<string, Record<string, unknown>> = {
  general: {
    application_name: 'VigilNode',
    project_info: 'Automated Multi-Protocol Service Availability Telemetry & Live Incident Status Portal',
    timezone: 'UTC',
    date_format: 'YYYY-MM-DD HH:mm:ss',
    compact_density: true,
    sound_alerts: false,
  },
  monitoring: {
    default_interval_sec: 60,
    default_timeout_ms: 5000,
    retry_before_incident: 2,
    flapping_window_minutes: 10,
    flapping_threshold_transitions: 4,
    concurrency_limit: 10,
    ssl_warning_thresholds: [30, 14, 7],
  },
  incidents: {
    auto_create_incidents: true,
    auto_resolve_on_recovery: true,
    recovery_success_threshold: 2,
    default_severity: 'CRITICAL',
    sync_to_public_status: true,
  },
  notifications: {
    suppress_during_maintenance: true,
    digest_mode: false,
    cooldown_minutes: 10,
    retry_failed_deliveries: true,
  },
  public_status: {
    portal_title: 'VigilNode System Status',
    portal_subtitle: 'Continuous automated multi-protocol availability monitoring across HTTP/S, TCP, DNS & SSL endpoints',
    custom_domain: 'status.vigilnode.local',
    show_latency_metrics: true,
    show_90_day_bars: true,
    show_resolved_incidents: true,
    allow_subscriptions: true,
    sla_target_pct: 99.9,
  },
  security: {
    jwt_expiry_hours: 12,
    enforce_rbac: true,
    ssrf_protection: true,
    rate_limit_auth_per_min: 20,
  },
  retention: {
    check_history_days: 90,
    incident_archive_days: 365,
    audit_log_days: 180,
    notification_log_days: 90,
  },
};

export function createAdminSystemRouter(db: Database.Database): Router {
  const router = Router();

  // --- SETTINGS ---
  router.get('/settings', requireAuth, (req, res) => {
    const rows = db.prepare('SELECT category, config_json, updated_at FROM system_settings').all() as Array<{
      category: string;
      config_json: string;
      updated_at: string;
    }>;
    const settings: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        settings[row.category] = JSON.parse(row.config_json);
      } catch {
        settings[row.category] = {};
      }
    }
    res.json({ settings, defaults: DEFAULT_SETTINGS });
  });

  router.put('/settings/:category', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const category = String(req.params.category || '').trim();
    if (!DEFAULT_SETTINGS[category]) {
      res.status(400).json({ detail: `Unknown settings category "${category}".` });
      return;
    }
    const existingRow = db.prepare('SELECT config_json FROM system_settings WHERE category = ?').get(category) as
      | { config_json: string }
      | undefined;
    const current = existingRow ? JSON.parse(existingRow.config_json) : DEFAULT_SETTINGS[category];
    const next = { ...current, ...(req.body || {}) };
    const now = new Date().toISOString();

    db.prepare(
      'INSERT INTO system_settings (category, config_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(category) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at',
    ).run(category, JSON.stringify(next), now);

    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: 'SETTINGS_UPDATED',
      resource_type: 'settings',
      resource_id: category,
      ip_address: req.ip || '127.0.0.1',
    });

    res.json({ category, config: next, updated_at: now });
  });

  router.post('/settings/reset-defaults', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const now = new Date().toISOString();
    const stmt = db.prepare(
      'INSERT INTO system_settings (category, config_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(category) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at',
    );
    for (const [cat, cfg] of Object.entries(DEFAULT_SETTINGS)) {
      stmt.run(cat, JSON.stringify(cfg), now);
    }
    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: 'SETTINGS_RESET_DEFAULTS',
      resource_type: 'settings',
      ip_address: req.ip || '127.0.0.1',
    });
    res.json({ settings: DEFAULT_SETTINGS, message: 'All settings restored to factory defaults.' });
  });

  // --- USERS & RBAC ---
  router.get('/users', requireAuth, (req, res) => {
    const search = String(req.query.search || '').trim().toLowerCase();
    const roleFilter = String(req.query.role || 'ALL').toUpperCase();
    const statusFilter = String(req.query.status || 'ALL').toUpperCase();

    const rows = db
      .prepare(
        'SELECT id, full_name, email, role, title, is_active, is_protected_root, last_login_at, created_at, updated_at FROM users ORDER BY created_at ASC',
      )
      .all() as Array<Record<string, unknown>>;

    const filtered = rows.filter((u) => {
      if (roleFilter !== 'ALL' && String(u.role) !== roleFilter) return false;
      if (statusFilter === 'ACTIVE' && !u.is_active) return false;
      if (statusFilter === 'INACTIVE' && u.is_active) return false;
      if (search) {
        const hay = `${u.id} ${u.full_name} ${u.email} ${u.title}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    res.json({
      items: filtered.map((u) => ({
        ...u,
        is_active: Boolean(u.is_active),
        is_protected_root: Boolean(u.is_protected_root),
      })),
      counts: {
        total: rows.length,
        active: rows.filter((u) => u.is_active).length,
        admins: rows.filter((u) => u.role === 'ADMIN').length,
        maintainers: rows.filter((u) => u.role === 'READ_ONLY_MAINTAINER').length,
      },
    });
  });

  router.post('/users', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const full_name = String(req.body?.full_name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const role = String(req.body?.role || 'READ_ONLY_MAINTAINER').toUpperCase() as UserRole;
    const title = String(req.body?.title || (role === 'ADMIN' ? 'Administrator' : 'Read-Only Maintainer')).trim();
    const password = String(req.body?.password || '');

    if (!full_name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ detail: 'Valid full_name and email address are required.' });
      return;
    }
    if (!VALID_ROLES.has(role)) {
      res.status(400).json({ detail: 'Role must be ADMIN or READ_ONLY_MAINTAINER.' });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ detail: 'Password must be at least 8 characters.' });
      return;
    }

    const exists = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email);
    if (exists) {
      res.status(409).json({ detail: `A user with email "${email}" already exists.` });
      return;
    }

    const id = `USR-${Math.floor(100 + Math.random() * 899)}`;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO users (id, full_name, email, password_hash, role, title, is_active, is_protected_root, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
    `).run(id, full_name, email, hashPassword(password), role, title, now, now);

    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: 'USER_CREATED',
      resource_type: 'user',
      resource_id: id,
      details: { email, role },
      ip_address: req.ip || '127.0.0.1',
    });

    res.status(201).json({
      id,
      full_name,
      email,
      role,
      title,
      is_active: true,
      is_protected_root: false,
      created_at: now,
    });
  });

  router.put('/users/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as
      | { id: string; role: UserRole; is_active: number; is_protected_root: number; full_name: string; title: string }
      | undefined;
    if (!target) {
      res.status(404).json({ detail: 'User not found.' });
      return;
    }

    const nextName = String(req.body?.full_name ?? target.full_name).trim();
    const nextTitle = String(req.body?.title ?? target.title).trim();
    const nextRole = (req.body?.role ? String(req.body.role).toUpperCase() : target.role) as UserRole;

    if (!VALID_ROLES.has(nextRole)) {
      res.status(400).json({ detail: 'Role must be ADMIN or READ_ONLY_MAINTAINER.' });
      return;
    }
    if (target.role === 'ADMIN' && nextRole !== 'ADMIN') {
      if (target.is_protected_root) {
        res.status(400).json({ detail: 'Protected root administrator role cannot be downgraded.' });
        return;
      }
      const activeAdmins = (
        db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'ADMIN' AND is_active = 1").get() as { cnt: number }
      ).cnt;
      if (activeAdmins <= 1) {
        res.status(400).json({ detail: 'Cannot downgrade the last active administrator account.' });
        return;
      }
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE users SET full_name = ?, title = ?, role = ?, updated_at = ? WHERE id = ?').run(
      nextName,
      nextTitle,
      nextRole,
      now,
      target.id,
    );

    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: 'USER_UPDATED',
      resource_type: 'user',
      resource_id: target.id,
      details: { role: nextRole },
      ip_address: req.ip || '127.0.0.1',
    });

    const updated = db
      .prepare('SELECT id, full_name, email, role, title, is_active, is_protected_root, last_login_at, created_at FROM users WHERE id = ?')
      .get(target.id) as Record<string, unknown>;
    res.json({
      ...updated,
      is_active: Boolean(updated.is_active),
      is_protected_root: Boolean(updated.is_protected_root),
    });
  });

  router.patch('/users/:id/status', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as
      | { id: string; email: string; role: string; is_active: number; is_protected_root: number }
      | undefined;
    if (!target) {
      res.status(404).json({ detail: 'User not found.' });
      return;
    }
    if (target.is_protected_root && target.is_active) {
      res.status(400).json({ detail: 'Protected root administrator cannot be deactivated.' });
      return;
    }
    if (target.id === req.user!.id && target.is_active) {
      res.status(400).json({ detail: 'You cannot deactivate your own currently signed-in account.' });
      return;
    }
    if (target.role === 'ADMIN' && target.is_active) {
      const activeAdmins = (
        db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'ADMIN' AND is_active = 1").get() as { cnt: number }
      ).cnt;
      if (activeAdmins <= 1) {
        res.status(400).json({ detail: 'Last-Admin Guard: At least one active administrator is required.' });
        return;
      }
    }

    const nextActive = target.is_active ? 0 : 1;
    const now = new Date().toISOString();
    db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(nextActive, now, target.id);

    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: nextActive ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
      resource_type: 'user',
      resource_id: target.id,
      ip_address: req.ip || '127.0.0.1',
    });

    res.json({ id: target.id, is_active: Boolean(nextActive) });
  });

  router.post('/users/:id/reset-password', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const target = db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.params.id) as
      | { id: string; email: string }
      | undefined;
    if (!target) {
      res.status(404).json({ detail: 'User not found.' });
      return;
    }
    const requestedPassword = String(req.body?.new_password || '').trim();
    if (requestedPassword && requestedPassword.length < 8) {
      res.status(400).json({ detail: 'New password must be at least 8 characters.' });
      return;
    }
    const tempPassword = requestedPassword || `Vn-${crypto.randomBytes(6).toString('base64url')}!9`;
    const now = new Date().toISOString();
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      hashPassword(tempPassword),
      now,
      target.id,
    );

    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: 'USER_PASSWORD_RESET',
      resource_type: 'user',
      resource_id: target.id,
      ip_address: req.ip || '127.0.0.1',
    });

    res.json({
      id: target.id,
      email: target.email,
      temporary_password: tempPassword,
      message: 'Temporary password issued. Require user to change it upon next login.',
    });
  });

  router.delete('/users/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) as
      | { id: string; email: string; role: string; is_active: number; is_protected_root: number }
      | undefined;
    if (!target) {
      res.status(404).json({ detail: 'User not found.' });
      return;
    }
    if (target.is_protected_root) {
      res.status(400).json({ detail: 'Protected root administrator cannot be deleted.' });
      return;
    }
    if (target.id === req.user!.id) {
      res.status(400).json({ detail: 'You cannot delete your own currently signed-in account.' });
      return;
    }
    if (target.role === 'ADMIN' && target.is_active) {
      const activeAdmins = (
        db.prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'ADMIN' AND is_active = 1").get() as { cnt: number }
      ).cnt;
      if (activeAdmins <= 1) {
        res.status(400).json({ detail: 'Last-Admin Guard: Cannot delete the last active administrator.' });
        return;
      }
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: 'USER_DELETED',
      resource_type: 'user',
      resource_id: target.id,
      details: { email: target.email },
      ip_address: req.ip || '127.0.0.1',
    });

    res.json({ message: `User ${target.email} deleted.` });
  });

  // --- AUDIT LOGS ---
  router.get('/audit-logs', requireAuth, (req, res) => {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const logs = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?').all(limit) as Array<
      Record<string, unknown>
    >;
    res.json({
      items: logs.map((l) => ({
        ...l,
        details: (() => {
          try {
            return JSON.parse(String(l.details_json || '{}'));
          } catch {
            return {};
          }
        })(),
      })),
    });
  });

  router.get('/audit-logs/export.csv', requireAuth, requireAdmin, (req, res) => {
    const logs = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500').all() as Array<
      Record<string, unknown>
    >;
    const header = 'id,created_at,user_email,user_role,action,resource_type,resource_id,ip_address\n';
    const lines = logs.map((l) =>
      [l.id, l.created_at, l.user_email, l.user_role, l.action, l.resource_type, l.resource_id ?? '', l.ip_address].join(','),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="vigilnode-audit-logs.csv"');
    res.send(header + lines.join('\n'));
  });

  return router;
}
