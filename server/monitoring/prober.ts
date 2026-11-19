import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import { performance } from 'node:perf_hooks';
import { assertResolvedHostnameSafe, extractHostnameFromTarget, validateTargetSyntaxAndSsrf } from '../core/security.ts';

export interface ProbeConfig {
  protocol: 'HTTP' | 'HTTPS' | 'TCP' | 'DNS' | 'SSL';
  target: string;
  http_method?: string;
  port?: number | null;
  dns_record_type?: string | null;
  expected_status?: string | null;
  expected_keyword?: string | null;
  expected_dns_answer?: string | null;
  headers?: Record<string, string>;
  timeout_ms?: number;
  ssl_warning_days?: number;
}

export interface ProbeResult {
  status: 'UP' | 'DEGRADED' | 'DOWN';
  response_time_ms: number;
  status_code: number | null;
  error_message: string;
  details: Record<string, unknown>;
  ssl?: {
    valid: boolean;
    expires_at: string | null;
    days_remaining: number | null;
    issuer: string | null;
    subject: string | null;
  };
}

function parseExpectedStatuses(expected?: string | null): Set<number> {
  if (!expected || !expected.trim()) {
    return new Set([200, 201, 202, 204, 301, 302]);
  }
  const set = new Set<number>();
  for (const part of expected.split(',')) {
    const trimmed = part.trim().toLowerCase();
    if (trimmed === '2xx') {
      for (let i = 200; i <= 299; i++) set.add(i);
    } else if (trimmed === '3xx') {
      for (let i = 300; i <= 399; i++) set.add(i);
    } else {
      const code = Number(trimmed);
      if (!Number.isNaN(code) && code >= 100 && code <= 599) set.add(code);
    }
  }
  return set.size > 0 ? set : new Set([200]);
}

function inspectTlsCertificate(host: string, port: number, timeoutMs: number): Promise<{
  valid: boolean;
  expires_at: string | null;
  days_remaining: number | null;
  issuer: string | null;
  subject: string | null;
  protocol: string | null;
  cipher: string | null;
  error?: string;
}> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = tls.connect(
      {
        host,
        port,
        servername: net.isIP(host) ? undefined : host,
        rejectUnauthorized: false,
      },
      () => {
        if (settled) return;
        settled = true;
        try {
          const cert = socket.getPeerCertificate(false);
          const authorized = socket.authorized;
          const authError = socket.authorizationError;
          const cipher = socket.getCipher();
          const tlsProto = socket.getProtocol();
          socket.end();

          if (!cert || !cert.valid_to) {
            resolve({
              valid: false,
              expires_at: null,
              days_remaining: null,
              issuer: null,
              subject: null,
              protocol: tlsProto,
              cipher: cipher?.name || null,
              error: 'No peer X.509 certificate presented',
            });
            return;
          }

          const expiresDate = new Date(cert.valid_to);
          const daysRemaining = Math.floor((expiresDate.getTime() - Date.now()) / 86400_000);
          const issuerObj = cert.issuer as unknown as Record<string, string> | undefined;
          const subjectObj = cert.subject as unknown as Record<string, string> | undefined;
          const issuer = issuerObj?.O || issuerObj?.CN || 'Unknown CA';
          const subject = subjectObj?.CN || host;

          resolve({
            valid: authorized && daysRemaining >= 0,
            expires_at: expiresDate.toISOString(),
            days_remaining: daysRemaining,
            issuer,
            subject,
            protocol: tlsProto,
            cipher: cipher?.name || null,
            error: !authorized ? String(authError || 'Certificate chain validation failed') : daysRemaining < 0 ? 'Certificate expired' : undefined,
          });
        } catch (err) {
          socket.destroy();
          resolve({
            valid: false,
            expires_at: null,
            days_remaining: null,
            issuer: null,
            subject: null,
            protocol: null,
            cipher: null,
            error: err instanceof Error ? err.message : 'TLS inspection error',
          });
        }
      },
    );

    socket.setTimeout(timeoutMs, () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        valid: false,
        expires_at: null,
        days_remaining: null,
        issuer: null,
        subject: null,
        protocol: null,
        cipher: null,
        error: `TLS handshake timed out after ${timeoutMs}ms`,
      });
    });

    socket.on('error', (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        valid: false,
        expires_at: null,
        days_remaining: null,
        issuer: null,
        subject: null,
        protocol: null,
        cipher: null,
        error: err.message,
      });
    });
  });
}

