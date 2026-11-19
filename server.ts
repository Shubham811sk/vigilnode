import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createApp } from './server/app.ts';
import { config } from './server/core/config.ts';
import { closeDb } from './server/db/database.ts';
import { startScheduler, stopScheduler } from './server/monitoring/scheduler.ts';
import { telemetryWs } from './server/ws.ts';

async function bootstrap() {
  const { app, db } = createApp();
  const server = http.createServer(app);

  // Attach WebSocket live telemetry hub on /ws/telemetry
  telemetryWs.attach(server);

  if (config.nodeEnv !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Production build not found. Run npm run build first.');
      }
    });
  }

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`[VigilNode] Server listening on http://0.0.0.0:${config.port} (${config.nodeEnv})`);
    startScheduler(db);
  });

  const shutdown = () => {
    stopScheduler();
    telemetryWs.close();
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void bootstrap();
