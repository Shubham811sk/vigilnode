import crypto from 'node:crypto';
import { Router } from 'express';
import type Database from 'better-sqlite3';
import {
  type AuthenticatedRequest,
  maskChannelConfig,
  mergeMaskedConfig,
  requireAdmin,
  requireAuth,
} from '../core/security.ts';
import { writeAuditLog } from '../db/database.ts';
import { dispatchToChannel } from '../notifications/dispatcher.ts';
import { telemetryWs } from '../ws.ts';

export function createIntegrationsRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/', requireAuth, (req, res) => {
    const channels = db
      .prepare('SELECT * FROM notification_channels ORDER BY channel_type ASC')
      .all() as Array<{
      id: string;
      channel_type: string;
      name: string;
      enabled: number;
      config_json: string;
      last_test_at: string | null;
      last_test_status: string | null;
      last_test_message: string | null;
      updated_at: string;
    }>;

    const rules = db.prepare('SELECT * FROM alert_rules ORDER BY created_at ASC').all() as Array<Record<string, unknown>>;
    const logs = db
      .prepare('SELECT * FROM notification_logs ORDER BY created_at DESC LIMIT 60')
      .all() as Array<Record<string, unknown>>;

    res.json({
      channels: channels.map((ch) => {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(ch.config_json || '{}');
        } catch {
          parsed = {};
        }
        return {
          id: ch.id,
          channel_type: ch.channel_type,
          name: ch.name,
          enabled: Boolean(ch.enabled),
          config: maskChannelConfig(ch.channel_type, parsed),
          last_test_at: ch.last_test_at,
          last_test_status: ch.last_test_status,
          last_test_message: ch.last_test_message,
          updated_at: ch.updated_at,
        };
      }),
      rules: rules.map((r) => ({
        ...r,
        enabled: Boolean(r.enabled),
        channels: (() => {
          try {
            return JSON.parse(String(r.channels_json || '[]'));
          } catch {
            return [];
          }
        })(),
      })),
      logs,
    });
  });

  router.put('/channels/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const ch = db.prepare('SELECT * FROM notification_channels WHERE id = ?').get(req.params.id) as
      | { id: string; channel_type: string; name: string; enabled: number; config_json: string }
      | undefined;

    if (!ch) {
      res.status(404).json({ detail: 'Notification channel not found.' });
      return;
    }

    const existingCfg = JSON.parse(ch.config_json || '{}') as Record<string, unknown>;
    const incomingCfg =
      req.body?.config && typeof req.body.config === 'object' ? (req.body.config as Record<string, unknown>) : {};
    const merged = mergeMaskedConfig(ch.channel_type, existingCfg, incomingCfg);
    const enabled = req.body?.enabled !== undefined ? (req.body.enabled ? 1 : 0) : ch.enabled;
    const now = new Date().toISOString();

    db.prepare('UPDATE notification_channels SET enabled = ?, config_json = ?, updated_at = ? WHERE id = ?').run(
      enabled,
      JSON.stringify(merged),
      now,
      ch.id,
    );

    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: 'INTEGRATION_CHANNEL_UPDATED',
      resource_type: 'integration',
      resource_id: ch.id,
      details: { channel_type: ch.channel_type, enabled: Boolean(enabled) },
      ip_address: req.ip || '127.0.0.1',
    });

    res.json({
      id: ch.id,
      channel_type: ch.channel_type,
      name: ch.name,
      enabled: Boolean(enabled),
      config: maskChannelConfig(ch.channel_type, merged),
      updated_at: now,
    });
  });

  router.post('/channels/:id/test', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const ch = db.prepare('SELECT * FROM notification_channels WHERE id = ?').get(req.params.id) as
      | { id: string; channel_type: string; name: string; enabled: number; config_json: string }
      | undefined;

    if (!ch) {
      res.status(404).json({ detail: 'Notification channel not found.' });
      return;
    }

    const dryRun = Boolean(req.body?.dry_run);
    const title = String(req.body?.title || `VigilNode Admin Test (${ch.name})`);
    const message = String(
      req.body?.message ||
        `Explicit administrator test notification triggered by ${req.user!.full_name} (${req.user!.email}).`,
    );

    const result = await dispatchToChannel(
      db,
      ch,
      {
        event_type: dryRun ? 'SANDBOX_SIMULATION' : 'ADMIN_CHANNEL_TEST',
        severity: 'INFO',
        title,
        message,
      },
      { dryRun, forceEvenIfDisabled: true },
    );

    const now = new Date().toISOString();
    db.prepare(
      'UPDATE notification_channels SET last_test_at = ?, last_test_status = ?, last_test_message = ? WHERE id = ?',
    ).run(now, result.status, result.error_message || 'Delivered', ch.id);

    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: dryRun ? 'INTEGRATION_DRY_RUN' : 'INTEGRATION_TEST_DISPATCH',
      resource_type: 'integration',
      resource_id: ch.id,
      details: { status: result.status, error: result.error_message },
      ip_address: req.ip || '127.0.0.1',
    });

    telemetryWs.broadcast({
      event: 'NOTIFICATION_DISPATCHED',
      channel_type: ch.channel_type,
      status: result.status,
    });

    if (result.status === 'FAILED') {
      res.status(400).json({ detail: result.error_message, result });
      return;
    }
    res.json({ message: `Test notification ${result.status.toLowerCase()} via ${ch.name}.`, result });
  });

  router.post('/rules', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const name = String(req.body?.name || '').trim();
    const severity = String(req.body?.severity || 'HIGH').toUpperCase();
    const trigger_type = String(req.body?.trigger_type || 'CONSECUTIVE_FAILURE').toUpperCase();
    const trigger_description = String(req.body?.trigger_description || 'Custom alert routing policy').trim();
    const retry_threshold = Math.max(1, Math.min(10, Number(req.body?.retry_threshold) || 2));
    const cooldown_minutes = Math.max(1, Math.min(1440, Number(req.body?.cooldown_minutes) || 10));
    const channels = Array.isArray(req.body?.channels) ? req.body.channels.map(String) : ['EMAIL_SMTP'];

    if (!name) {
      res.status(400).json({ detail: 'Rule name is required.' });
      return;
    }

    const id = `rule-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO alert_rules (id, name, severity, trigger_type, trigger_description, retry_threshold, cooldown_minutes, channels_json, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(id, name, severity, trigger_type, trigger_description, retry_threshold, cooldown_minutes, JSON.stringify(channels), now);

    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: 'ALERT_RULE_CREATED',
      resource_type: 'alert_rule',
      resource_id: id,
      ip_address: req.ip || '127.0.0.1',
    });

    res.status(201).json({
      id,
      name,
      severity,
      trigger_type,
      trigger_description,
      retry_threshold,
      cooldown_minutes,
      channels,
      enabled: true,
      created_at: now,
    });
  });

  router.put('/rules/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const existing = db.prepare('SELECT * FROM alert_rules WHERE id = ?').get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ detail: 'Alert rule not found.' });
      return;
    }

    const enabled = req.body?.enabled !== undefined ? (req.body.enabled ? 1 : 0) : Number(existing.enabled);
    const retry_threshold =
      req.body?.retry_threshold !== undefined ? Number(req.body.retry_threshold) : Number(existing.retry_threshold);
    const cooldown_minutes =
      req.body?.cooldown_minutes !== undefined ? Number(req.body.cooldown_minutes) : Number(existing.cooldown_minutes);
    const channelsJson = Array.isArray(req.body?.channels)
      ? JSON.stringify(req.body.channels.map(String))
      : String(existing.channels_json);

    db.prepare('UPDATE alert_rules SET enabled = ?, retry_threshold = ?, cooldown_minutes = ?, channels_json = ? WHERE id = ?').run(
      enabled,
      retry_threshold,
      cooldown_minutes,
      channelsJson,
      req.params.id,
    );

    writeAuditLog(db, {
      user_id: req.user!.id,
      user_email: req.user!.email,
      user_role: req.user!.role,
      action: 'ALERT_RULE_UPDATED',
      resource_type: 'alert_rule',
      resource_id: req.params.id,
      ip_address: req.ip || '127.0.0.1',
    });

    res.json({
      ...existing,
      enabled: Boolean(enabled),
      retry_threshold,
      cooldown_minutes,
      channels: JSON.parse(channelsJson),
    });
  });

  router.post('/logs/:logId/retry', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const log = db.prepare('SELECT * FROM notification_logs WHERE id = ?').get(req.params.logId) as
      | {
          id: string;
          channel_id: string | null;
          channel_type: string;
          event_type: string;
          payload_preview: string;
          monitor_id: string | null;
          incident_id: string | null;
        }
      | undefined;
    if (!log || !log.channel_id) {
      res.status(404).json({ detail: 'Notification log or channel not found.' });
      return;
    }
    const ch = db.prepare('SELECT * FROM notification_channels WHERE id = ?').get(log.channel_id) as
      | { id: string; channel_type: string; name: string; enabled: number; config_json: string }
      | undefined;
    if (!ch) {
      res.status(404).json({ detail: 'Target channel no longer exists.' });
      return;
    }
    const result = await dispatchToChannel(db, ch, {
      event_type: `${log.event_type}_RETRY`,
      severity: 'INFO',
      title: `Retry: ${log.event_type}`,
      message: log.payload_preview,
      monitor_id: log.monitor_id,
      incident_id: log.incident_id,
    });
    res.json(result);
  });

  return router;
}
