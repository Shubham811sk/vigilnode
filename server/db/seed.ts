import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { hashPassword } from '../core/security.ts';

export function seedDatabaseIfEmpty(db: Database.Database): void {
  const existingUsers = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  if (existingUsers.cnt > 0) {
    return;
  }

  const now = new Date();
  const isoNow = now.toISOString();

  const insertAll = db.transaction(() => {
    // 1. Seed Users (Strictly 2 roles: ADMIN and READ_ONLY_MAINTAINER)
    const adminHash = hashPassword('Admin@1234');
    const viewerHash = hashPassword('Viewer@1234');

    const users = [
      {
        id: 'USR-001',
        full_name: 'Shubham Bind',
        email: 'shubham.bind@vigilnode.local',
        password_hash: adminHash,
        role: 'ADMIN',
        title: 'Project Lead • Root Admin',
        is_active: 1,
        is_protected_root: 1,
        last_login_at: isoNow,
      },
      {
        id: 'USR-002',
        full_name: 'Priya Sharma',
        email: 'priya.sharma@vigilnode.local',
        password_hash: adminHash,
        role: 'ADMIN',
        title: 'DevSecOps Administrator',
        is_active: 1,
        is_protected_root: 0,
        last_login_at: new Date(now.getTime() - 2 * 3600_000).toISOString(),
      },
      {
        id: 'USR-003',
        full_name: 'Prof. K. R. Ramanathan',
        email: 'ramanathan.kr@mca-faculty.ac.in',
        password_hash: viewerHash,
        role: 'READ_ONLY_MAINTAINER',
        title: 'Faculty Evaluator',
        is_active: 1,
        is_protected_root: 0,
        last_login_at: new Date(now.getTime() - 5 * 3600_000).toISOString(),
      },
      {
        id: 'USR-004',
        full_name: 'Amit Verma',
        email: 'maintainer@vigilnode.local',
        password_hash: viewerHash,
        role: 'READ_ONLY_MAINTAINER',
        title: 'Site Reliability Maintainer',
        is_active: 1,
        is_protected_root: 0,
        last_login_at: new Date(now.getTime() - 24 * 3600_000).toISOString(),
      },
      {
        id: 'USR-005',
        full_name: 'Rohan Kulkarni',
        email: 'rohan.k@vigilnode.local',
        password_hash: viewerHash,
        role: 'READ_ONLY_MAINTAINER',
        title: 'MCA Telemetry Analyst',
        is_active: 0,
        is_protected_root: 0,
        last_login_at: new Date(now.getTime() - 120 * 3600_000).toISOString(),
      },
    ];

    const insertUser = db.prepare(`
      INSERT INTO users (id, full_name, email, password_hash, role, title, is_active, is_protected_root, last_login_at, created_at, updated_at)
      VALUES (@id, @full_name, @email, @password_hash, @role, @title, @is_active, @is_protected_root, @last_login_at, @now, @now)
    `);
    for (const u of users) {
      insertUser.run({ ...u, now: isoNow });
    }

    // 2. Seed Multi-Protocol Monitors (real reachable public endpoints + realistic telemetry)
    const monitors = [
      {
        id: 'mon-https-gateway',
        name: 'Primary HTTP/HTTPS Gateway',
        target: 'https://example.com',
        protocol: 'HTTPS',
        http_method: 'GET',
        port: 443,
        dns_record_type: 'A',
        expected_status: '200',
        expected_keyword: 'Example Domain',
        expected_dns_answer: '',
        headers_json: JSON.stringify({ 'User-Agent': 'VigilNode-Prober/1.0' }),
        interval_sec: 60,
        timeout_ms: 5000,
        retry_threshold: 2,
        ssl_warning_days: 14,
        status: 'UP',
        enabled: 1,
        is_public: 1,
        tags_json: JSON.stringify(['#production', '#core-api']),
        last_response_time_ms: 42.5,
        last_error: '',
        ssl_expires_at: new Date(now.getTime() + 78 * 86400_000).toISOString(),
        ssl_days_remaining: 78,
        ssl_issuer: 'DigiCert Global G2 TLS RSA SHA256 2020 CA1',
        ssl_subject: 'example.com',
        ssl_valid: 1,
      },
      {
        id: 'mon-https-ietf',
        name: 'Web Documentation & RFC Portal',
        target: 'https://www.ietf.org',
        protocol: 'HTTPS',
        http_method: 'GET',
        port: 443,
        dns_record_type: 'A',
        expected_status: '200',
        expected_keyword: 'IETF',
        expected_dns_answer: '',
        headers_json: JSON.stringify({ Accept: 'text/html' }),
        interval_sec: 120,
        timeout_ms: 6000,
        retry_threshold: 2,
        ssl_warning_days: 14,
        status: 'UP',
        enabled: 1,
        is_public: 1,
        tags_json: JSON.stringify(['#production', '#web-portal']),
        last_response_time_ms: 68.2,
        last_error: '',
        ssl_expires_at: new Date(now.getTime() + 64 * 86400_000).toISOString(),
        ssl_days_remaining: 64,
        ssl_issuer: "Let's Encrypt E5",
        ssl_subject: 'www.ietf.org',
        ssl_valid: 1,
      },
      {
        id: 'mon-http-neverssl',
        name: 'Legacy HTTP Edge Redirect Check',
        target: 'http://example.com',
        protocol: 'HTTP',
        http_method: 'GET',
        port: 80,
        dns_record_type: 'A',
        expected_status: '200',
        expected_keyword: 'Example Domain',
        expected_dns_answer: '',
        headers_json: '{}',
        interval_sec: 180,
        timeout_ms: 5000,
        retry_threshold: 3,
        ssl_warning_days: 14,
        status: 'UP',
        enabled: 1,
        is_public: 1,
        tags_json: JSON.stringify(['#edge-http']),
        last_response_time_ms: 39.1,
        last_error: '',
        ssl_expires_at: null,
        ssl_days_remaining: null,
        ssl_issuer: null,
        ssl_subject: null,
        ssl_valid: null,
      },
      {
        id: 'mon-tcp-cloudflare',
        name: 'Public Ingress Socket (TCP 443)',
        target: '1.1.1.1',
        protocol: 'TCP',
        http_method: 'GET',
        port: 443,
        dns_record_type: 'A',
        expected_status: '',
        expected_keyword: '',
        expected_dns_answer: '',
        headers_json: '{}',
        interval_sec: 60,
        timeout_ms: 4000,
        retry_threshold: 2,
        ssl_warning_days: 14,
        status: 'UP',
        enabled: 1,
        is_public: 1,
        tags_json: JSON.stringify(['#production', '#ingress-tcp']),
        last_response_time_ms: 14.8,
        last_error: '',
        ssl_expires_at: null,
        ssl_days_remaining: null,
        ssl_issuer: null,
        ssl_subject: null,
        ssl_valid: null,
      },
      {
        id: 'mon-dns-example',
        name: 'Authoritative DNS Resolver (A Record)',
        target: 'example.com',
        protocol: 'DNS',
        http_method: 'GET',
        port: 53,
        dns_record_type: 'A',
        expected_status: '',
        expected_keyword: '',
        expected_dns_answer: '',
        headers_json: '{}',
        interval_sec: 120,
        timeout_ms: 4000,
        retry_threshold: 2,
        ssl_warning_days: 14,
        status: 'UP',
        enabled: 1,
        is_public: 1,
        tags_json: JSON.stringify(['#dns', '#production']),
        last_response_time_ms: 11.4,
        last_error: '',
        ssl_expires_at: null,
        ssl_days_remaining: null,
        ssl_issuer: null,
        ssl_subject: null,
        ssl_valid: null,
      },
      {
        id: 'mon-ssl-example',
        name: 'Wildcard SSL/TLS Watchdog',
        target: 'example.com',
        protocol: 'SSL',
        http_method: 'GET',
        port: 443,
        dns_record_type: 'A',
        expected_status: '',
        expected_keyword: '',
        expected_dns_answer: '',
        headers_json: '{}',
        interval_sec: 300,
        timeout_ms: 5000,
        retry_threshold: 2,
        ssl_warning_days: 30,
        status: 'UP',
        enabled: 1,
        is_public: 1,
        tags_json: JSON.stringify(['#security', '#ssl']),
        last_response_time_ms: 51.2,
        last_error: '',
        ssl_expires_at: new Date(now.getTime() + 78 * 86400_000).toISOString(),
        ssl_days_remaining: 78,
        ssl_issuer: 'DigiCert Global G2 TLS RSA SHA256 2020 CA1',
        ssl_subject: 'example.com',
        ssl_valid: 1,
      },
      {
        id: 'mon-checkout-api',
        name: 'Checkout Payment Ingestion API',
        target: 'https://httpbin.org/status/503',
        protocol: 'HTTPS',
        http_method: 'GET',
        port: 443,
        dns_record_type: 'A',
        expected_status: '200',
        expected_keyword: '',
        expected_dns_answer: '',
        headers_json: '{}',
        interval_sec: 300,
        timeout_ms: 5000,
        retry_threshold: 2,
        ssl_warning_days: 14,
        status: 'DOWN',
        enabled: 1,
        is_public: 1,
        tags_json: JSON.stringify(['#payment-gateway', '#critical']),
        last_response_time_ms: 312.4,
        last_error: 'HTTP 503 Service Unavailable (expected 200)',
        ssl_expires_at: new Date(now.getTime() + 11 * 86400_000).toISOString(),
        ssl_days_remaining: 11,
        ssl_issuer: 'Amazon RSA 2048 M02',
        ssl_subject: 'httpbin.org',
        ssl_valid: 1,
      },
      {
        id: 'mon-analytics-worker',
        name: 'Internal Batch Worker Health',
        target: 'https://www.iana.org',
        protocol: 'HTTPS',
        http_method: 'HEAD',
        port: 443,
        dns_record_type: 'A',
        expected_status: '200',
        expected_keyword: '',
        expected_dns_answer: '',
        headers_json: '{}',
        interval_sec: 300,
        timeout_ms: 5000,
        retry_threshold: 2,
        ssl_warning_days: 14,
        status: 'PAUSED',
        enabled: 0,
        is_public: 0, // Internal-only monitor, hidden from Public Status Page
        tags_json: JSON.stringify(['#internal', '#batch']),
        last_response_time_ms: 48.0,
        last_error: '',
        ssl_expires_at: new Date(now.getTime() + 92 * 86400_000).toISOString(),
        ssl_days_remaining: 92,
        ssl_issuer: 'DigiCert Inc',
        ssl_subject: 'www.iana.org',
        ssl_valid: 1,
      },
    ];

    const insertMonitor = db.prepare(`
      INSERT INTO monitors (
        id, name, target, protocol, http_method, port, dns_record_type,
        expected_status, expected_keyword, expected_dns_answer, headers_json,
        interval_sec, timeout_ms, retry_threshold, ssl_warning_days, status,
        enabled, is_public, tags_json, consecutive_failures, consecutive_successes,
        last_checked_at, last_response_time_ms, last_error,
        ssl_expires_at, ssl_days_remaining, ssl_issuer, ssl_subject, ssl_valid,
        created_by, created_at, updated_at
      ) VALUES (
        @id, @name, @target, @protocol, @http_method, @port, @dns_record_type,
        @expected_status, @expected_keyword, @expected_dns_answer, @headers_json,
        @interval_sec, @timeout_ms, @retry_threshold, @ssl_warning_days, @status,
        @enabled, @is_public, @tags_json, @consecutive_failures, @consecutive_successes,
        @last_checked_at, @last_response_time_ms, @last_error,
        @ssl_expires_at, @ssl_days_remaining, @ssl_issuer, @ssl_subject, @ssl_valid,
        'USR-001', @created_at, @now
      )
    `);

    const createdAt90d = new Date(now.getTime() - 90 * 86400_000).toISOString();
    for (const m of monitors) {
      insertMonitor.run({
        ...m,
        consecutive_failures: m.status === 'DOWN' ? 3 : 0,
        consecutive_successes: m.status === 'UP' ? 12 : 0,
        last_checked_at: new Date(now.getTime() - 45_000).toISOString(),
        created_at: createdAt90d,
        now: isoNow,
      });
    }

    // 3. Seed realistic check telemetry over the past 30 days + last 24h for charts & SQL aggregations
    const insertCheck = db.prepare(`
      INSERT INTO monitor_checks (monitor_id, status, response_time_ms, status_code, error_message, details_json, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (let mIdx = 0; mIdx < monitors.length; mIdx++) {
      const m = monitors[mIdx];
      const baseLatency = m.last_response_time_ms || 35;

      // 30 daily points + 24 hourly points
      for (let d = 29; d >= 1; d--) {
        const ts = new Date(now.getTime() - d * 86400_000 + (mIdx * 300_000)).toISOString();
        const isSpike = (m.id === 'mon-checkout-api' && (d === 4 || d === 12)) || (m.id === 'mon-https-gateway' && d === 18);
        const status = isSpike ? 'DOWN' : 'UP';
        const latency = isSpike ? baseLatency + 190 : Math.round((baseLatency + ((d * 7 + mIdx * 3) % 19) - 5) * 10) / 10;
        insertCheck.run(
          m.id,
          status,
          Math.max(5, latency),
          m.protocol.startsWith('HTTP') ? (isSpike ? 503 : 200) : null,
          isSpike ? 'Upstream transient timeout during synthetic check' : '',
          JSON.stringify({ protocol: m.protocol, seeded_history: true }),
          ts,
        );
      }

      for (let h = 23; h >= 0; h--) {
        const ts = new Date(now.getTime() - h * 3600_000 + (mIdx * 60_000)).toISOString();
        const isCurrentDown = m.status === 'DOWN' && h <= 1;
        const status = isCurrentDown ? 'DOWN' : 'UP';
        const latency = isCurrentDown
          ? 312.4
          : Math.round((baseLatency + Math.sin(h + mIdx) * 8 + ((h * 5) % 9)) * 10) / 10;
        insertCheck.run(
          m.id,
          status,
          Math.max(4, latency),
          m.protocol.startsWith('HTTP') ? (isCurrentDown ? 503 : 200) : null,
          isCurrentDown ? 'HTTP 503 Service Unavailable (expected 200)' : '',
          JSON.stringify({ protocol: m.protocol }),
          ts,
        );
      }
    }

    // 4. Seed Incidents (1 Active Investigating + 3 Resolved)
    const inc1Started = new Date(now.getTime() - 28 * 60_000).toISOString();
    const inc1Ack = new Date(now.getTime() - 25 * 60_000).toISOString();
    db.prepare(`
      INSERT INTO incidents (id, code, monitor_id, title, severity, status, summary, root_cause, diagnostic_payload, assigned_to, sync_public_status, started_at, acknowledged_at, resolved_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'inc-8924',
      '#INC-8924',
      'mon-checkout-api',
      'Checkout Payment Ingestion API — HTTP 503 Service Unavailable',
      'CRITICAL',
      'Investigating',
      'Synthetic probe detected consecutive HTTP 503 failures against target endpoint.',
      'Upstream connection pool saturation detected on checkout gateway.',
      JSON.stringify({ http_status: 503, expected: 200, latency_ms: 312.4 }),
      'Shubham Bind',
      1,
      inc1Started,
      inc1Ack,
      null,
      inc1Started,
      isoNow,
    );

    const insertNote = db.prepare(`
      INSERT INTO incident_notes (incident_id, phase, message, author_name, author_role, is_system, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertNote.run(
      'inc-8924',
      'Investigating',
      'Automated probe engine opened incident after 2 consecutive HTTP 503 failures.',
      'VigilNode Scheduler',
      'SYSTEM',
      1,
      inc1Started,
    );
    insertNote.run(
      'inc-8924',
      'Investigating',
      'On-duty SRE acknowledged alert and began inspecting upstream gateway connection pool metrics.',
      'Shubham Bind',
      'ADMIN',
      0,
      inc1Ack,
    );

    const resolvedIncidents = [
      {
        id: 'inc-8894',
        code: '#INC-8894',
        monitor_id: 'mon-tcp-cloudflare',
        title: 'Edge Ingress Latency & Brief TCP Reset',
        severity: 'HIGH',
        summary: 'Brief TCP handshake timeout observed across 2 consecutive cycles.',
        root_cause: 'Regional transit BGP route reconvergence completed automatically.',
        started_at: new Date(now.getTime() - 2 * 86400_000).toISOString(),
        acknowledged_at: new Date(now.getTime() - 2 * 86400_000 + 120_000).toISOString(),
        resolved_at: new Date(now.getTime() - 2 * 86400_000 + 840_000).toISOString(),
      },
      {
        id: 'inc-8840',
        code: '#INC-8840',
        monitor_id: 'mon-https-gateway',
        title: 'Primary Gateway Transient 502 Bad Gateway',
        severity: 'MEDIUM',
        summary: 'Upstream edge returned transient 502 response during rolling reload.',
        root_cause: 'Graceful drain timeout adjusted to 30s on ingress proxy.',
        started_at: new Date(now.getTime() - 6 * 86400_000).toISOString(),
        acknowledged_at: new Date(now.getTime() - 6 * 86400_000 + 95_000).toISOString(),
        resolved_at: new Date(now.getTime() - 6 * 86400_000 + 540_000).toISOString(),
      },
      {
        id: 'inc-8792',
        code: '#INC-8792',
        monitor_id: 'mon-dns-example',
        title: 'Authoritative DNS Propagation Delay',
        severity: 'LOW',
        summary: 'DNS resolver query exceeded 2000ms SLA threshold.',
        root_cause: 'Anycast resolver cache refreshed cleanly.',
        started_at: new Date(now.getTime() - 12 * 86400_000).toISOString(),
        acknowledged_at: new Date(now.getTime() - 12 * 86400_000 + 180_000).toISOString(),
        resolved_at: new Date(now.getTime() - 12 * 86400_000 + 720_000).toISOString(),
      },
    ];

    for (const ri of resolvedIncidents) {
      db.prepare(`
        INSERT INTO incidents (id, code, monitor_id, title, severity, status, summary, root_cause, diagnostic_payload, assigned_to, sync_public_status, started_at, acknowledged_at, resolved_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'Resolved', ?, ?, '{}', 'Shubham Bind', 1, ?, ?, ?, ?, ?)
      `).run(
        ri.id,
        ri.code,
        ri.monitor_id,
        ri.title,
        ri.severity,
        ri.summary,
        ri.root_cause,
        ri.started_at,
        ri.acknowledged_at,
        ri.resolved_at,
        ri.started_at,
        ri.resolved_at,
      );
      insertNote.run(ri.id, 'Investigating', ri.summary, 'VigilNode Scheduler', 'SYSTEM', 1, ri.started_at);
      insertNote.run(ri.id, 'Resolved', ri.root_cause, 'Shubham Bind', 'ADMIN', 0, ri.resolved_at);
    }

    // 5. Seed Maintenance Windows
    const mwUpcomingStart = new Date(now.getTime() + 6 * 3600_000).toISOString();
    const mwUpcomingEnd = new Date(now.getTime() + 7.5 * 3600_000).toISOString();
    db.prepare(`
      INSERT INTO maintenance_windows (id, code, title, description, expected_impact, start_time, end_time, status, suppress_alerts, notify_subscribers, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'UPCOMING', 1, 1, 'Shubham Bind', ?, ?)
    `).run(
      'mw-4092',
      '#MNT-4092',
      'Core HTTP/HTTPS Gateway TLS Cipher & Connection Pool Tuning',
      'Planned zero-downtime edge proxy configuration reload and TLS session ticket rotation.',
      'Brief < 30s latency elevation during worker recycle',
      mwUpcomingStart,
      mwUpcomingEnd,
      isoNow,
      isoNow,
    );
    db.prepare('INSERT INTO maintenance_monitors (maintenance_id, monitor_id) VALUES (?, ?)').run('mw-4092', 'mon-https-gateway');
    db.prepare('INSERT INTO maintenance_monitors (maintenance_id, monitor_id) VALUES (?, ?)').run('mw-4092', 'mon-ssl-example');

    db.prepare(`
      INSERT INTO maintenance_windows (id, code, title, description, expected_impact, start_time, end_time, status, suppress_alerts, notify_subscribers, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'COMPLETED', 1, 1, 'Shubham Bind', ?, ?)
    `).run(
      'mw-4015',
      '#MNT-4015',
      'Authoritative DNS Anycast Zone Serial Sync',
      'Scheduled DNSSEC key rollover and secondary zone synchronization.',
      'No downtime expected',
      new Date(now.getTime() - 5 * 86400_000).toISOString(),
      new Date(now.getTime() - 5 * 86400_000 + 2700_000).toISOString(),
      new Date(now.getTime() - 6 * 86400_000).toISOString(),
      new Date(now.getTime() - 5 * 86400_000 + 2700_000).toISOString(),
    );
    db.prepare('INSERT INTO maintenance_monitors (maintenance_id, monitor_id) VALUES (?, ?)').run('mw-4015', 'mon-dns-example');

    // 6. Seed Notification Channels (Disabled until Admin configures real credentials!)
    const channels = [
      {
        id: 'ch-email-smtp',
        channel_type: 'EMAIL_SMTP',
        name: 'Gmail SMTP',
        enabled: 0,
        config_json: JSON.stringify({
          smtp_host: process.env.GMAIL_SMTP_HOST || 'smtp.gmail.com',
          smtp_port: Number(process.env.GMAIL_SMTP_PORT) || 587,
          use_tls: true,
          smtp_user: process.env.GMAIL_SMTP_USER || '',
          smtp_password: process.env.GMAIL_SMTP_APP_PASSWORD || '',
          from_email: process.env.GMAIL_SMTP_USER || '',
          to_emails: '',
        }),
      },
      {
        id: 'ch-telegram',
        channel_type: 'TELEGRAM',
        name: 'Telegram Bot',
        enabled: 0,
        config_json: JSON.stringify({
          bot_token: process.env.TELEGRAM_BOT_TOKEN || '',
          chat_id: process.env.TELEGRAM_CHAT_ID || '',
          parse_mode: 'HTML',
        }),
      },
      {
        id: 'ch-discord',
        channel_type: 'DISCORD',
        name: 'Discord Webhook',
        enabled: 0,
        config_json: JSON.stringify({
          webhook_url: process.env.DISCORD_WEBHOOK_URL || '',
          username: 'VigilNode Telemetry',
        }),
      },
      {
        id: 'ch-slack',
        channel_type: 'SLACK',
        name: 'Slack Webhook',
        enabled: 0,
        config_json: JSON.stringify({
          webhook_url: process.env.SLACK_WEBHOOK_URL || '',
          channel: '#sre-alerts',
          username: 'VigilNode Incident Dispatcher',
        }),
      },
    ];

    const insertChannel = db.prepare(`
      INSERT INTO notification_channels (id, channel_type, name, enabled, config_json, updated_at)
      VALUES (@id, @channel_type, @name, @enabled, @config_json, @now)
    `);
    for (const ch of channels) {
      insertChannel.run({ ...ch, now: isoNow });
    }

    // 7. Seed Alert Rules
    const rules = [
      {
        id: 'rule-down',
        name: 'Monitor Down',
        severity: 'CRITICAL',
        trigger_type: 'CONSECUTIVE_FAILURE',
        trigger_description: 'Synthetic probe fails consecutive retry threshold checks.',
        retry_threshold: 2,
        cooldown_minutes: 10,
        channels_json: JSON.stringify(['EMAIL_SMTP', 'TELEGRAM', 'SLACK']),
        enabled: 1,
      },
      {
        id: 'rule-http-5xx',
        name: 'HTTP 5xx Status Errors',
        severity: 'CRITICAL',
        trigger_type: 'HTTP_5XX',
        trigger_description: 'Target returns HTTP status >= 500 or unexpected status code.',
        retry_threshold: 2,
        cooldown_minutes: 10,
        channels_json: JSON.stringify(['SLACK', 'DISCORD', 'EMAIL_SMTP']),
        enabled: 1,
      },
      {
        id: 'rule-tcp',
        name: 'TCP Connection Failure',
        severity: 'HIGH',
        trigger_type: 'TCP_TIMEOUT',
        trigger_description: 'Raw TCP SYN-ACK handshake times out or connection refused.',
        retry_threshold: 2,
        cooldown_minutes: 15,
        channels_json: JSON.stringify(['TELEGRAM', 'DISCORD']),
        enabled: 1,
      },
      {
        id: 'rule-dns',
        name: 'DNS Resolution Failure',
        severity: 'CRITICAL',
        trigger_type: 'DNS_FAILURE',
        trigger_description: 'DNS resolver returns NXDOMAIN, SERVFAIL, or mismatched answer.',
        retry_threshold: 2,
        cooldown_minutes: 10,
        channels_json: JSON.stringify(['EMAIL_SMTP', 'TELEGRAM', 'SLACK']),
        enabled: 1,
      },
      {
        id: 'rule-ssl',
        name: 'SSL/TLS Certificate Expiry Warning',
        severity: 'MEDIUM',
        trigger_type: 'SSL_EXPIRY',
        trigger_description: 'X.509 certificate expires within configured threshold (30/14/7 days).',
        retry_threshold: 1,
        cooldown_minutes: 1440,
        channels_json: JSON.stringify(['EMAIL_SMTP', 'SLACK']),
        enabled: 1,
      },
    ];
    const insertRule = db.prepare(`
      INSERT INTO alert_rules (id, name, severity, trigger_type, trigger_description, retry_threshold, cooldown_minutes, channels_json, enabled, created_at)
      VALUES (@id, @name, @severity, @trigger_type, @trigger_description, @retry_threshold, @cooldown_minutes, @channels_json, @enabled, @now)
    `);
    for (const r of rules) {
      insertRule.run({ ...r, now: isoNow });
    }

    // 8. Seed System Settings (All 7 categories)
    const defaultSettings: Record<string, Record<string, unknown>> = {
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

    const insertSetting = db.prepare(
      'INSERT INTO system_settings (category, config_json, updated_at) VALUES (?, ?, ?)',
    );
    for (const [category, cfg] of Object.entries(defaultSettings)) {
      insertSetting.run(category, JSON.stringify(cfg), isoNow);
    }

    // 9. Seed Initial Audit Log
    db.prepare(
      `INSERT INTO audit_logs (user_id, user_email, user_role, action, resource_type, resource_id, details_json, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'USR-001',
      'shubham.bind@vigilnode.local',
      'ADMIN',
      'SYSTEM_INITIALIZED',
      'system',
      crypto.randomUUID(),
      JSON.stringify({ schema_version: 1, seeded_monitors: monitors.length }),
      '127.0.0.1',
      isoNow,
    );
  });

  insertAll();
}
