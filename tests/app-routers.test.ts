import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type Database from 'better-sqlite3';
import { createApp } from '../server/app.ts';
import { signJwt } from '../server/core/security.ts';
import { getDb } from '../server/db/database.ts';

describe('server/app.ts & Associated Routers Unit Tests', () => {
  let db: Database.Database;
  let app: ReturnType<typeof createApp>['app'];
  let adminToken = '';
  let viewerToken = '';

  beforeAll(async () => {
    db = getDb(':memory:');
    const created = createApp(db);
    app = created.app;

    const adminLogin = await request(app)
      .post('/api/auth/login')
      .set('x-bypass-ratelimit', 'true')
      .send({ email: 'shubham.bind@vigilnode.local', password: 'Admin@1234' });
    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.access_token;

    const viewerLogin = await request(app)
      .post('/api/auth/login')
      .set('x-bypass-ratelimit', 'true')
      .send({ email: 'maintainer@vigilnode.local', password: 'Viewer@1234' });
    expect(viewerLogin.status).toBe(200);
    viewerToken = viewerLogin.body.access_token;
  });

  afterAll(() => {
    db?.close();
  });

  describe('Core App Health, Security Headers & Global Error Handling (server/app.ts)', () => {
    it('returns healthy status and security headers on GET /api/health', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.service).toBe('VigilNode API');
      expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    const createMockDb = (healthMode: 'degraded' | 'throw') =>
      ({
        prepare: vi.fn((sql: string): {
          get: () => Record<string, unknown> | undefined;
          all: () => Array<Record<string, unknown>>;
          run: () => { changes: number };
        } => {
          if (sql.includes('SELECT COUNT(*) as cnt FROM users')) {
            return { get: () => ({ cnt: 1 }), all: () => [], run: () => ({ changes: 0 }) };
          }
          if (sql.includes('SELECT 1 as ok')) {
            if (healthMode === 'throw') {
              throw new Error('SQLITE_CORRUPT: simulated DB failure');
            }
            return { get: () => ({ ok: 0 }), all: () => [], run: () => ({ changes: 0 }) };
          }
          return { get: () => undefined, all: () => [], run: () => ({ changes: 0 }) };
        }),
      }) as unknown as Database.Database;

    it('returns degraded status when health query does not return ok=1', async () => {
      const { app: degradedApp } = createApp(createMockDb('degraded'));
      const res = await request(degradedApp).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('degraded');
    });

    it('returns structured 500 JSON when an unhandled route/DB error is thrown', async () => {
      const { app: brokenApp } = createApp(createMockDb('throw'));
      const res = await request(brokenApp).get('/api/health');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ detail: 'SQLITE_CORRUPT: simulated DB failure' });
    });

    it('returns structured 404 JSON for unknown /api/* endpoints across HTTP methods', async () => {
      const getMissing = await request(app).get('/api/nonexistent/route');
      expect(getMissing.status).toBe(404);
      expect(getMissing.body.detail).toContain('API endpoint not found: GET /api/nonexistent/route');

      const postMissing = await request(app).post('/api/another-missing');
      expect(postMissing.status).toBe(404);
      expect(postMissing.body.detail).toContain('API endpoint not found: POST /api/another-missing');
    });

    it('handles malformed JSON payloads with structured JSON error response', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .set('x-bypass-ratelimit', 'true')
        .set('Content-Type', 'application/json')
        .send('{"email": "broken-json"');
      expect(res.status).toBe(500);
      expect(typeof res.body.detail).toBe('string');
      expect(res.body.detail.length).toBeGreaterThan(0);
    });

    it('streams valid full project source ZIP on GET /api/export/source.zip without secrets or node_modules', async () => {
      const res = await request(app)
        .get('/api/export/source.zip')
        .buffer(true)
        .parse((resObj, cb) => {
          const chunks: Buffer[] = [];
          resObj.on('data', (c: Buffer) => chunks.push(c));
          resObj.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/zip');
      expect(res.headers['content-disposition']).toContain('vigilnode-full-source.zip');
      const buf = res.body as Buffer;
      expect(buf.subarray(0, 4).toString('hex')).toBe('504b0304');
      const textScan = buf.toString('latin1');
      expect(textScan).toContain('vigilnode/package.json');
      expect(textScan).toContain('vigilnode/server/app.ts');
      expect(textScan).not.toContain('vigilnode/node_modules/');
      expect(textScan).not.toContain('vigilnode/.env\0');
    });
  });

  describe('Auth Router Error & Edge Cases (server/routes/auth.ts)', () => {
    it('rejects missing credentials (400), bad JWTs (401), and deleted user token (404)', async () => {
      const missingRes = await request(app)
        .post('/api/auth/login')
        .set('x-bypass-ratelimit', 'true')
        .send({ email: '', password: '' });
      expect(missingRes.status).toBe(400);

      const badTokenRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid.jwt.token');
      expect(badTokenRes.status).toBe(401);

      const ghostToken = signJwt({
        id: 'USR-DOES-NOT-EXIST',
        email: 'ghost@vigilnode.local',
        full_name: 'Ghost User',
        role: 'ADMIN',
      });
      const ghostRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${ghostToken}`);
      expect(ghostRes.status).toBe(404);
    });

    it('blocks deactivated user login (403) and validates password changes', async () => {
      const createRes = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          full_name: 'Temp Operator',
          email: 'temp.op@vigilnode.local',
          role: 'READ_ONLY_MAINTAINER',
          password: 'InitialPassword1!',
        });
      expect(createRes.status).toBe(201);
      const userId = createRes.body.id;

      // Deactivate user
      const deactRes = await request(app)
        .patch(`/api/users/${userId}/status`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(deactRes.status).toBe(200);
      expect(deactRes.body.is_active).toBe(false);

      const blockedLogin = await request(app)
        .post('/api/auth/login')
        .set('x-bypass-ratelimit', 'true')
        .send({ email: 'temp.op@vigilnode.local', password: 'InitialPassword1!' });
      expect(blockedLogin.status).toBe(403);

      // Re-activate and test change-password validation
      await request(app)
        .patch(`/api/users/${userId}/status`)
        .set('Authorization', `Bearer ${adminToken}`);

      const activeLogin = await request(app)
        .post('/api/auth/login')
        .set('x-bypass-ratelimit', 'true')
        .send({ email: 'temp.op@vigilnode.local', password: 'InitialPassword1!' });
      const tempToken = activeLogin.body.access_token;

      const shortPw = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${tempToken}`)
        .send({ current_password: 'InitialPassword1!', new_password: 'short' });
      expect(shortPw.status).toBe(400);

      const wrongCurrent = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${tempToken}`)
        .send({ current_password: 'WrongPassword!', new_password: 'NewValidPassword1!' });
      expect(wrongCurrent.status).toBe(400);

      const okChange = await request(app)
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${tempToken}`)
        .send({ current_password: 'InitialPassword1!', new_password: 'NewValidPassword1!' });
      expect(okChange.status).toBe(200);

      // Cleanup
      await request(app).delete(`/api/users/${userId}`).set('Authorization', `Bearer ${adminToken}`);
    });
  });

  describe('Monitors Router Validation, Bulk & 404 Handling (server/routes/monitors.ts)', () => {
    it('validates monitor fields and protocol-specific requirements', async () => {
      const invalidCases = [
        { name: 'A', target: 'https://example.org', protocol: 'HTTPS' },
        { name: 'Bad Proto', target: 'https://example.org', protocol: 'FTP' },
        { name: 'Low Interval', target: 'https://example.org', protocol: 'HTTPS', interval_sec: 5 },
        { name: 'Low Timeout', target: 'https://example.org', protocol: 'HTTPS', timeout_ms: 100 },
        { name: 'Bad Retry', target: 'https://example.org', protocol: 'HTTPS', retry_threshold: 99 },
        { name: 'Missing TCP Port', target: 'example.org', protocol: 'TCP' },
        { name: 'Bad DNS Type', target: 'example.org', protocol: 'DNS', dns_record_type: 'MX' },
      ];

      for (const payload of invalidCases) {
        const res = await request(app)
          .post('/api/monitors')
          .set('Authorization', `Bearer ${adminToken}`)
          .send(payload);
        expect(res.status).toBe(400);
        expect(typeof res.body.detail).toBe('string');
      }
    });

    it('returns 404 across monitor detail/mutation/export endpoints for missing ID', async () => {
      const missingId = 'mon-does-not-exist';
      const checks = await Promise.all([
        request(app).get(`/api/monitors/${missingId}`).set('Authorization', `Bearer ${adminToken}`),
        request(app).put(`/api/monitors/${missingId}`).set('Authorization', `Bearer ${adminToken}`).send({ name: 'X' }),
        request(app).delete(`/api/monitors/${missingId}`).set('Authorization', `Bearer ${adminToken}`),
        request(app).post(`/api/monitors/${missingId}/toggle-pause`).set('Authorization', `Bearer ${adminToken}`),
        request(app).post(`/api/monitors/${missingId}/check-now`).set('Authorization', `Bearer ${adminToken}`),
        request(app).get(`/api/monitors/${missingId}/export.csv`).set('Authorization', `Bearer ${adminToken}`),
      ]);

      for (const res of checks) {
        expect(res.status).toBe(404);
      }
    });

    it('validates bulk monitor action payloads and executes bulk pause/resume/delete', async () => {
      const invalidBulk = await request(app)
        .post('/api/monitors/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [], action: 'invalid' });
      expect(invalidBulk.status).toBe(400);

      const m1 = await request(app)
        .post('/api/monitors')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Bulk Test 1', target: 'https://bulk1.example.org', protocol: 'HTTPS', run_initial_check: false });
      expect(m1.status).toBe(201);

      const pauseRes = await request(app)
        .post('/api/monitors/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [m1.body.id], action: 'pause' });
      expect(pauseRes.status).toBe(200);

      const pausedMon = await request(app)
        .get(`/api/monitors/${m1.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(pausedMon.body.monitor.status).toBe('PAUSED');

      const delRes = await request(app)
        .post('/api/monitors/bulk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ids: [m1.body.id], action: 'delete' });
      expect(delRes.status).toBe(200);
    });
  });

  describe('Incidents, Maintenance & Integrations Routers Error Handling', () => {
    it('validates incident creation, notes, and missing IDs', async () => {
      const badTitle = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Hi', severity: 'CRITICAL' });
      expect(badTitle.status).toBe(400);

      const badSev = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Valid Title', severity: 'EXTREME' });
      expect(badSev.status).toBe(400);

      const badMon = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Valid Title', severity: 'HIGH', monitor_id: 'mon-unknown' });
      expect(badMon.status).toBe(404);

      const missingInc = await request(app)
        .get('/api/incidents/inc-missing')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(missingInc.status).toBe(404);

      const created = await request(app)
        .post('/api/incidents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Note Validation Incident', severity: 'MEDIUM' });
      expect(created.status).toBe(201);

      const emptyNote = await request(app)
        .post(`/api/incidents/${created.body.id}/notes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ message: '   ' });
      expect(emptyNote.status).toBe(400);

      const validNote = await request(app)
        .post(`/api/incidents/${created.body.id}/notes`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ message: 'Checked upstream gateway logs.' });
      expect(validNote.status).toBe(201);
      expect(validNote.body.notes.length).toBeGreaterThanOrEqual(2);
    });

    it('validates maintenance windows and 404 error responses', async () => {
      const badRange = await request(app)
        .post('/api/maintenance')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          title: 'Invalid Window',
          start_time: new Date(Date.now() + 3600_000).toISOString(),
          end_time: new Date(Date.now() + 1000).toISOString(),
        });
      expect(badRange.status).toBe(400);

      const missingStart = await request(app)
        .post('/api/maintenance/mw-missing/start')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(missingStart.status).toBe(404);

      const missingDelete = await request(app)
        .delete('/api/maintenance/mw-missing')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(missingDelete.status).toBe(404);
    });

    it('validates integrations rules, dry-run simulation, and 404 responses', async () => {
      const missingChannel = await request(app)
        .put('/api/integrations/channels/ch-missing')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ enabled: true });
      expect(missingChannel.status).toBe(404);

      const dryRun = await request(app)
        .post('/api/integrations/channels/ch-slack/test')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ dry_run: true, title: 'Unit Test Dry Run', message: 'Testing simulated route' });
      expect(dryRun.status).toBe(200);
      expect(dryRun.body.result.status).toBe('SIMULATED');

      const badRule = await request(app)
        .post('/api/integrations/rules')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: '' });
      expect(badRule.status).toBe(400);

      const okRule = await request(app)
        .post('/api/integrations/rules')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Router Test Alert Rule', severity: 'HIGH', channels: ['SLACK'] });
      expect(okRule.status).toBe(201);
      expect(okRule.body.enabled).toBe(true);
    });
  });

  describe('Public Status, Settings, Users & Analytics Routers', () => {
    it('validates public status subscribe/unsubscribe error and success paths', async () => {
      const badEmail = await request(app)
        .post('/api/public/subscribe')
        .set('x-bypass-ratelimit', 'true')
        .send({ channel: 'email', destination: 'not-an-email' });
      expect(badEmail.status).toBe(400);

      const subOk = await request(app)
        .post('/api/public/subscribe')
        .set('x-bypass-ratelimit', 'true')
        .send({ channel: 'email', destination: 'unit.test.sub@example.org' });
      expect(subOk.status).toBe(201);
      const token = subOk.body.unsubscribe_token;
      expect(token).toBeTruthy();

      const dupSub = await request(app)
        .post('/api/public/subscribe')
        .set('x-bypass-ratelimit', 'true')
        .send({ channel: 'email', destination: 'unit.test.sub@example.org' });
      expect(dupSub.status).toBe(200);
      expect(dupSub.body.already_subscribed).toBe(true);

      const badUnsub = await request(app)
        .post('/api/public/unsubscribe')
        .set('x-bypass-ratelimit', 'true')
        .send({ token: 'unknown-token' });
      expect(badUnsub.status).toBe(404);

      const okUnsub = await request(app)
        .post('/api/public/unsubscribe')
        .set('x-bypass-ratelimit', 'true')
        .send({ token });
      expect(okUnsub.status).toBe(200);
    });

    it('validates settings categories, self-lock guards on users, and dashboard/analytics ranges', async () => {
      const badCategory = await request(app)
        .put('/api/settings/unknown_cat')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ foo: 'bar' });
      expect(badCategory.status).toBe(400);

      const okSettings = await request(app)
        .put('/api/settings/general')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ timezone: 'UTC' });
      expect(okSettings.status).toBe(200);

      // Admin cannot delete their own account
      const selfDelete = await request(app)
        .delete('/api/users/USR-001')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(selfDelete.status).toBe(400);

      // Dashboard & Analytics range support
      for (const range of ['24h', '7d', '30d', '90d']) {
        const dash = await request(app)
          .get(`/api/dashboard?range=${range}`)
          .set('Authorization', `Bearer ${viewerToken}`);
        expect(dash.status).toBe(200);
        expect(dash.body.range).toBe(range);

        const analytics = await request(app)
          .get(`/api/analytics?range=${range}`)
          .set('Authorization', `Bearer ${viewerToken}`);
        expect(analytics.status).toBe(200);
        expect(analytics.body.range).toBe(range);
      }
    });
  });
});
