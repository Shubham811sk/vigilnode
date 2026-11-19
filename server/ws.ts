import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { verifyJwt } from './core/security.ts';

export interface TelemetryEvent {
  event:
    | 'CONNECTED'
    | 'PROBE_RESULT'
    | 'INCIDENT_CREATED'
    | 'INCIDENT_UPDATED'
    | 'MAINTENANCE_UPDATED'
    | 'NOTIFICATION_DISPATCHED'
    | 'MONITOR_UPDATED';
  timestamp: string;
  [key: string]: unknown;
}

class TelemetryWebSocketHub {
  private wss: WebSocketServer | null = null;
  private clients = new Set<{ ws: WebSocket; isPublicOnly: boolean }>();

  attach(server: HttpServer): void {
    if (this.wss) return;
    this.wss = new WebSocketServer({ server, path: '/ws/telemetry' });

    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url || '/ws/telemetry', 'http://localhost');
      const token = url.searchParams.get('token') || '';
      const user = token ? verifyJwt(token) : null;
      const clientRecord = { ws, isPublicOnly: !user };
      this.clients.add(clientRecord);

      ws.send(
        JSON.stringify({
          event: 'CONNECTED',
          timestamp: new Date().toISOString(),
          authenticated: Boolean(user),
          role: user?.role || 'PUBLIC',
        }),
      );

      ws.on('close', () => {
        this.clients.delete(clientRecord);
      });

      ws.on('error', () => {
        this.clients.delete(clientRecord);
      });
    });
  }

  broadcast(payload: Omit<TelemetryEvent, 'timestamp'>, options: { publicSafe?: boolean } = {}): void {
    const msg = JSON.stringify({
      ...payload,
      timestamp: new Date().toISOString(),
    });
    for (const client of this.clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;
      if (client.isPublicOnly && !options.publicSafe) continue;
      client.ws.send(msg);
    }
  }

  close(): void {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    this.clients.clear();
  }
}

export const telemetryWs = new TelemetryWebSocketHub();
