import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import nodemailer from 'nodemailer';

export interface NotificationPayload {
  event_type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  title: string;
  message: string;
  monitor_id?: string | null;
  incident_id?: string | null;
}

export interface ChannelDeliveryResult {
  channel_id: string;
  channel_type: string;
  status: 'SENT' | 'FAILED' | 'SUPPRESSED' | 'SIMULATED';
  recipient_summary: string;
  error_message: string;
  log_id: string;
}

export async function dispatchToChannel(
  db: Database.Database,
  channelRow: {
    id: string;
    channel_type: string;
    name: string;
    enabled: number;
    config_json: string;
  },
  payload: NotificationPayload,
  options: { dryRun?: boolean; forceEvenIfDisabled?: boolean } = {},
): Promise<ChannelDeliveryResult> {
  const cfg = JSON.parse(channelRow.config_json || '{}') as Record<string, unknown>;
  const logId = `notif-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const preview = `[${payload.severity}] ${payload.title}: ${payload.message}`.slice(0, 240);

  if (options.dryRun) {
    db.prepare(`
      INSERT INTO notification_logs (id, channel_id, channel_type, incident_id, monitor_id, event_type, recipient_summary, payload_preview, status, error_message, attempts, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SIMULATED', '', 1, ?)
    `).run(
      logId,
      channelRow.id,
      channelRow.channel_type,
      payload.incident_id || null,
      payload.monitor_id || null,
      payload.event_type,
      `${channelRow.name} (Dry-Run Sandbox)`,
      preview,
      now,
    );
    return {
      channel_id: channelRow.id,
      channel_type: channelRow.channel_type,
      status: 'SIMULATED',
      recipient_summary: `${channelRow.name} (Dry-Run Sandbox)`,
      error_message: '',
      log_id: logId,
    };
  }

  let recipientSummary = channelRow.name;
  let deliveryStatus: 'SENT' | 'FAILED' = 'FAILED';
  let errorMessage = '';

  try {
    if (!channelRow.enabled && !options.forceEvenIfDisabled) {
      throw new Error(`${channelRow.name} channel is disabled.`);
    }

    if (channelRow.channel_type === 'EMAIL_SMTP') {
      const host = String(cfg.smtp_host || 'smtp.gmail.com');
      const port = Number(cfg.smtp_port) || 587;
      const user = String(cfg.smtp_user || '').trim();
      const pass = String(cfg.smtp_password || '').trim();
      const fromEmail = String(cfg.from_email || user).trim();
      const toEmails = String(cfg.to_emails || '').trim();
      recipientSummary = toEmails || user || 'Unconfigured Email';

      if (!host || !user || !pass || !toEmails) {
        throw new Error('Gmail SMTP credentials incomplete (smtp_user, smtp_password, and to_emails are required).');
      }

      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        requireTLS: port === 587 && cfg.use_tls !== false,
        auth: { user, pass },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        tls: { rejectUnauthorized: cfg.allow_self_signed !== true },
      });

      await transporter.sendMail({
        from: fromEmail,
        to: toEmails,
        subject: `[VigilNode ${payload.severity}] ${payload.title}`,
        text: `${payload.title}\n\nSeverity: ${payload.severity}\nEvent: ${payload.event_type}\nDetails: ${payload.message}\nTimestamp: ${now}`,
      });
      deliveryStatus = 'SENT';
    } else if (channelRow.channel_type === 'TELEGRAM') {
      const botToken = String(cfg.bot_token || '').trim();
      const chatId = String(cfg.chat_id || '').trim();
      recipientSummary = chatId ? `Chat ${chatId}` : 'Unconfigured Chat ID';

      if (!botToken || !chatId) {
        throw new Error('Telegram Bot token and chat_id are required.');
      }

      const apiBase = String(cfg.api_base_url || 'https://api.telegram.org').replace(/\/+$/, '');
      const res = await fetch(`${apiBase}/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `🚨 <b>[VigilNode ${payload.severity}]</b> ${payload.title}\n\n${payload.message}\n<i>${now}</i>`,
          parse_mode: 'HTML',
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Telegram API HTTP ${res.status}: ${errBody.slice(0, 150)}`);
      }
      deliveryStatus = 'SENT';
    } else if (channelRow.channel_type === 'DISCORD') {
      const webhookUrl = String(cfg.webhook_url || '').trim();
      recipientSummary = 'Discord Webhook';
      if (!webhookUrl) {
        throw new Error('Discord webhook_url is required.');
      }
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: String(cfg.username || 'VigilNode Telemetry'),
          embeds: [
            {
              title: `[${payload.severity}] ${payload.title}`,
              description: payload.message,
              color: payload.severity === 'CRITICAL' ? 0xef4444 : payload.severity === 'HIGH' ? 0xf59e0b : 0x10b981,
              timestamp: now,
            },
          ],
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Discord Webhook HTTP ${res.status}: ${errBody.slice(0, 150)}`);
      }
      deliveryStatus = 'SENT';
    } else if (channelRow.channel_type === 'SLACK') {
      const webhookUrl = String(cfg.webhook_url || '').trim();
      recipientSummary = String(cfg.channel || 'Slack Webhook');
      if (!webhookUrl) {
        throw new Error('Slack webhook_url is required.');
      }
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: String(cfg.username || 'VigilNode Incident Dispatcher'),
          text: `*[VigilNode ${payload.severity}]* ${payload.title}\n>${payload.message}\n_Event: ${payload.event_type} • ${now}_`,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Slack Webhook HTTP ${res.status}: ${errBody.slice(0, 150)}`);
      }
      deliveryStatus = 'SENT';
    }
  } catch (err) {
    deliveryStatus = 'FAILED';
    errorMessage = err instanceof Error ? err.message : 'Notification dispatch failed';
  }

  db.prepare(`
    INSERT INTO notification_logs (id, channel_id, channel_type, incident_id, monitor_id, event_type, recipient_summary, payload_preview, status, error_message, attempts, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    logId,
    channelRow.id,
    channelRow.channel_type,
    payload.incident_id || null,
    payload.monitor_id || null,
    payload.event_type,
    recipientSummary,
    preview,
    deliveryStatus,
    errorMessage,
    now,
  );

  return {
    channel_id: channelRow.id,
    channel_type: channelRow.channel_type,
    status: deliveryStatus,
    recipient_summary: recipientSummary,
    error_message: errorMessage,
    log_id: logId,
  };
}

