import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { getWebSocketUrl } from '../lib/api';
import { useAuth } from './AuthContext';

export interface LiveTelemetryMessage {
  event: string;
  timestamp: string;
  [key: string]: unknown;
}

type Listener = (msg: LiveTelemetryMessage) => void;

interface TelemetryContextValue {
  connected: boolean;
  lastEvent: LiveTelemetryMessage | null;
  recentEvents: LiveTelemetryMessage[];
  subscribe: (fn: Listener) => () => void;
}

const TelemetryContext = createContext<TelemetryContextValue | null>(null);

export function TelemetryProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<LiveTelemetryMessage | null>(null);
  const [recentEvents, setRecentEvents] = useState<LiveTelemetryMessage[]>([]);
  const listenersRef = useRef<Set<Listener>>(new Set());

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let closedByCleanup = false;

    const connect = () => {
      try {
        ws = new WebSocket(getWebSocketUrl());
        ws.onopen = () => setConnected(true);
        ws.onmessage = (evt) => {
          try {
            const parsed = JSON.parse(String(evt.data)) as LiveTelemetryMessage;
            setLastEvent(parsed);
            if (parsed.event !== 'CONNECTED') {
              setRecentEvents((prev) => [parsed, ...prev].slice(0, 20));
            }
            listenersRef.current.forEach((fn) => fn(parsed));
          } catch {
            // ignore malformed ws frame
          }
        };
        ws.onclose = () => {
          setConnected(false);
          if (!closedByCleanup) {
            reconnectTimer = window.setTimeout(connect, 4000);
          }
        };
        ws.onerror = () => {
          setConnected(false);
        };
      } catch {
        setConnected(false);
      }
    };

    connect();
    return () => {
      closedByCleanup = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, [user?.id]);

  const subscribe = (fn: Listener) => {
    listenersRef.current.add(fn);
    return () => {
      listenersRef.current.delete(fn);
    };
  };

  return (
    <TelemetryContext.Provider value={{ connected, lastEvent, recentEvents, subscribe }}>
      {children}
    </TelemetryContext.Provider>
  );
}

export function useTelemetry(onEvent?: Listener): TelemetryContextValue {
  const ctx = useContext(TelemetryContext);
  if (!ctx) throw new Error('useTelemetry must be used inside TelemetryProvider');

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!onEventRef.current) return;
    return ctx.subscribe((msg) => onEventRef.current?.(msg));
  }, [ctx]);

  return ctx;
}
