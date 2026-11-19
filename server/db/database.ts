import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../core/config.ts';

let dbInstance: Database.Database | null = null;

export function getDb(customPath?: string): Database.Database {
  if (dbInstance && !customPath) {
    return dbInstance;
  }
  const targetPath = customPath || config.dbPath;
  if (targetPath !== ':memory:') {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  const db = new Database(targetPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  if (!customPath) {
    dbInstance = db;
  }
  return db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('ADMIN', 'READ_ONLY_MAINTAINER')),
      title TEXT NOT NULL DEFAULT 'Site Reliability Engineer',
      is_active INTEGER NOT NULL DEFAULT 1,
      is_protected_root INTEGER NOT NULL DEFAULT 0,
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS monitors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      target TEXT NOT NULL,
      protocol TEXT NOT NULL CHECK (protocol IN ('HTTP', 'HTTPS', 'TCP', 'DNS', 'SSL')),
      http_method TEXT NOT NULL DEFAULT 'GET',
      port INTEGER,
      dns_record_type TEXT DEFAULT 'A',
      expected_status TEXT DEFAULT '200',
      expected_keyword TEXT DEFAULT '',
      expected_dns_answer TEXT DEFAULT '',
      headers_json TEXT NOT NULL DEFAULT '{}',
      interval_sec INTEGER NOT NULL DEFAULT 60 CHECK (interval_sec >= 15 AND interval_sec <= 86400),
      timeout_ms INTEGER NOT NULL DEFAULT 5000 CHECK (timeout_ms >= 500 AND timeout_ms <= 60000),
      retry_threshold INTEGER NOT NULL DEFAULT 2 CHECK (retry_threshold >= 1 AND retry_threshold <= 10),
      ssl_warning_days INTEGER NOT NULL DEFAULT 14,
      status TEXT NOT NULL DEFAULT 'UP' CHECK (status IN ('UP', 'DEGRADED', 'DOWN', 'PAUSED', 'MAINTENANCE')),
      enabled INTEGER NOT NULL DEFAULT 1,
      is_public INTEGER NOT NULL DEFAULT 1,
      tags_json TEXT NOT NULL DEFAULT '[]',
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      consecutive_successes INTEGER NOT NULL DEFAULT 0,
      last_checked_at TEXT,
      last_response_time_ms REAL,
      last_error TEXT DEFAULT '',
      ssl_expires_at TEXT,
      ssl_days_remaining INTEGER,
      ssl_issuer TEXT,
      ssl_subject TEXT,
      ssl_valid INTEGER,
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(target, protocol, port)
    );

    CREATE TABLE IF NOT EXISTS monitor_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('UP', 'DEGRADED', 'DOWN')),
      response_time_ms REAL NOT NULL,
      status_code INTEGER,
      error_message TEXT DEFAULT '',
      details_json TEXT NOT NULL DEFAULT '{}',
      checked_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_monitor_checks_monitor_time
      ON monitor_checks(monitor_id, checked_at DESC);

    CREATE INDEX IF NOT EXISTS idx_monitor_checks_time
      ON monitor_checks(checked_at DESC);

    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      monitor_id TEXT REFERENCES monitors(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
      status TEXT NOT NULL CHECK (status IN ('Investigating', 'Identified', 'Monitoring', 'Resolved')),
      summary TEXT NOT NULL DEFAULT '',
      root_cause TEXT NOT NULL DEFAULT '',
      diagnostic_payload TEXT NOT NULL DEFAULT '',
      assigned_to TEXT DEFAULT 'Shubham Bind',
      sync_public_status INTEGER NOT NULL DEFAULT 1,
      started_at TEXT NOT NULL,
      acknowledged_at TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS incident_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
      phase TEXT NOT NULL,
      message TEXT NOT NULL,
      author_name TEXT NOT NULL,
      author_role TEXT NOT NULL,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS maintenance_windows (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      expected_impact TEXT NOT NULL DEFAULT 'Minimal degradation expected',
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('UPCOMING', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
      suppress_alerts INTEGER NOT NULL DEFAULT 1,
      notify_subscribers INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS maintenance_monitors (
      maintenance_id TEXT NOT NULL REFERENCES maintenance_windows(id) ON DELETE CASCADE,
      monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
      PRIMARY KEY (maintenance_id, monitor_id)
    );

    CREATE TABLE IF NOT EXISTS notification_channels (
      id TEXT PRIMARY KEY,
      channel_type TEXT NOT NULL UNIQUE CHECK (channel_type IN ('EMAIL_SMTP', 'TELEGRAM', 'DISCORD', 'SLACK')),
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      config_json TEXT NOT NULL DEFAULT '{}',
      last_test_at TEXT,
      last_test_status TEXT,
      last_test_message TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alert_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
      trigger_type TEXT NOT NULL,
      trigger_description TEXT NOT NULL,
      retry_threshold INTEGER NOT NULL DEFAULT 2,
      cooldown_minutes INTEGER NOT NULL DEFAULT 10,
      channels_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_logs (
      id TEXT PRIMARY KEY,
      channel_id TEXT REFERENCES notification_channels(id) ON DELETE SET NULL,
      channel_type TEXT NOT NULL,
      incident_id TEXT,
      monitor_id TEXT,
      event_type TEXT NOT NULL,
      recipient_summary TEXT NOT NULL,
      payload_preview TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('SENT', 'FAILED', 'SUPPRESSED', 'SIMULATED')),
      error_message TEXT DEFAULT '',
      attempts INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS status_subscribers (
      id TEXT PRIMARY KEY,
      channel TEXT NOT NULL DEFAULT 'email',
      destination TEXT NOT NULL UNIQUE,
      verified INTEGER NOT NULL DEFAULT 1,
      unsubscribe_token TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      category TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      user_email TEXT NOT NULL,
      user_role TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      details_json TEXT NOT NULL DEFAULT '{}',
      ip_address TEXT DEFAULT '127.0.0.1',
      created_at TEXT NOT NULL
    );
  `);

  const migration = db.prepare('SELECT version FROM schema_migrations WHERE version = 1').get();
  if (!migration) {
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
      1,
      'initial_vigilnode_schema',
      new Date().toISOString(),
    );
  }
}

export function writeAuditLog(
  db: Database.Database,
  entry: {
    user_id?: string | null;
    user_email: string;
    user_role: string;
    action: string;
    resource_type: string;
    resource_id?: string | null;
    details?: Record<string, unknown>;
    ip_address?: string;
  },
): void {
  db.prepare(
    `INSERT INTO audit_logs (user_id, user_email, user_role, action, resource_type, resource_id, details_json, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.user_id || null,
    entry.user_email,
    entry.user_role,
    entry.action,
    entry.resource_type,
    entry.resource_id || null,
    JSON.stringify(entry.details || {}),
    entry.ip_address || '127.0.0.1',
    new Date().toISOString(),
  );
}
