import dns from 'node:dns/promises';
import net from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.ts';

export type UserRole = 'ADMIN' | 'READ_ONLY_MAINTAINER';

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function signJwt(user: AuthUser): string {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'] },
  );
}

export function verifyJwt(token: string): AuthUser | null {
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    if (!decoded || typeof decoded.sub !== 'string' || !decoded.role) {
      return null;
    }
    const role: UserRole = decoded.role === 'ADMIN' ? 'ADMIN' : 'READ_ONLY_MAINTAINER';
    return {
      id: decoded.sub,
      email: String(decoded.email || ''),
      full_name: String(decoded.full_name || ''),
      role,
    };
  } catch {
    return null;
  }
}

export function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    res.status(401).json({ detail: 'Authentication required. Please sign in.' });
    return;
  }
  const user = verifyJwt(token);
  if (!user) {
    res.status(401).json({ detail: 'Invalid or expired authentication token.' });
    return;
  }
  req.user = user;
  next();
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ detail: 'Authentication required.' });
    return;
  }
  if (req.user.role !== 'ADMIN') {
    res.status(403).json({
      detail: 'Forbidden: Administrator role is required to perform this action.',
    });
    return;
  }
  next();
}

// In-memory rate limiter for auth and public endpoints
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function createRateLimiter(windowMs: number, maxRequests: number, keyPrefix: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (config.isTest && req.headers['x-bypass-ratelimit'] === 'true') {
      next();
      return;
    }
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const existing = rateBuckets.get(key);
    if (!existing || existing.resetAt <= now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (existing.count >= maxRequests) {
      const retryAfterSec = Math.ceil((existing.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        detail: `Rate limit exceeded. Try again in ${retryAfterSec}s.`,
      });
      return;
    }
    existing.count += 1;
    next();
  };
}

// SSRF Protection Helpers
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata',
  '169.254.169.254',
]);

export function isPrivateOrReservedIp(ip: string): boolean {
  const cleaned = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!cleaned) return true;

  // Handle IPv4-mapped IPv6 like ::ffff:127.0.0.1
  if (cleaned.startsWith('::ffff:')) {
    const v4 = cleaned.slice(7);
    if (net.isIPv4(v4)) return isPrivateOrReservedIp(v4);
  }

  if (net.isIPv4(cleaned)) {
    const parts = cleaned.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // Multicast & reserved
    return false;
  }

  if (net.isIPv6(cleaned)) {
    if (cleaned === '::' || cleaned === '::1') return true;
    if (cleaned.startsWith('fc') || cleaned.startsWith('fd')) return true; // ULA fc00::/7
    if (cleaned.startsWith('fe8') || cleaned.startsWith('fe9') || cleaned.startsWith('fea') || cleaned.startsWith('feb')) {
      return true; // Link-local fe80::/10
    }
    return false;
  }

  return false;
}

export function extractHostnameFromTarget(protocol: string, rawTarget: string): { hostname: string; port?: number } {
  const target = rawTarget.trim();
  if (protocol === 'HTTP' || protocol === 'HTTPS') {
    const urlStr = /^https?:\/\//i.test(target) ? target : `${protocol.toLowerCase()}://${target}`;
    const parsed = new URL(urlStr);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Only http:// and https:// URL schemes are permitted.');
    }
    return {
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80,
    };
  }

  // TCP, SSL, DNS: target may be host or host:port
  let cleaned = target.replace(/^(tcp|ssl|dns):\/\//i, '');
  if (cleaned.includes('/')) {
    cleaned = cleaned.split('/')[0];
  }
  if (cleaned.startsWith('[') && cleaned.includes(']')) {
    const end = cleaned.indexOf(']');
    const host = cleaned.slice(1, end);
    const rest = cleaned.slice(end + 1);
    const port = rest.startsWith(':') ? Number(rest.slice(1)) : undefined;
    return { hostname: host, port };
  }
  const colonIdx = cleaned.lastIndexOf(':');
  if (colonIdx > 0 && !cleaned.slice(0, colonIdx).includes(':')) {
    const portCandidate = Number(cleaned.slice(colonIdx + 1));
    if (!Number.isNaN(portCandidate) && portCandidate > 0 && portCandidate <= 65535) {
      return { hostname: cleaned.slice(0, colonIdx), port: portCandidate };
    }
  }
  return { hostname: cleaned };
}

