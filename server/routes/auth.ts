import { Router } from 'express';
import type Database from 'better-sqlite3';
import {
  type AuthenticatedRequest,
  createRateLimiter,
  hashPassword,
  requireAuth,
  signJwt,
  verifyPassword,
} from '../core/security.ts';
import { writeAuditLog } from '../db/database.ts';

export function createAuthRouter(db: Database.Database): Router {
  const router = Router();
  const loginLimiter = createRateLimiter(60_000, 20, 'auth-login');

  router.post('/login', loginLimiter, (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      res.status(400).json({ detail: 'Email and password are required.' });
      return;
    }

    const user = db
      .prepare('SELECT * FROM users WHERE lower(email) = ?')
      .get(email) as {
      id: string;
      full_name: string;
      email: string;
      password_hash: string;
      role: 'ADMIN' | 'READ_ONLY_MAINTAINER';
      title: string;
      is_active: number;
    } | undefined;

    if (!user || !verifyPassword(password, user.password_hash)) {
      writeAuditLog(db, {
        user_email: email,
        user_role: 'UNKNOWN',
        action: 'AUTH_LOGIN_FAILED',
        resource_type: 'auth',
        ip_address: req.ip || '127.0.0.1',
      });
      res.status(401).json({ detail: 'Invalid email or password.' });
      return;
    }

    if (!user.is_active) {
      res.status(403).json({ detail: 'Account is deactivated. Contact an administrator.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?').run(now, now, user.id);

    const token = signJwt({
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
    });

    writeAuditLog(db, {
      user_id: user.id,
      user_email: user.email,
      user_role: user.role,
      action: 'AUTH_LOGIN_SUCCESS',
      resource_type: 'auth',
      resource_id: user.id,
      ip_address: req.ip || '127.0.0.1',
    });

    res.json({
      access_token: token,
      token_type: 'bearer',
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        title: user.title,
        is_active: Boolean(user.is_active),
        last_login_at: now,
      },
    });
  });

  router.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = db
      .prepare('SELECT id, full_name, email, role, title, is_active, last_login_at, created_at FROM users WHERE id = ?')
      .get(req.user!.id) as Record<string, unknown> | undefined;

    if (!user) {
      res.status(404).json({ detail: 'Authenticated user account not found.' });
      return;
    }
    res.json({
      ...user,
      is_active: Boolean(user.is_active),
    });
  });

  router.post('/change-password', requireAuth, (req: AuthenticatedRequest, res) => {
    const currentPassword = String(req.body?.current_password || '');
    const newPassword = String(req.body?.new_password || '');

    if (!currentPassword || newPassword.length < 8) {
      res.status(400).json({ detail: 'Current password is required and new password must be at least 8 characters.' });
      return;
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as {
      id: string;
      email: string;
      role: string;
      password_hash: string;
    } | undefined;

    if (!user || !verifyPassword(currentPassword, user.password_hash)) {
      res.status(400).json({ detail: 'Current password is incorrect.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      hashPassword(newPassword),
      now,
      user.id,
    );

    writeAuditLog(db, {
      user_id: user.id,
      user_email: user.email,
      user_role: user.role,
      action: 'USER_PASSWORD_CHANGED',
      resource_type: 'user',
      resource_id: user.id,
      ip_address: req.ip || '127.0.0.1',
    });

    res.json({ message: 'Password updated successfully.' });
  });

  return router;
}