export async function executeProbe(cfg: ProbeConfig): Promise<ProbeResult> {
  const timeoutMs = Math.max(500, Math.min(60000, cfg.timeout_ms || 5000));
  const warningDays = cfg.ssl_warning_days || 14;
  const start = performance.now();

  try {
    validateTargetSyntaxAndSsrf(cfg.protocol, cfg.target);
    const { hostname, port: parsedPort } = extractHostnameFromTarget(cfg.protocol, cfg.target);
    await assertResolvedHostnameSafe(hostname);

    if (cfg.protocol === 'HTTP' || cfg.protocol === 'HTTPS') {
      const targetUrl = /^https?:\/\//i.test(cfg.target.trim())
        ? cfg.target.trim()
        : `${cfg.protocol.toLowerCase()}://${cfg.target.trim()}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const method = (cfg.http_method || 'GET').toUpperCase();
        const response = await fetch(targetUrl, {
          method,
          headers: {
            'User-Agent': 'VigilNode-Prober/1.0',
            ...(cfg.headers || {}),
          },
          signal: controller.signal,
          redirect: 'follow',
        });
        const elapsed = Math.round((performance.now() - start) * 10) / 10;
        const expectedCodes = parseExpectedStatuses(cfg.expected_status);
        const statusOk = expectedCodes.has(response.status);

        let bodyText = '';
        if (method !== 'HEAD') {
          bodyText = await response.text().catch(() => '');
        }
        const keyword = (cfg.expected_keyword || '').trim();
        const keywordOk = !keyword || bodyText.includes(keyword);

        let sslInfo: ProbeResult['ssl'] | undefined;
        if (targetUrl.startsWith('https://')) {
          const tlsInfo = await inspectTlsCertificate(hostname, parsedPort || 443, Math.min(timeoutMs, 3000));
          sslInfo = {
            valid: tlsInfo.valid,
            expires_at: tlsInfo.expires_at,
            days_remaining: tlsInfo.days_remaining,
            issuer: tlsInfo.issuer,
            subject: tlsInfo.subject,
          };
        }

        if (!statusOk) {
          return {
            status: 'DOWN',
            response_time_ms: elapsed,
            status_code: response.status,
            error_message: `Unexpected HTTP status ${response.status} (expected ${cfg.expected_status || '200'})`,
            details: { url: targetUrl, method, status_code: response.status },
            ssl: sslInfo,
          };
        }
        if (!keywordOk) {
          return {
            status: 'DOWN',
            response_time_ms: elapsed,
            status_code: response.status,
            error_message: `Response body assertion failed: keyword "${keyword}" not found`,
            details: { url: targetUrl, method, status_code: response.status, keyword_matched: false },
            ssl: sslInfo,
          };
        }
        if (sslInfo && sslInfo.days_remaining !== null && sslInfo.days_remaining <= warningDays) {
          return {
            status: 'DEGRADED',
            response_time_ms: elapsed,
            status_code: response.status,
            error_message: `SSL certificate expires in ${sslInfo.days_remaining} days`,
            details: { url: targetUrl, method, status_code: response.status, ssl_warning: true },
            ssl: sslInfo,
          };
        }

        return {
          status: 'UP',
          response_time_ms: elapsed,
          status_code: response.status,
          error_message: '',
          details: { url: targetUrl, method, status_code: response.status, keyword_matched: true },
          ssl: sslInfo,
        };
      } finally {
        clearTimeout(timer);
      }
    }

    if (cfg.protocol === 'TCP') {
      const port = cfg.port || parsedPort || 80;
      const tcpResult = await new Promise<{ ok: boolean; err?: string; elapsed: number }>((resolve) => {
        let done = false;
        const socket = new net.Socket();
        socket.setTimeout(timeoutMs);

        socket.connect(port, hostname, () => {
          if (done) return;
          done = true;
          const elapsed = Math.round((performance.now() - start) * 10) / 10;
          socket.destroy();
          resolve({ ok: true, elapsed });
        });

        socket.on('timeout', () => {
          if (done) return;
          done = true;
          const elapsed = Math.round((performance.now() - start) * 10) / 10;
          socket.destroy();
          resolve({ ok: false, err: `TCP handshake timeout on ${hostname}:${port} after ${timeoutMs}ms`, elapsed });
        });

        socket.on('error', (err) => {
          if (done) return;
          done = true;
          const elapsed = Math.round((performance.now() - start) * 10) / 10;
          socket.destroy();
          resolve({ ok: false, err: `TCP connection error (${hostname}:${port}): ${err.message}`, elapsed });
        });
      });

      return {
        status: tcpResult.ok ? 'UP' : 'DOWN',
        response_time_ms: tcpResult.elapsed,
        status_code: null,
        error_message: tcpResult.err || '',
        details: { hostname, port, handshake: tcpResult.ok ? 'SYN-ACK' : 'FAILED' },
      };
    }

    if (cfg.protocol === 'DNS') {
      const recordType = (cfg.dns_record_type || 'A').toUpperCase();
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`DNS lookup timed out after ${timeoutMs}ms`)), timeoutMs),
      );
      let answers: string[] = [];
      if (recordType === 'AAAA') {
        answers = (await Promise.race([dns.resolve6(hostname), timeoutPromise])) as string[];
      } else if (recordType === 'CNAME') {
        answers = (await Promise.race([dns.resolveCname(hostname), timeoutPromise])) as string[];
      } else {
        answers = (await Promise.race([dns.resolve4(hostname), timeoutPromise])) as string[];
      }
      const elapsed = Math.round((performance.now() - start) * 10) / 10;

      if (!answers || answers.length === 0) {
        return {
          status: 'DOWN',
          response_time_ms: elapsed,
          status_code: null,
          error_message: `DNS ${recordType} lookup returned no records for ${hostname}`,
          details: { hostname, recordType, answers: [] },
        };
      }

      const expectedAnswer = (cfg.expected_dns_answer || '').trim();
      if (expectedAnswer && !answers.some((a) => a.toLowerCase().includes(expectedAnswer.toLowerCase()))) {
        return {
          status: 'DOWN',
          response_time_ms: elapsed,
          status_code: null,
          error_message: `DNS ${recordType} mismatch: resolved [${answers.join(', ')}], expected "${expectedAnswer}"`,
          details: { hostname, recordType, answers, expectedAnswer },
        };
      }

      return {
        status: 'UP',
        response_time_ms: elapsed,
        status_code: null,
        error_message: '',
        details: { hostname, recordType, answers },
      };
    }

    if (cfg.protocol === 'SSL') {
      const port = cfg.port || parsedPort || 443;
      const tlsInfo = await inspectTlsCertificate(hostname, port, timeoutMs);
      const elapsed = Math.round((performance.now() - start) * 10) / 10;

      if (tlsInfo.error && !tlsInfo.expires_at) {
        return {
          status: 'DOWN',
          response_time_ms: elapsed,
          status_code: null,
          error_message: tlsInfo.error,
          details: { hostname, port, protocol: tlsInfo.protocol },
          ssl: {
            valid: false,
            expires_at: null,
            days_remaining: null,
            issuer: null,
            subject: null,
          },
        };
      }

      const days = tlsInfo.days_remaining ?? -1;
      if (days < 0 || !tlsInfo.valid) {
        return {
          status: 'DOWN',
          response_time_ms: elapsed,
          status_code: null,
          error_message: tlsInfo.error || `SSL certificate invalid or expired (${days} days remaining)`,
          details: { hostname, port, protocol: tlsInfo.protocol, cipher: tlsInfo.cipher },
          ssl: {
            valid: false,
            expires_at: tlsInfo.expires_at,
            days_remaining: days,
            issuer: tlsInfo.issuer,
            subject: tlsInfo.subject,
          },
        };
      }

      if (days <= warningDays) {
        return {
          status: 'DEGRADED',
          response_time_ms: elapsed,
          status_code: null,
          error_message: `SSL certificate expiring soon (${days} days left <= ${warningDays}d threshold)`,
          details: { hostname, port, protocol: tlsInfo.protocol, cipher: tlsInfo.cipher },
          ssl: {
            valid: true,
            expires_at: tlsInfo.expires_at,
            days_remaining: days,
            issuer: tlsInfo.issuer,
            subject: tlsInfo.subject,
          },
        };
      }

      return {
        status: 'UP',
        response_time_ms: elapsed,
        status_code: null,
        error_message: '',
        details: { hostname, port, protocol: tlsInfo.protocol, cipher: tlsInfo.cipher, days_remaining: days },
        ssl: {
          valid: true,
          expires_at: tlsInfo.expires_at,
          days_remaining: days,
          issuer: tlsInfo.issuer,
          subject: tlsInfo.subject,
        },
      };
    }

    throw new Error(`Unsupported protocol: ${cfg.protocol}`);
  } catch (err) {
    const elapsed = Math.round((performance.now() - start) * 10) / 10;
    const message = err instanceof Error
      ? err.name === 'AbortError'
        ? `Request timed out after ${timeoutMs}ms`
        : err.message
      : 'Probe execution error';
    return {
      status: 'DOWN',
      response_time_ms: elapsed,
      status_code: null,
      error_message: message,
      details: { error: message },
    };
  }
}
