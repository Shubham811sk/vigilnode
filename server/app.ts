import express from 'express';
import type Database from 'better-sqlite3';
import { getDb } from './db/database.ts';
import { seedDatabaseIfEmpty } from './db/seed.ts';
import { createAuthRouter } from './routes/auth.ts';
import { createMonitorsRouter } from './routes/monitors.ts';
import { createIncidentsRouter } from './routes/incidents.ts';
import { createMaintenanceRouter } from './routes/maintenance.ts';
import { createIntegrationsRouter } from './routes/integrations.ts';
import { createAnalyticsDashboardRouter } from './routes/analytics_dashboard.ts';
import { createPublicStatusRouter } from './routes/public_status.ts';
import { createAdminSystemRouter } from './routes/admin_system.ts';
import { buildProjectSourceZipBuffer } from './core/zipExport.ts';

export function createApp(customDb?: Database.Database): { app: express.Express; db: Database.Database } {
  const db = customDb || getDb();
  seedDatabaseIfEmpty(db);

  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '1mb' }));

  // Basic security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.get('/api/health', (req, res) => {
    const row = db.prepare('SELECT 1 as ok').get() as { ok: number } | undefined;
    res.json({
      status: row?.ok === 1 ? 'healthy' : 'degraded',
      service: 'VigilNode API',
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/monitors', createMonitorsRouter(db));
  app.use('/api/incidents', createIncidentsRouter(db));
  app.use('/api/maintenance', createMaintenanceRouter(db));
  app.use('/api/integrations', createIntegrationsRouter(db));
  app.use('/api', createAnalyticsDashboardRouter(db));
  app.use('/api/public', createPublicStatusRouter(db));
  app.use('/api', createAdminSystemRouter(db));

  app.get('/api/export/source.zip', (req, res) => {
    const { buffer } = buildProjectSourceZipBuffer();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="vigilnode-full-source.zip"');
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  });

  // Structured API 404 & error handling
  app.use('/api/*', (req, res) => {
    res.status(404).json({ detail: `API endpoint not found: ${req.method} ${req.originalUrl}` });
  });

  app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    void next;
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ detail: message });
  });

  return { app, db };
}
