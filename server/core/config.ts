import crypto from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const ephemeralSecret = crypto.randomBytes(32).toString('hex');

export const config = {
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isTest: process.env.NODE_ENV === 'test' || process.env.VITEST === 'true',
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  jwtSecret: process.env.JWT_SECRET && process.env.JWT_SECRET !== 'replace-with-strong-64-char-random-secret'
    ? process.env.JWT_SECRET
    : ephemeralSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  dbPath: process.env.DB_PATH || path.resolve(process.cwd(), 'data/vigilnode.db'),
  enableScheduler:
    process.env.NODE_ENV !== 'test' &&
    process.env.VITEST !== 'true' &&
    process.env.DISABLE_SCHEDULER !== 'true',
  allowPrivateTargets: process.env.ALLOW_PRIVATE_TARGETS === 'true',
  probeConcurrencyLimit: Math.max(1, Math.min(50, Number(process.env.PROBE_CONCURRENCY_LIMIT) || 10)),
};