export async function dispatchAlertForEvent(
  db: Database.Database,
  payload: NotificationPayload,
  suppressedByMaintenance: boolean,
): Promise<ChannelDeliveryResult[]> {
  const enabledChannels = db
    .prepare('SELECT id, channel_type, name, enabled, config_json FROM notification_channels WHERE enabled = 1')
    .all() as Array<{
    id: string;
    channel_type: string;
    name: string;
    enabled: number;
    config_json: string;
  }>;

  if (suppressedByMaintenance) {
    const now = new Date().toISOString();
    const preview = `[SUPPRESSED BY MAINTENANCE] ${payload.title}`.slice(0, 240);
    const logId = `notif-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO notification_logs (id, channel_id, channel_type, incident_id, monitor_id, event_type, recipient_summary, payload_preview, status, error_message, attempts, created_at)
      VALUES (?, NULL, 'SYSTEM', ?, ?, ?, 'Maintenance Suppression', ?, 'SUPPRESSED', '', 1, ?)
    `).run(logId, payload.incident_id || null, payload.monitor_id || null, payload.event_type, preview, now);
    return [
      {
        channel_id: 'system',
        channel_type: 'SYSTEM',
        status: 'SUPPRESSED',
        recipient_summary: 'Maintenance Suppression',
        error_message: '',
        log_id: logId,
      },
    ];
  }

  const results: ChannelDeliveryResult[] = [];
  for (const ch of enabledChannels) {
    const res = await dispatchToChannel(db, ch, payload);
    results.push(res);
  }
  return results;
}