export function validateTargetSyntaxAndSsrf(protocol: string, rawTarget: string): { hostname: string; port?: number } {
  if (!rawTarget || !rawTarget.trim()) {
    throw new Error('Target URL, hostname, or IP address is required.');
  }
  const { hostname, port } = extractHostnameFromTarget(protocol, rawTarget);
  const lower = hostname.trim().toLowerCase();
  if (!lower) {
    throw new Error('Invalid target hostname.');
  }

  if (!config.allowPrivateTargets) {
    if (BLOCKED_HOSTNAMES.has(lower) || lower.endsWith('.local') || lower.endsWith('.internal')) {
      throw new Error(`SSRF protection: Target host "${hostname}" resolves to a restricted local/internal address.`);
    }
    if (net.isIP(lower) && isPrivateOrReservedIp(lower)) {
      throw new Error(`SSRF protection: IP address "${hostname}" is within a private, loopback, or metadata range.`);
    }
  }

  return { hostname, port };
}

export async function assertResolvedHostnameSafe(hostname: string): Promise<void> {
  if (config.allowPrivateTargets) return;
  const lower = hostname.trim().toLowerCase();
  if (BLOCKED_HOSTNAMES.has(lower) || lower.endsWith('.local') || lower.endsWith('.internal')) {
    throw new Error(`SSRF protection blocked internal hostname: ${hostname}`);
  }
  if (net.isIP(lower)) {
    if (isPrivateOrReservedIp(lower)) {
      throw new Error(`SSRF protection blocked private/reserved IP: ${lower}`);
    }
    return;
  }
  try {
    const records = await dns.lookup(hostname, { all: true });
    for (const rec of records) {
      if (isPrivateOrReservedIp(rec.address)) {
        throw new Error(`SSRF protection blocked resolved private IP (${rec.address}) for ${hostname}`);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('SSRF protection')) {
      throw err;
    }
    // DNS failures are handled by the prober itself as target resolution failures
  }
}

export function maskSecret(value: unknown): string {
  const str = typeof value === 'string' ? value.trim() : '';
  if (!str) return '';
  if (str.includes('••••')) return str;
  if (str.length <= 6) return '••••••••';
  return `••••••••${str.slice(-4)}`;
}

export function maskChannelConfig(channelType: string, rawConfig: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...rawConfig };
  if (channelType === 'EMAIL_SMTP' && copy.smtp_password) {
    copy.smtp_password = maskSecret(copy.smtp_password);
    copy.has_secret = true;
  }
  if (channelType === 'TELEGRAM' && copy.bot_token) {
    copy.bot_token = maskSecret(copy.bot_token);
    copy.has_secret = true;
  }
  if ((channelType === 'DISCORD' || channelType === 'SLACK') && copy.webhook_url) {
    const url = String(copy.webhook_url);
    try {
      const parsed = new URL(url);
      copy.webhook_url = `${parsed.origin}/••••${url.slice(-6)}`;
    } catch {
      copy.webhook_url = maskSecret(url);
    }
    copy.has_secret = true;
  }
  return copy;
}

export function mergeMaskedConfig(
  channelType: string,
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...existing, ...incoming };
  delete next.has_secret;
  const secretKeys =
    channelType === 'EMAIL_SMTP'
      ? ['smtp_password']
      : channelType === 'TELEGRAM'
        ? ['bot_token']
        : ['webhook_url'];

  for (const key of secretKeys) {
    const val = incoming[key];
    if (typeof val !== 'string' || val.trim() === '' || val.includes('••••')) {
      next[key] = existing[key] || '';
    }
  }
  return next;
}
