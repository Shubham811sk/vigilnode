import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { createApp } from '../server/app.ts';
import { config } from '../server/core/config.ts';
import { verifyPassword } from '../server/core/security.ts';
import { getDb } from '../server/db/database.ts';
import { executeProbe } from '../server/monitoring/prober.ts';
import { runMonitorCheck } from '../server/monitoring/scheduler.ts';
import { dispatchToChannel } from '../server/notifications/dispatcher.ts';

describe('VigilNode Complete Platform Automated Test Suite', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>['app'];
  let adminToken = '';
  let viewerToken = '';
  let localHttpServer: http.Server;
  let localHttpPort = 0;
  let mockSmtpServer: net.Server;
  let mockSmtpPort = 0;
  let receivedSmtpPayload = '';

  beforeAll(async () => {
    db = getDb(':memory:');
    const created = createApp(db);
    app = created.app;

    // Start local ephemeral HTTP server for real HTTP + TCP probing tests
    localHttpServer = http.createServer((req, res) => {
      if (req.url === '/down') {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('service unavailable');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'healthy', ok: true }));
    });
    await new Promise<void>((resolve) => {
      localHttpServer.listen(0, '127.0.0.1', () => {
        const addr = localHttpServer.address() as net.AddressInfo;
        localHttpPort = addr.port;
        resolve();
      });
    });

    // Start local in-process mock SMTP server to verify real nodemailer SMTP delivery
    mockSmtpServer = net.createServer((socket) => {
      socket.write('220 mock-smtp.vigilnode.test ESMTP Ready\r\n');
      let buffer = '';
      let inData = false;
      socket.on('data', (chunk) => {
        const str = chunk.toString('utf8');
        buffer += str;
        if (inData) {
          receivedSmtpPayload += str;
          if (buffer.includes('\r\n.\r\n')) {
            inData = false;
            buffer = '';
            socket.write('250 2.0.0 OK queued\r\n');
          }
          return;
        }
        const lines = buffer.split('\r\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const upper = line.toUpperCase();
          if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
            socket.write('250-mock-smtp.vigilnode.test\r\n250 AUTH PLAIN LOGIN\r\n');
          } else if (upper.startsWith('AUTH PLAIN')) {
            socket.write('235 2.7.0 Authentication successful\r\n');
          } else if (upper.startsWith('MAIL FROM') || upper.startsWith('RCPT TO')) {
            socket.write('250 2.1.0 OK\r\n');
          } else if (upper === 'DATA') {
            inData = true;
            socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
          } else if (upper === 'QUIT') {
            socket.write('221 Bye\r\n');
            socket.end();
          } else {
            socket.write('250 OK\r\n');
          }
        }
      });
    });
    await new Promise<void>((resolve) => {
      mockSmtpServer.listen(0, '127.0.0.1', () => {
        const addr = mockSmtpServer.address() as net.AddressInfo;
        mockSmtpPort = addr.port;
        resolve();
      });
    });

    // Authenticate seeded Admin and Read-Only Maintainer accounts
    const adminRes = await request(app)
      .post('/api/auth/login')
      .set('x-bypass-ratelimit', 'true')
      .send({ email: 'shubham.bind@vigilnode.local', password: 'Admin@1234' });
    expect(adminRes.status).toBe(200);
    adminToken = adminRes.body.access_token;

    const viewerRes = await request(app)
      .post('/api/auth/login')
      .set('x-bypass-ratelimit', 'true')
      .send({ email: 'maintainer@vigilnode.local', password: 'Viewer@1234' });
    expect(viewerRes.status).toBe(200);
    viewerToken = viewerRes.body.access_token;
  });

  afterAll(async () => {
    if (localHttpServer?.listening) {
      await new Promise<void>((resolve) => localHttpServer.close(() => resolve()));
    }
    if (mockSmtpServer?.listening) {
      await new Promise<void>((resolve) => mockSmtpServer.close(() => resolve()));
    }
    db?.close();
  });

  it('1. Verifies password hashing, JWT auth, and rejects invalid credentials', async () => {
    const row = db
      .prepare('SELECT password_hash FROM users WHERE email = ?')
      .get('shubham.bind@vigilnode.local') as { password_hash: string };
    expect(row.password_hash).not.toBe('Admin@1234');
    expect(verifyPassword('Admin@1234', row.password_hash)).toBe(true);

    const badLogin = await request(app)
      .post('/api/auth/login')
      .set('x-bypass-ratelimit', 'true')
      .send({ email: 'shubham.bind@vigilnode.local', password: 'WrongPassword' });
    expect(badLogin.status).toBe(401);

    const unauth = await request(app).get('/api/monitors');
    expect(unauth.status).toBe(401);
  });

  it('2. Enforces strict 2-role RBAC (403 for READ_ONLY_MAINTAINER mutations) & Last-Admin Guard', async () => {
    // Read-only maintainer can read monitors & analytics
    const readRes = await request(app)
      .get('/api/monitors')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(readRes.status).toBe(200);

    // Read-only maintainer is blocked (403) from creating monitors, incidents, users, or editing settings
    const createMon = await request(app)
      .post('/api/monitors')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ name: 'Unauthorized Mon', target: 'https://example.com', protocol: 'HTTPS' });
    expect(createMon.status).toBe(403);

    const createInc = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ title: 'Unauthorized Incident', severity: 'HIGH' });
    expect(createInc.status).toBe(403);

    const createUser = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ full_name: 'Bad', email: 'bad@example.com', password: 'Password123', role: 'ADMIN' });
    expect(createUser.status).toBe(403);

    // Root Admin protection
    const deleteRoot = await request(app)
      .delete('/api/users/USR-001')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(deleteRoot.status).toBe(400);
  });

  it('3. Enforces SSRF protection against localhost, private CIDR, and cloud metadata IPs', async () => {
    const targets = [
      { protocol: 'HTTP', target: 'http://127.0.0.1:8080/health' },
      { protocol: 'HTTP', target: 'http://169.254.169.254/latest/meta-data/' },
      { protocol: 'TCP', target: '10.0.0.12', port: 5432 },
      { protocol: 'HTTPS', target: 'https://localhost:3000' },
    ];
    for (const t of targets) {
      const res = await request(app)
        .post('/api/monitors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'SSRF Test', ...t });
      expect(res.status).toBe(400);
      expect(String(res.body.detail)).toMatch(/SSRF/i);
    }
  });

  it('4. Creates, prevents duplicates, updates, pauses/resumes, and deletes monitors', async () => {
    const createRes = await request(app)
      .post('/api/monitors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Unique Probe Site',
        target: 'https://status-probe-unique.example.org',
        protocol: 'HTTPS',
        interval_sec: 120,
        timeout_ms: 4000,
        run_initial_check: false,
      });
    expect(createRes.status).toBe(201);
    const monId = createRes.body.id;

    // Duplicate monitor rejection (409)
    const dupRes = await request(app)
      .post('/api/monitors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Duplicate Unique Probe',
        target: 'https://status-probe-unique.example.org',
        protocol: 'HTTPS',
        run_initial_check: false,
      });
    expect(dupRes.status).toBe(409);

    // Pause / Resume
    const pauseRes = await request(app)
      .post(`/api/monitors/${monId}/toggle-pause`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(pauseRes.status).toBe(200);
    expect(pauseRes.body.status).toBe('PAUSED');

    const resumeRes = await request(app)
      .post(`/api/monitors/${monId}/toggle-pause`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body.status).toBe('UP');

    // Delete
    const delRes = await request(app)
      .delete(`/api/monitors/${monId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(delRes.status).toBe(200);
  });

  it('5. Executes real HTTP, TCP, and invalid-target probes against live ephemeral server', async () => {
    const prevAllow = config.allowPrivateTargets;
    config.allowPrivateTargets = true;
    try {
      const httpUp = await executeProbe({
        protocol: 'HTTP',
        target: `http://127.0.0.1:${localHttpPort}/health`,
        expected_status: '200',
        expected_keyword: 'healthy',
        timeout_ms: 2000,
      });
      expect(httpUp.status).toBe('UP');
      expect(httpUp.status_code).toBe(200);

      const httpDown = await executeProbe({
        protocol: 'HTTP',
        target: `http://127.0.0.1:${localHttpPort}/down`,
        expected_status: '200',
        timeout_ms: 2000,
      });
      expect(httpDown.status).toBe('DOWN');
      expect(httpDown.status_code).toBe(503);

      const tcpUp = await executeProbe({
        protocol: 'TCP',
        target: '127.0.0.1',
        port: localHttpPort,
        timeout_ms: 2000,
      });
      expect(tcpUp.status).toBe('UP');

      const tcpClosed = await executeProbe({
        protocol: 'TCP',
        target: '127.0.0.1',
        port: 1,
        timeout_ms: 1000,
      });
      expect(tcpClosed.status).toBe('DOWN');
    } finally {
      config.allowPrivateTargets = prevAllow;
    }
  });

  it('6. Suppresses alerts during active maintenance while preserving check telemetry, and handles incident auto-create/recovery', async () => {
    // Insert monitor with retry_threshold = 1
    const monId = 'mon-sched-test';
    const nowIso = new Date().toISOString();
    db.prepare(`
      INSERT INTO monitors (id, name, target, protocol, interval_sec, timeout_ms, retry_threshold, status, enabled, is_public, created_at, updated_at)
      VALUES (?, 'Scheduler Test Service', 'https://sched.example.com', 'HTTPS', 60, 3000, 1, 'UP', 1, 1, ?, ?)
    `).run(monId, nowIso, nowIso);

    // Active maintenance window covering this monitor
    const mwRes = await request(app)
      .post('/api/maintenance')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Planned Maintenance Window',
        start_time: new Date(Date.now() - 60_000).toISOString(),
        end_time: new Date(Date.now() + 600_000).toISOString(),
        suppress_alerts: true,
        affected_monitor_ids: [monId],
      });
    expect(mwRes.status).toBe(201);
    const mwId = mwRes.body.id;

    // Failing probe during maintenance: check is stored, alert is suppressed, NO incident created
    const maintCheck = await runMonitorCheck(db, monId, {
      proberFn: async () => ({
        status: 'DOWN',
        response_time_ms: 120,
        status_code: 503,
        error_message: 'Planned maintenance reboot',
        details: {},
      }),
    });
    expect(maintCheck?.suppressed_by_maintenance).toBe(true);
    expect(maintCheck?.incident_id).toBeNull();
    const checkCount = (
      db.prepare('SELECT COUNT(*) as cnt FROM monitor_checks WHERE monitor_id = ?').get(monId) as { cnt: number }
    ).cnt;
    expect(checkCount).toBe(1);

    // Cancel maintenance window, then simulate real failure -> auto-creates incident
    await request(app)
      .post(`/api/maintenance/${mwId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`);

    const failCheck = await runMonitorCheck(db, monId, {
      proberFn: async () => ({
        status: 'DOWN',
        response_time_ms: 410,
        status_code: 500,
        error_message: 'HTTP 500 Internal Error',
        details: {},
      }),
    });
    expect(failCheck?.suppressed_by_maintenance).toBe(false);
    expect(failCheck?.incident_id).toBeTruthy();

    // Two consecutive healthy probes auto-resolve the incident
    await runMonitorCheck(db, monId, {
      proberFn: async () => ({ status: 'UP', response_time_ms: 25, status_code: 200, error_message: '', details: {} }),
    });
    await runMonitorCheck(db, monId, {
      proberFn: async () => ({ status: 'UP', response_time_ms: 22, status_code: 200, error_message: '', details: {} }),
    });

    const incRow = db.prepare('SELECT status FROM incidents WHERE id = ?').get(failCheck!.incident_id!) as { status: string };
    expect(incRow.status).toBe('Resolved');
  });

  it('7. Enforces strict sequential Incident Lifecycle transitions (Investigating -> Identified -> Monitoring -> Resolved)', async () => {
    const createRes = await request(app)
      .post('/api/incidents')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ title: 'Lifecycle Enforcement Test', severity: 'HIGH', summary: 'Testing state transitions' });
    expect(createRes.status).toBe(201);
    const incId = createRes.body.id;

    // Skipping Investigating -> Resolved must be rejected (400)
    const invalidSkip = await request(app)
      .patch(`/api/incidents/${incId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'Resolved' });
    expect(invalidSkip.status).toBe(400);

    // Valid sequential transitions
    for (const next of ['Identified', 'Monitoring', 'Resolved']) {
      const ok = await request(app)
        .patch(`/api/incidents/${incId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: next, message: `Moving to ${next}` });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe(next);
    }
  });

  it('8. Dispatches real SMTP mail to mock listener, masks secrets on GET, and rejects unconfigured webhooks truthfully', async () => {
    // Save SMTP config pointing to our in-process mock SMTP TCP listener
    const saveRes = await request(app)
      .put('/api/integrations/channels/ch-email-smtp')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        enabled: true,
        config: {
          smtp_host: '127.0.0.1',
          smtp_port: mockSmtpPort,
          smtp_user: 'alerts@vigilnode.local',
          smtp_password: 'super-secret-smtp-password',
          from_email: 'alerts@vigilnode.local',
          to_emails: 'ops@vigilnode.local',
          use_tls: false,
          allow_self_signed: true,
        },
      });
    expect(saveRes.status).toBe(200);

    // Ensure GET masks secret
    const getRes = await request(app)
      .get('/api/integrations')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.status).toBe(200);
    const emailCh = getRes.body.channels.find((c: { id: string }) => c.id === 'ch-email-smtp');
    expect(emailCh.config.smtp_password).not.toContain('super-secret');
    expect(emailCh.config.smtp_password).toContain('••••');

    // Trigger real SMTP dispatch via dispatcher
    const row = db.prepare("SELECT * FROM notification_channels WHERE id = 'ch-email-smtp'").get() as {
      id: string;
      channel_type: string;
      name: string;
      enabled: number;
      config_json: string;
    };
    const delivery = await dispatchToChannel(db, row, {
      event_type: 'TEST_SMTP',
      severity: 'INFO',
      title: 'Mock SMTP Delivery Proof',
      message: 'Real TCP SMTP envelope delivered.',
    });
    expect(delivery.status).toBe('SENT');
    expect(receivedSmtpPayload).toContain('Mock SMTP Delivery Proof');

    // Unconfigured Slack channel test must fail truthfully (400), never fake success
    const slackFail = await request(app)
      .post('/api/integrations/channels/ch-slack/test')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ dry_run: false });
    expect(slackFail.status).toBe(400);
  });

  it('9. Sanitizes Public Status Portal & generates analytics + CSV exports', async () => {
    const pubRes = await request(app).get('/api/public/status').set('x-bypass-ratelimit', 'true');
    expect(pubRes.status).toBe(200);
    expect(Array.isArray(pubRes.body.services)).toBe(true);
    // Internal .internal hostnames must be masked on public status
    const rawJson = JSON.stringify(pubRes.body.services);
    expect(rawJson).not.toContain('.internal');
    expect(rawJson).not.toContain('smtp_password');

    const analyticsRes = await request(app)
      .get('/api/analytics?range=30d')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(analyticsRes.status).toBe(200);
    expect(analyticsRes.body.overview).toHaveProperty('p95_ms');

    const csvRes = await request(app)
      .get('/api/analytics/export.csv')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers['content-type']).toContain('text/csv');
    expect(csvRes.text).toContain('monitor_name,protocol');
  });
});
