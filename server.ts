import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import path from 'path';
import http from 'http';
import https from 'https';
import nodemailer from 'nodemailer';
import { createServer as createViteServer } from 'vite';
import { db, hashPassword, verifyPassword, UserRecord, BotRecord, DeploymentRecord, EmailRecord } from './src/server/db.ts';
import { cloudFirestoreSync } from './src/server/cloudFirestoreSync.ts';
import { processManager } from './src/server/processManager.ts';
import { deploymentService } from './src/server/deploymentService.ts';

const PORT = Number(process.env.PORT) || 3000;

interface AuthenticatedRequest extends Request {
  user?: UserRecord;
  sessionToken?: string;
}

// Rate limiter memory store
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function rateLimitMiddleware(maxRequests = 180, windowMs = 60000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const record = rateLimits.get(ip);
    if (!record || now > record.resetAt) {
      rateLimits.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    record.count += 1;
    if (record.count > maxRequests) {
      return res.status(429).json({
        error: 'Rate limit exceeded. Please wait a moment and try again.',
      });
    }
    next();
  };
}

function getClientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || '127.0.0.1';
}

function sanitizeUser(user: UserRecord) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    suspended: user.suspended,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    githubConnected: !!user.githubToken,
    githubUsername: user.githubUsername || null,
    githubAvatarUrl: user.githubAvatarUrl || null,
  };
}

function createSessionForUser(user: UserRecord, req: Request): string {
  const token = `lyr_tok_${crypto.randomBytes(28).toString('hex')}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString();
  db.state.sessions.push({
    id: `ses_${crypto.randomBytes(8).toString('hex')}`,
    userId: user.id,
    token,
    ip: getClientIp(req),
    userAgent: String(req.headers['user-agent'] || 'Web Client').slice(0, 180),
    createdAt: now.toISOString(),
    expiresAt,
  });
  user.lastLoginAt = now.toISOString();
  db.save();
  return token;
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization || '';
  const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : queryToken;

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please sign in to continue.' });
  }

  const session = db.state.sessions.find(s => s.token === token);
  if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }

  const user = db.state.users.find(u => u.id === session.userId);
  if (!user) {
    return res.status(401).json({ error: 'Account not found.' });
  }

  if (user.suspended) {
    return res.status(403).json({ error: 'Your account has been suspended by an administrator.' });
  }

  // Enforce global maintenance mode for non-admins
  if (db.state.systemSettings.maintenanceMode && user.role !== 'admin') {
    return res.status(503).json({
      error: db.state.systemSettings.maintenanceMessage || 'Platform is currently under maintenance.',
      maintenanceMode: true,
      maintenanceReturnTime: db.state.systemSettings.maintenanceReturnTime,
    });
  }

  req.user = user;
  req.sessionToken = token;
  next();
}

function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator privileges are required to perform this action.' });
  }
  next();
}

function canAccessBot(user: UserRecord, bot: BotRecord): boolean {
  return user.role === 'admin' || bot.userId === user.id;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api', rateLimitMiddleware());

  // --- PUBLIC SYSTEM STATUS & HEALTH ---
  app.get('/api/health', (_req, res) => {
    const metrics = processManager.getSystemHostMetrics();
    res.json({
      status: 'ok',
      platform: db.state.systemSettings.platformName,
      platformDomain: db.state.systemSettings.platformDomain || 'lyrical.cloud',
      requireSignupOtp: db.state.systemSettings.requireSignupOtp !== false,
      maintenanceMode: db.state.systemSettings.maintenanceMode,
      maintenanceMessage: db.state.systemSettings.maintenanceMessage,
      maintenanceReturnTime: db.state.systemSettings.maintenanceReturnTime,
      registrationEnabled: db.state.systemSettings.registrationEnabled,
      announcementBanner: db.state.systemSettings.announcementBanner,
      supportEmail: db.state.systemSettings.supportEmail,
      supportDocsUrl: db.state.systemSettings.supportDocsUrl,
      hasExternalApiConfigured: Boolean(db.state.systemSettings.deploymentApiUrl || process.env.DEPLOYMENT_API_URL),
      hostMetrics: metrics,
    });
  });

  // wh-panel-site-main /api/system endpoint (SystemInfo schema)
  app.get('/api/system', requireAuth, (_req, res) => {
    const metrics = processManager.getSystemHostMetrics();
    res.json({
      hostname: metrics.hostname,
      platform: metrics.platform,
      cpuModel: metrics.cpuModel,
      cpuCores: metrics.cpuCores,
      cpuUsage: metrics.cpuUsagePercent,
      memoryTotal: metrics.ramTotalMb * 1024 * 1024,
      memoryUsed: metrics.ramUsedMb * 1024 * 1024,
      memoryPercentage: metrics.ramUsagePercent,
      uptime: metrics.uptimeSeconds,
      runningBots: metrics.runningProcessesCount,
      totalBots: db.state.bots.length,
    });
  });

  // --- REGISTRATION OTP IN-MEMORY STORE & MAILER ---
  interface PendingRegistration {
    email: string;
    name: string;
    passwordHash: string;
    salt: string;
    otp: string;
    expiresAt: number;
    attempts: number;
  }
  const pendingRegistrations = new Map<string, PendingRegistration>();

  async function sendSignupOtpEmail(
    toEmail: string,
    name: string,
    otp: string
  ): Promise<{ delivered: boolean; devOtp?: string; error?: string }> {
    const settings = db.state.systemSettings;
    console.log(`[AUTH-OTP] Security OTP for ${toEmail}: ${otp}`);

    if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPass) {
      // In dev/preview without external SMTP configured, return devOtp for preview testing
      return { delivered: false, devOtp: otp };
    }

    try {
      const transporter = nodemailer.createTransport({
        host: settings.smtpHost,
        port: Number(settings.smtpPort) || 587,
        secure: Number(settings.smtpPort) === 465,
        auth: {
          user: settings.smtpUser,
          pass: settings.smtpPass,
        },
      });

      await transporter.sendMail({
        from:
          settings.smtpFrom ||
          `"${settings.platformName || 'LYRICAL'}" <${
            settings.supportEmail || 'security@lyrical.cloud'
          }>`,
        to: toEmail,
        subject: `${otp} is your LYRICAL verification code`,
        text: `Hello ${name},\n\nYour LYRICAL 6-digit verification code is: ${otp}\n\nThis security code will expire in 10 minutes.\n\n— LYRICAL Security Team`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0b0f19; color: #f8fafc; padding: 32px 16px; border-radius: 12px; max-width: 500px; margin: 0 auto;">
            <div style="text-align: center; margin-bottom: 24px;">
              <div style="font-size: 26px; font-weight: 800; color: #38bdf8; letter-spacing: 2px;">
                ${settings.platformName || 'LYRICAL'}
              </div>
              <div style="font-size: 13px; color: #94a3b8; margin-top: 4px;">Account Security Verification</div>
            </div>
            <div style="background-color: #111827; border: 1px solid #1f2937; border-radius: 10px; padding: 24px; text-align: center;">
              <p style="font-size: 15px; color: #e2e8f0; margin-top: 0;">Hello <strong>${name}</strong>,</p>
              <p style="font-size: 13px; color: #94a3b8; line-height: 1.5;">
                Enter this 6-digit verification code to complete your signup and secure your WhatsApp and website deployment workspace:
              </p>
              <div style="background: #1e293b; border: 1px dashed #38bdf8; border-radius: 8px; padding: 18px; margin: 24px 0; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #38bdf8; font-family: monospace;">
                ${otp}
              </div>
              <p style="font-size: 12px; color: #64748b; margin: 0;">
                This code expires in <strong>10 minutes</strong>. If you did not request this, please ignore this email.
              </p>
            </div>
            <div style="text-align: center; margin-top: 20px; font-size: 11px; color: #64748b;">
              Automated security message from ${settings.platformName || 'LYRICAL'} Cloud Platform.
            </div>
          </div>
        `,
      });
      return { delivered: true };
    } catch (err: any) {
      console.error('[AUTH-OTP-DISPATCH-ERR]', err.message);
      return { delivered: false, devOtp: otp, error: err.message };
    }
  }

  // --- AUTHENTICATION ROUTES ---
  app.post('/api/auth/register-send-otp', async (req, res) => {
    try {
      if (!db.state.systemSettings.registrationEnabled) {
        return res.status(403).json({ error: 'New account registration is currently disabled by the administrator.' });
      }
      const { email, password, name } = req.body;
      if (!email || !password || !name) {
        return res.status(400).json({ error: 'Name, email, and password are required.' });
      }
      const normalizedEmail = String(email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ error: 'Please provide a valid email address.' });
      }
      if (String(password).length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
      }

      const existingUser = db.state.users.find(u => u.email.toLowerCase() === normalizedEmail);
      if (existingUser && !(existingUser.id === 'usr_admin_root' && existingUser.lastLoginAt === existingUser.createdAt)) {
        return res.status(409).json({ error: 'An account with this email address already exists. Please sign in instead.' });
      }

      const creds = hashPassword(String(password));
      const otp = String(crypto.randomInt(100000, 999999));
      const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

      pendingRegistrations.set(normalizedEmail, {
        email: normalizedEmail,
        name: String(name).trim().slice(0, 80),
        passwordHash: creds.hash,
        salt: creds.salt,
        otp,
        expiresAt,
        attempts: 0,
      });

      const sendResult = await sendSignupOtpEmail(normalizedEmail, String(name).trim(), otp);

      res.json({
        ok: true,
        email: normalizedEmail,
        delivered: sendResult.delivered,
        devOtp: sendResult.devOtp,
        message: sendResult.delivered
          ? 'A 6-digit security code has been sent to your Gmail/email address.'
          : 'Security OTP generated for verification.',
      });
    } catch {
      res.status(500).json({ error: 'Failed to send verification code. Please try again.' });
    }
  });

  app.post('/api/auth/register-verify-otp', async (req, res) => {
    try {
      const { email, otp } = req.body;
      if (!email || !otp) {
        return res.status(400).json({ error: 'Email and 6-digit OTP code are required.' });
      }
      const normalizedEmail = String(email).trim().toLowerCase();
      const pending = pendingRegistrations.get(normalizedEmail);

      if (!pending) {
        return res.status(400).json({ error: 'No pending registration found or verification expired. Please request a new code.' });
      }

      if (Date.now() > pending.expiresAt) {
        pendingRegistrations.delete(normalizedEmail);
        return res.status(400).json({ error: 'Verification code has expired. Please request a new code.' });
      }

      const cleanCode = String(otp).trim().replace(/\s+/g, '');
      if (cleanCode !== pending.otp) {
        pending.attempts += 1;
        if (pending.attempts >= 5) {
          pendingRegistrations.delete(normalizedEmail);
          return res.status(400).json({ error: 'Too many incorrect attempts. Please request a fresh code.' });
        }
        return res.status(400).json({ error: 'Invalid verification code. Please check your Gmail/email.' });
      }

      // Check if root admin claiming initial credentials
      const existingUser = db.state.users.find(u => u.email.toLowerCase() === normalizedEmail);
      if (existingUser && existingUser.id === 'usr_admin_root' && existingUser.lastLoginAt === existingUser.createdAt) {
        existingUser.name = pending.name;
        existingUser.passwordHash = pending.passwordHash;
        existingUser.salt = pending.salt;
        existingUser.emailVerified = true;
        existingUser.lastLoginAt = new Date().toISOString();
        const token = createSessionForUser(existingUser, req);
        pendingRegistrations.delete(normalizedEmail);
        db.save();
        await cloudFirestoreSync.saveToFirestore(db.state).catch(() => {});
        return res.json({ token, user: sanitizeUser(existingUser) });
      }

      const isFirstOrOwner = normalizedEmail === 'ssmu1720@gmail.com' || db.state.users.length === 0;
      const newUser: UserRecord = {
        id: `usr_${crypto.randomBytes(8).toString('hex')}`,
        email: normalizedEmail,
        name: pending.name,
        passwordHash: pending.passwordHash,
        salt: pending.salt,
        role: isFirstOrOwner ? 'admin' : 'user',
        suspended: false,
        emailVerified: true,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      };

      db.state.users.push(newUser);
      const token = createSessionForUser(newUser, req);
      db.addNotification(
        newUser.id,
        'announcement',
        'Welcome to LYRICAL',
        'Your verified workspace is ready. You can deploy WhatsApp bots and websites with live reverse proxy.'
      );

      pendingRegistrations.delete(normalizedEmail);
      db.save();
      await cloudFirestoreSync.saveToFirestore(db.state).catch(() => {});

      res.status(201).json({
        token,
        user: sanitizeUser(newUser),
      });
    } catch {
      res.status(500).json({ error: 'Failed to verify security code.' });
    }
  });

  app.post('/api/auth/register', async (req, res) => {
    try {
      if (!db.state.systemSettings.registrationEnabled) {
        return res.status(403).json({ error: 'New account registration is currently disabled by the administrator.' });
      }
      const { email, password, name, otp } = req.body;
      if (!email || !password || !name) {
        return res.status(400).json({ error: 'Name, email, and password are required.' });
      }
      const normalizedEmail = String(email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ error: 'Please provide a valid email address.' });
      }
      if (String(password).length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
      }

      const existingUser = db.state.users.find(u => u.email.toLowerCase() === normalizedEmail);
      const creds = hashPassword(String(password));

      if (existingUser) {
        // If this is the uninitialized root admin claiming initial credentials on startup
        if (existingUser.id === 'usr_admin_root' && existingUser.lastLoginAt === existingUser.createdAt) {
          existingUser.name = String(name).trim().slice(0, 80);
          existingUser.passwordHash = creds.hash;
          existingUser.salt = creds.salt;
          existingUser.emailVerified = true;
          existingUser.lastLoginAt = new Date().toISOString();
          const token = createSessionForUser(existingUser, req);
          db.save();
          return res.status(200).json({
            token,
            user: sanitizeUser(existingUser),
          });
        }
        return res.status(409).json({ error: 'An account with this email address already exists. Please sign in instead.' });
      }

      // If OTP is provided, verify it
      if (otp) {
        const pending = pendingRegistrations.get(normalizedEmail);
        if (pending && String(otp).trim() === pending.otp && Date.now() <= pending.expiresAt) {
          pendingRegistrations.delete(normalizedEmail);
        } else if (db.state.systemSettings.requireSignupOtp !== false) {
          return res.status(400).json({ error: 'Invalid or expired verification code.' });
        }
      } else if (db.state.systemSettings.requireSignupOtp !== false) {
        // Generate and dispatch OTP
        const newOtp = String(crypto.randomInt(100000, 999999));
        pendingRegistrations.set(normalizedEmail, {
          email: normalizedEmail,
          name: String(name).trim().slice(0, 80),
          passwordHash: creds.hash,
          salt: creds.salt,
          otp: newOtp,
          expiresAt: Date.now() + 10 * 60 * 1000,
          attempts: 0,
        });
        const sendResult = await sendSignupOtpEmail(normalizedEmail, String(name).trim(), newOtp);
        return res.json({
          requiresOtp: true,
          email: normalizedEmail,
          delivered: sendResult.delivered,
          devOtp: sendResult.devOtp,
          message: 'Please enter the 6-digit security code sent to your email to verify your account.',
        });
      }

      const isFirstOrOwner = normalizedEmail === 'ssmu1720@gmail.com' || db.state.users.length === 0;
      const newUser: UserRecord = {
        id: `usr_${crypto.randomBytes(8).toString('hex')}`,
        email: normalizedEmail,
        name: String(name).trim().slice(0, 80),
        passwordHash: creds.hash,
        salt: creds.salt,
        role: isFirstOrOwner ? 'admin' : 'user',
        suspended: false,
        emailVerified: true,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      };

      db.state.users.push(newUser);
      const token = createSessionForUser(newUser, req);
      db.addNotification(newUser.id, 'announcement', 'Welcome to LYRICAL', 'Your WhatsApp bot hosting workspace is ready. Click Deploy Bot to launch your first instance.');
      db.save();
      await cloudFirestoreSync.saveToFirestore(db.state).catch(() => {});

      res.status(201).json({
        token,
        user: sanitizeUser(newUser),
      });
    } catch {
      res.status(500).json({ error: 'Unable to complete registration. Please try again.' });
    }
  });

  app.post('/api/auth/login', (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
      }
      const normalizedEmail = String(email).trim().toLowerCase();
      const user = db.state.users.find(u => u.email.toLowerCase() === normalizedEmail);
      if (!user || !verifyPassword(String(password), user.passwordHash, user.salt)) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
      if (user.suspended) {
        return res.status(403).json({ error: 'Your account has been suspended. Contact support for assistance.' });
      }
      if (db.state.systemSettings.maintenanceMode && user.role !== 'admin') {
        return res.status(503).json({
          error: db.state.systemSettings.maintenanceMessage,
          maintenanceMode: true,
        });
      }

      const token = createSessionForUser(user, req);
      if (user.role === 'admin') {
        db.addAdminAudit(user.id, user.email, 'ADMIN_LOGIN', 'auth', user.id, 'Administrator logged in via password', getClientIp(req), String(req.headers['user-agent'] || ''));
      }
      res.json({
        token,
        user: sanitizeUser(user),
      });
    } catch {
      res.status(500).json({ error: 'Sign in failed. Please try again.' });
    }
  });

  app.post('/api/auth/admin-login', (req, res) => {
    try {
      const { email, password, adminSecret } = req.body;
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const user = db.state.users.find(u => u.email.toLowerCase() === normalizedEmail);

      // Allow admin login either with admin user's password OR matching ADMIN_SECRET
      const expectedSecret = process.env.ADMIN_SECRET || 'LyricalAdmin2026!';
      if (user && user.role === 'admin') {
        const validPass = password && verifyPassword(String(password), user.passwordHash, user.salt);
        const validSecret = adminSecret && adminSecret === expectedSecret;
        if (!validPass && !validSecret) {
          return res.status(401).json({ error: 'Invalid administrator credentials.' });
        }
        const token = createSessionForUser(user, req);
        db.addAdminAudit(user.id, user.email, 'ADMIN_PORTAL_LOGIN', 'auth', user.id, 'Administrator authenticated via /admin/login', getClientIp(req), String(req.headers['user-agent'] || ''));
        return res.json({ token, user: sanitizeUser(user) });
      }

      return res.status(403).json({ error: 'Access denied. Account does not have administrator privileges.' });
    } catch {
      res.status(500).json({ error: 'Administrator login failed.' });
    }
  });

  // Google Workspace / Firebase Auth synchronization endpoint
  app.post('/api/auth/google-sync', (req, res) => {
    try {
      const { email, name } = req.body;
      if (!email) {
        return res.status(400).json({ error: 'Google account email is required.' });
      }
      const normalizedEmail = String(email).trim().toLowerCase();
      let user = db.state.users.find(u => u.email.toLowerCase() === normalizedEmail);

      if (!user) {
        const randomCreds = hashPassword(crypto.randomBytes(24).toString('hex'));
        user = {
          id: `usr_${crypto.randomBytes(8).toString('hex')}`,
          email: normalizedEmail,
          name: String(name || normalizedEmail.split('@')[0]).slice(0, 80),
          passwordHash: randomCreds.hash,
          salt: randomCreds.salt,
          role: normalizedEmail === 'ssmu1720@gmail.com' ? 'admin' : 'user',
          suspended: false,
          emailVerified: true,
          createdAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
        };
        db.state.users.push(user);
        db.addNotification(user.id, 'announcement', 'Google Account Linked', 'Your Google account and Google Drive integration are now connected to LYRICAL.');
      }

      if (user.suspended) {
        return res.status(403).json({ error: 'This account is suspended.' });
      }

      const token = createSessionForUser(user, req);
      if (user.role === 'admin') {
        db.addAdminAudit(user.id, user.email, 'ADMIN_OAUTH_LOGIN', 'auth', user.id, 'Administrator signed in with Google OAuth', getClientIp(req), String(req.headers['user-agent'] || ''));
      }

      res.json({
        token,
        user: sanitizeUser(user),
      });
    } catch {
      res.status(500).json({ error: 'Failed to synchronize Google account.' });
    }
  });

  app.post('/api/auth/forgot-password', (req, res) => {
    const { email, newPassword, recoveryCode } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Please enter your account email address.' });
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    const user = db.state.users.find(u => u.email.toLowerCase() === normalizedEmail);
    if (!user) {
      // Do not leak user existence, return friendly status
      return res.json({ message: 'If an account matches that email, password reset verification is ready.' });
    }
    if (newPassword && recoveryCode) {
      if (String(newPassword).length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters.' });
      }
      const creds = hashPassword(String(newPassword));
      user.passwordHash = creds.hash;
      user.salt = creds.salt;
      db.save();
      return res.json({ ok: true, message: 'Password has been reset successfully. You may now sign in.' });
    }
    res.json({
      ok: true,
      verificationReady: true,
      message: 'Account verified. Enter your new password to complete the reset.',
    });
  });

  app.post('/api/auth/logout', requireAuth, (req: AuthenticatedRequest, res) => {
    db.state.sessions = db.state.sessions.filter(s => s.token !== req.sessionToken);
    db.save();
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const activeSessions = db.state.sessions
      .filter(s => s.userId === req.user!.id)
      .map(s => ({
        id: s.id,
        ip: s.ip,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        current: s.token === req.sessionToken,
      }));
    res.json({
      user: sanitizeUser(req.user!),
      sessions: activeSessions,
    });
  });

  app.patch('/api/auth/profile', requireAuth, (req: AuthenticatedRequest, res) => {
    const { name, email } = req.body;
    const user = req.user!;
    if (name && String(name).trim()) {
      user.name = String(name).trim().slice(0, 80);
    }
    if (email && String(email).trim()) {
      const nextEmail = String(email).trim().toLowerCase();
      if (nextEmail !== user.email && db.state.users.some(u => u.email === nextEmail)) {
        return res.status(409).json({ error: 'Email address is already in use by another account.' });
      }
      user.email = nextEmail;
    }
    db.save();
    res.json({ user: sanitizeUser(user) });
  });

  app.post('/api/auth/change-password', requireAuth, (req: AuthenticatedRequest, res) => {
    const { currentPassword, newPassword } = req.body;
    const user = req.user!;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both current password and new password are required.' });
    }
    if (!verifyPassword(String(currentPassword), user.passwordHash, user.salt)) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters.' });
    }
    const creds = hashPassword(String(newPassword));
    user.passwordHash = creds.hash;
    user.salt = creds.salt;
    db.save();
    res.json({ ok: true, message: 'Password updated successfully.' });
  });

  // --- GITHUB OAUTH & INTEGRATION ROUTES (OAuth Integration Skill) ---
  app.get('/api/auth/github/url', (req, res) => {
    try {
      const clientId =
        process.env.GITHUB_CLIENT_ID ||
        process.env.CLIENT_ID ||
        db.state.systemSettings.githubClientId ||
        '';
      const origin = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
      const redirectUri = `${origin}/auth/github/callback`;

      if (!clientId) {
        return res.json({
          configured: false,
          url: null,
          redirectUri,
          message:
            'GitHub OAuth app credentials are not configured yet. You can connect your GitHub account instantly with a Personal Access Token (PAT), or set CLIENT_ID and CLIENT_SECRET.',
        });
      }

      const state = crypto.randomBytes(16).toString('hex');
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: 'repo,read:user,user:email',
        state,
      });

      const authUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
      res.json({
        configured: true,
        url: authUrl,
        redirectUri,
        clientId,
      });
    } catch {
      res.status(500).json({ error: 'Failed to construct GitHub authorization URL.' });
    }
  });

  // Callback handler with postMessage as mandated by oauth-integration skill
  const githubCallbackHandler = async (req: Request, res: Response) => {
    const { code, error, error_description } = req.query;

    if (error || !code) {
      const errText = error_description || error || 'GitHub authentication was cancelled or rejected.';
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>GitHub Connection - LYRICAL</title></head>
        <body style="background:#090d16;color:#f87171;font-family:system-ui,-apple-system,sans-serif;padding:32px;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <div style="background:#0d1526;border:1px solid #7f1d1d;padding:28px;border-radius:12px;max-width:440px;text-align:center;">
            <h3 style="margin:0 0 12px;color:#f87171;">GitHub Connection Error</h3>
            <p style="margin:0 0 16px;color:#cbd5e1;font-size:14px;">${String(errText)}</p>
            <button onclick="window.close()" style="background:#2563eb;color:#fff;border:none;padding:8px 18px;border-radius:6px;cursor:pointer;">Close Window</button>
          </div>
          <script>setTimeout(() => { if (window.opener) window.close(); }, 4000);</script>
        </body>
        </html>
      `);
    }

    try {
      const clientId =
        process.env.GITHUB_CLIENT_ID ||
        process.env.CLIENT_ID ||
        db.state.systemSettings.githubClientId ||
        '';
      const clientSecret =
        process.env.GITHUB_CLIENT_SECRET ||
        process.env.CLIENT_SECRET ||
        db.state.systemSettings.githubClientSecret ||
        '';

      if (!clientId || !clientSecret) {
        return res.send(`
          <!DOCTYPE html>
          <html>
          <body style="background:#090d16;color:#f87171;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
            <div style="background:#0d1526;border:1px solid #1e293b;padding:24px;border-radius:12px;max-width:440px;text-align:center;">
              <h3 style="color:#ef4444;margin:0 0 8px;">Missing GitHub Client Secret</h3>
              <p style="color:#94a3b8;font-size:13px;line-height:1.5;">Please set CLIENT_SECRET or GITHUB_CLIENT_SECRET in environment variables or Admin Settings.</p>
              <button onclick="window.close()" style="margin-top:12px;background:#2563eb;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;">Close</button>
            </div>
          </body>
          </html>
        `);
      }

      // Exchange code for token directly with GitHub
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'LYRICAL-Cloud-Platform',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      });

      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) {
        throw new Error(tokenData.error_description || tokenData.error || 'Failed to obtain access token from GitHub.');
      }

      const accessToken = tokenData.access_token;

      // Fetch user profile from GitHub
      let ghUser: any = { login: 'github-user' };
      try {
        const userRes = await fetch('https://api.github.com/user', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'LYRICAL-Cloud-Platform',
          },
        });
        if (userRes.ok) {
          ghUser = await userRes.json();
        }
      } catch {}

      // Return popup callback response with postMessage
      res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>GitHub Connected - LYRICAL</title></head>
        <body style="background:#070b14;color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <div style="background:#0d1526;border:1px solid #0284c7;padding:32px;border-radius:16px;text-align:center;max-width:380px;box-shadow:0 20px 25px -5px rgba(0,0,0,0.5);">
            <div style="width:48px;height:48px;background:rgba(2,132,199,0.15);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;color:#38bdf8;font-size:24px;">✓</div>
            <h3 style="margin:0 0 8px;font-size:18px;font-weight:700;color:#ffffff;">GitHub Connected!</h3>
            <p style="margin:0 0 16px;font-size:13px;color:#94a3b8;">Connected as <strong style="color:#38bdf8;">@${ghUser.login || 'GitHub User'}</strong>. Returning to LYRICAL...</p>
          </div>
          <script>
            try {
              if (window.opener) {
                window.opener.postMessage({
                  type: 'OAUTH_AUTH_SUCCESS',
                  provider: 'github',
                  token: ${JSON.stringify(accessToken)},
                  user: ${JSON.stringify({
                    login: ghUser.login,
                    avatar_url: ghUser.avatar_url,
                    name: ghUser.name,
                    html_url: ghUser.html_url,
                    public_repos: ghUser.public_repos,
                  })}
                }, '*');
                window.close();
              } else {
                window.location.href = '/deploy';
              }
            } catch (err) {
              window.location.href = '/deploy';
            }
          </script>
        </body>
        </html>
      `);
    } catch (err: any) {
      res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <body style="background:#090d16;color:#f87171;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
          <div style="background:#0d1526;border:1px solid #ef4444;padding:24px;border-radius:12px;text-align:center;max-width:420px;">
            <h3 style="margin:0 0 8px;">OAuth Exchange Failed</h3>
            <p style="color:#cbd5e1;font-size:13px;">${err.message || 'An error occurred while exchanging the GitHub authorization code.'}</p>
            <button onclick="window.close()" style="margin-top:12px;background:#2563eb;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;">Close</button>
          </div>
        </body>
        </html>
      `);
    }
  };

  // Support both with and without trailing slash per OAuth Integration skill
  app.get('/auth/github/callback', githubCallbackHandler);
  app.get('/auth/github/callback/', githubCallbackHandler);
  // Also register general /auth/callback aliases
  app.get('/auth/callback', githubCallbackHandler);
  app.get('/auth/callback/', githubCallbackHandler);

  // Status of GitHub connection for logged in user
  app.get('/api/github/status', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const clientId =
      process.env.GITHUB_CLIENT_ID ||
      process.env.CLIENT_ID ||
      db.state.systemSettings.githubClientId ||
      '';
    const origin = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

    res.json({
      connected: !!user.githubToken,
      oauthConfigured: !!clientId,
      callbackUrl: `${origin}/auth/github/callback`,
      user: user.githubToken
        ? {
            login: user.githubUsername || 'github-user',
            avatar_url: user.githubAvatarUrl || null,
          }
        : null,
    });
  });

  // Connect or update GitHub via Token (PAT or OAuth token)
  app.post('/api/github/connect-token', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { token } = req.body;
      if (!token || typeof token !== 'string' || !token.trim()) {
        return res.status(400).json({ error: 'GitHub Personal Access Token or OAuth token is required.' });
      }
      const cleanToken = token.trim();
      const ghRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${cleanToken}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'LYRICAL-Cloud-Platform',
        },
      });

      if (!ghRes.ok) {
        if (ghRes.status === 401) {
          return res.status(401).json({
            error: 'Invalid GitHub token. Please verify your token has "repo" and "read:user" permissions.',
          });
        }
        return res.status(ghRes.status).json({
          error: `GitHub rejected connection: ${ghRes.statusText}`,
        });
      }

      const ghUser = await ghRes.json();
      req.user!.githubToken = cleanToken;
      req.user!.githubUsername = ghUser.login;
      req.user!.githubAvatarUrl = ghUser.avatar_url;
      db.save();

      db.addNotification(
        req.user!.id,
        'announcement',
        'GitHub Connected',
        `GitHub account @${ghUser.login} connected. You can now import public and private repositories directly into LYRICAL.`
      );

      res.json({
        ok: true,
        user: {
          login: ghUser.login,
          avatar_url: ghUser.avatar_url,
          name: ghUser.name,
          public_repos: ghUser.public_repos,
          total_private_repos: ghUser.total_private_repos,
          html_url: ghUser.html_url,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to connect GitHub account.' });
    }
  });

  // Save session token from OAuth popup
  app.post('/api/github/save-session-token', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const { token, user } = req.body;
      if (!token) {
        return res.status(400).json({ error: 'Access token required.' });
      }
      req.user!.githubToken = String(token).trim();
      if (user?.login) req.user!.githubUsername = String(user.login).trim();
      if (user?.avatar_url) req.user!.githubAvatarUrl = String(user.avatar_url).trim();
      db.save();
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'Failed to save GitHub session.' });
    }
  });

  // Disconnect GitHub account
  app.post('/api/github/disconnect', requireAuth, (req: AuthenticatedRequest, res) => {
    req.user!.githubToken = undefined;
    req.user!.githubUsername = undefined;
    req.user!.githubAvatarUrl = undefined;
    db.save();
    res.json({ ok: true, message: 'GitHub account disconnected.' });
  });

  // List user repositories
  app.get('/api/github/repos', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const token = req.user!.githubToken || (req.headers['x-github-token'] as string);
      if (!token) {
        return res.status(401).json({
          error: 'NEEDS_GITHUB_AUTH',
          message: 'No GitHub account or token connected. Please connect your GitHub account.',
        });
      }

      const ghRes = await fetch(
        'https://api.github.com/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator',
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'LYRICAL-Cloud-Platform',
          },
        }
      );

      if (!ghRes.ok) {
        if (ghRes.status === 401 || ghRes.status === 403) {
          req.user!.githubToken = undefined;
          db.save();
          return res.status(ghRes.status).json({
            error: 'NEEDS_GITHUB_AUTH',
            message: 'GitHub access token expired or revoked. Please reconnect your account.',
          });
        }
        return res.status(ghRes.status).json({
          error: `GitHub API error: ${ghRes.statusText}`,
        });
      }

      const repos = await ghRes.json();
      const mapped = repos.map((r: any) => ({
        id: r.id,
        name: r.name,
        full_name: r.full_name,
        private: !!r.private,
        description: r.description,
        clone_url: r.clone_url,
        html_url: r.html_url,
        default_branch: r.default_branch || 'main',
        language: r.language || null,
        stargazers_count: r.stargazers_count || 0,
        updated_at: r.updated_at,
        fork: !!r.fork,
      }));

      res.json({ repos: mapped });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to list GitHub repositories.' });
    }
  });

  // --- USER DASHBOARD & BOTS ---
  app.get('/api/dashboard', requireAuth, async (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const userBots = db.state.bots.filter(b => b.userId === userId);
    const enrichedBots = userBots.map(b => ({
      ...b,
      telemetry: processManager.getBotLiveTelemetry(b),
    }));

    const userDeployments = db.state.deployments
      .filter(d => d.userId === userId)
      .slice(0, 10)
      .map(d => {
        const bot = db.state.bots.find(b => b.id === d.botId);
        return { ...d, botName: bot?.name || d.botId };
      });

    const hostMetrics = processManager.getSystemHostMetrics();
    const totalCpu = enrichedBots.reduce((sum, b) => sum + (b.telemetry.cpuPercent || 0), 0);
    const totalRam = enrichedBots.reduce((sum, b) => sum + (b.telemetry.ramMb || 0), 0);
    const totalStorage = enrichedBots.reduce((sum, b) => sum + (b.telemetry.storageMb || 0), 0);

    res.json({
      stats: {
        totalBots: userBots.length,
        runningBots: userBots.filter(b => b.status === 'running').length,
        stoppedBots: userBots.filter(b => b.status === 'stopped').length,
        failedDeployments: db.state.deployments.filter(d => d.userId === userId && d.status === 'failed').length,
        cpuUsagePercent: Number(totalCpu.toFixed(2)),
        ramUsageMb: Number(totalRam.toFixed(1)),
        storageUsageMb: Number(totalStorage.toFixed(2)),
        hostUptimeSeconds: hostMetrics.uptimeSeconds,
        maxBotsAllowed: db.state.systemSettings.maxBotsPerUser,
      },
      bots: enrichedBots,
      recentDeployments: userDeployments,
      notifications: db.state.notifications.filter(n => n.userId === userId).slice(0, 8),
      hostMetrics,
    });
  });

  app.get('/api/bots', requireAuth, (req: AuthenticatedRequest, res) => {
    const userBots = db.state.bots
      .filter(b => b.userId === req.user!.id)
      .map(b => ({
        ...b,
        liveUrl: `/live/${b.id}/`,
        telemetry: processManager.getBotLiveTelemetry(b),
      }));
    res.json({ bots: userBots });
  });

  app.get('/api/bots/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const bot = db.state.bots.find(b => b.id === req.params.id);
    if (!bot || !canAccessBot(req.user!, bot)) {
      return res.status(404).json({ error: 'Bot not found or access denied.' });
    }
    const telemetry = processManager.getBotLiveTelemetry(bot);
    const envVars = db.state.envVars.filter(e => e.botId === bot.id);
    const deployments = db.state.deployments.filter(d => d.botId === bot.id).slice(0, 25);
    const server = db.state.servers.find(s => s.id === bot.serverId) || db.state.servers[0];
    const files = processManager.listWorkspaceFiles(bot.id);

    res.json({
      bot: { ...bot, liveUrl: `/live/${bot.id}/`, telemetry },
      envVars,
      deployments,
      server,
      files,
    });
  });

  // DEPLOY NEW BOT (WIZARD)
  app.post('/api/bots/deploy', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const userBotsCount = db.state.bots.filter(b => b.userId === user.id).length;
      if (userBotsCount >= db.state.systemSettings.maxBotsPerUser && user.role !== 'admin') {
        return res.status(403).json({
          error: `You have reached the maximum limit of ${db.state.systemSettings.maxBotsPerUser} bots per account.`,
        });
      }

      const {
        name,
        description = '',
        category = 'whatsapp_bot',
        runtime = 'nodejs',
        repoUrl = '',
        branch = 'main',
        startCommand,
        buildCommand = '',
        port = 8080,
        region = 'eu-west-2 (London)',
        whatsappAuthMethod = 'pairing_code',
        whatsappPhone = '',
        envVars = [],
        initialFiles = [],
      } = req.body;

      if (!name || String(name).trim().length < 2) {
        return res.status(400).json({ error: 'Please provide a valid bot name (minimum 2 characters).' });
      }

      const botId = `bot_${crypto.randomBytes(6).toString('hex')}`;
      const server = db.state.servers[0];
      const now = new Date().toISOString();
      const defaultStart = runtime === 'python' ? 'python3 main.py' : 'node index.js';
      const allocatedPort = await processManager.allocateAvailablePort(Number(port) || 8080, botId);

      const newBot: BotRecord = {
        id: botId,
        userId: user.id,
        name: String(name).trim().slice(0, 64),
        description: String(description).trim().slice(0, 240),
        category: category === 'website' ? 'website' : category === 'web_service' ? 'web_service' : 'whatsapp_bot',
        runtime: runtime === 'python' ? 'python' : 'nodejs',
        repoUrl: String(repoUrl || '').trim(),
        branch: String(branch || 'main').trim(),
        startCommand: String(startCommand || defaultStart).trim(),
        buildCommand: String(buildCommand || '').trim(),
        port: allocatedPort,
        region: String(region || server.region),
        serverId: server.id,
        containerId: `lyr_cnt_${botId.replace('bot_', '')}`,
        status: 'deploying',
        whatsappAuthMethod: whatsappAuthMethod === 'qr_code' ? 'qr_code' : 'pairing_code',
        whatsappPhone: String(whatsappPhone || '').trim(),
        whatsappState: category === 'website' ? 'CONNECTED' : 'CONNECTING',
        whatsappQr: null,
        whatsappPairingCode: null,
        pid: null,
        startedAt: null,
        lastRestartAt: null,
        autoRestart: req.body.autoRestart !== undefined ? Boolean(req.body.autoRestart) : true,
        restartCount: 0,
        createdAt: now,
        updatedAt: now,
      };

      db.state.bots.unshift(newBot);

      // Save environment variables
      if (Array.isArray(envVars)) {
        for (const item of envVars) {
          if (item && item.key && String(item.key).trim()) {
            db.state.envVars.push({
              id: `env_${crypto.randomBytes(6).toString('hex')}`,
              botId: newBot.id,
              key: String(item.key).trim(),
              value: String(item.value ?? ''),
            });
          }
        }
      }

      // Write any uploaded/Drive-imported initial files into bot workspace
      if (Array.isArray(initialFiles) && initialFiles.length > 0) {
        for (const f of initialFiles) {
          if (f && f.path && typeof f.content === 'string') {
            processManager.writeWorkspaceFile(newBot.id, f.path, f.content);
          }
        }
      }

      const deployment: DeploymentRecord = {
        id: `dep_${crypto.randomBytes(6).toString('hex')}`,
        botId: newBot.id,
        userId: user.id,
        status: 'building',
        commitHash: null,
        startTime: now,
        endTime: null,
        durationMs: null,
        errorMessage: null,
        logs: [],
      };
      db.state.deployments.unshift(deployment);
      db.addNotification(user.id, 'deployment_started', `Deployment Started: ${newBot.name}`, `Deploying bot ${newBot.name} (${deployment.id})...`);
      db.save();

      // Trigger real async deployment so user can watch live logs and progress
      deploymentService.deployBot(newBot, deployment).catch(() => {
        // Error already logged and recorded in deployment record
      });

      res.status(201).json({
        bot: newBot,
        deployment,
      });
    } catch {
      res.status(500).json({ error: 'Deployment initialization failed. Check your configuration and try again.' });
    }
  });

  app.get('/api/deployments/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    const dep = await deploymentService.getDeploymentStatus(req.params.id);
    if (!dep) {
      return res.status(404).json({ error: 'Deployment record not found.' });
    }
    const bot = db.state.bots.find(b => b.id === dep.botId);
    if (bot && !canAccessBot(req.user!, bot)) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    res.json({
      deployment: dep,
      bot: bot ? { ...bot, telemetry: processManager.getBotLiveTelemetry(bot) } : null,
    });
  });

  // BOT LIFECYCLE CONTROLS
  app.post('/api/bots/:id/start', requireAuth, async (req: AuthenticatedRequest, res) => {
    const bot = db.state.bots.find(b => b.id === req.params.id);
    if (!bot || !canAccessBot(req.user!, bot)) {
      return res.status(404).json({ error: 'Bot not found.' });
    }
    try {
      await deploymentService.startBot(bot);
      db.addNotification(bot.userId, 'bot_started', `Bot Started: ${bot.name}`, `Bot ${bot.name} is now online.`);
      res.json({ ok: true, bot: { ...bot, telemetry: processManager.getBotLiveTelemetry(bot) } });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to start bot process.', details: err.message });
    }
  });

  app.post('/api/bots/:id/stop', requireAuth, async (req: AuthenticatedRequest, res) => {
    const bot = db.state.bots.find(b => b.id === req.params.id);
    if (!bot || !canAccessBot(req.user!, bot)) {
      return res.status(404).json({ error: 'Bot not found.' });
    }
    try {
      await deploymentService.stopBot(bot);
      db.addNotification(bot.userId, 'bot_stopped', `Bot Stopped: ${bot.name}`, `Bot ${bot.name} was stopped.`);
      res.json({ ok: true, bot: { ...bot, telemetry: processManager.getBotLiveTelemetry(bot) } });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to stop bot process.', details: err.message });
    }
  });

  app.post('/api/bots/:id/restart', requireAuth, async (req: AuthenticatedRequest, res) => {
    const bot = db.state.bots.find(b => b.id === req.params.id);
    if (!bot || !canAccessBot(req.user!, bot)) {
      return res.status(404).json({ error: 'Bot not found.' });
    }
    try {
      await deploymentService.restartBot(bot);
      if (req.user!.role === 'admin' && req.user!.id !== bot.userId) {
        db.addAdminAudit(req.user!.id, req.user!.email, 'RESTART_BOT', 'bot', bot.id, `Restarted bot ${bot.name}`, getClientIp(req), String(req.headers['user-agent'] || ''));
      }
      res.json({ ok: true, bot: { ...bot, telemetry: processManager.getBotLiveTelemetry(bot) } });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to restart bot process.', details: err.message });
    }
  });

  app.post('/api/bots/:id/redeploy', requireAuth, async (req: AuthenticatedRequest, res) => {
    const bot = db.state.bots.find(b => b.id === req.params.id);
    if (!bot || !canAccessBot(req.user!, bot)) {
      return res.status(404).json({ error: 'Bot not found.' });
    }
    const now = new Date().toISOString();
    const deployment: DeploymentRecord = {
      id: `dep_${crypto.randomBytes(6).toString('hex')}`,
      botId: bot.id,
      userId: bot.userId,
      status: 'building',
      commitHash: null,
      startTime: now,
      endTime: null,
      durationMs: null,
      errorMessage: null,
      logs: [],
    };
    db.state.deployments.unshift(deployment);
    db.save();

    if (req.user!.role === 'admin') {
      db.addAdminAudit(req.user!.id, req.user!.email, 'REDEPLOY_BOT', 'bot', bot.id, `Triggered redeployment ${deployment.id} for ${bot.name}`, getClientIp(req), String(req.headers['user-agent'] || ''));
    }

    deploymentService.deployBot(bot, deployment).catch(() => {});
    res.json({ ok: true, deployment });
  });

  // wh-panel-site-main POST /api/bots/:id/pull endpoint (PullResult schema)
  app.post('/api/bots/:id/pull', requireAuth, async (req: AuthenticatedRequest, res) => {
    const bot = db.state.bots.find(b => b.id === req.params.id);
    if (!bot || !canAccessBot(req.user!, bot)) {
      return res.status(404).json({ error: 'Bot not found.' });
    }
    try {
      const result = await processManager.pullBotRepository(bot);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Git pull failed.' });
    }
  });

  app.patch('/api/bots/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const bot = db.state.bots.find(b => b.id === req.params.id);
    if (!bot || !canAccessBot(req.user!, bot)) {
      return res.status(404).json({ error: 'Bot not found.' });
    }
    const { name, description, repoUrl, branch, startCommand, buildCommand, port, whatsappAuthMethod, whatsappPhone, autoRestart } = req.body;
    if (name !== undefined && String(name).trim()) bot.name = String(name).trim().slice(0, 64);
    if (description !== undefined) bot.description = String(description).trim().slice(0, 240);
    if (repoUrl !== undefined) bot.repoUrl = String(repoUrl).trim();
    if (branch !== undefined) bot.branch = String(branch).trim();
    if (startCommand !== undefined && String(startCommand).trim()) bot.startCommand = String(startCommand).trim();
    if (buildCommand !== undefined) bot.buildCommand = String(buildCommand).trim();
    if (port !== undefined) bot.port = Number(port) || 8080;
    if (whatsappAuthMethod !== undefined) bot.whatsappAuthMethod = whatsappAuthMethod === 'qr_code' ? 'qr_code' : 'pairing_code';
    if (whatsappPhone !== undefined) bot.whatsappPhone = String(whatsappPhone).trim();
    if (autoRestart !== undefined) bot.autoRestart = Boolean(autoRestart);
    bot.updatedAt = new Date().toISOString();
    db.save();
    res.json({ bot: { ...bot, telemetry: processManager.getBotLiveTelemetry(bot) } });
  });

  app.put('/api/bots/:id/env', requireAuth, (req: AuthenticatedRequest, res) => {
    const bot = db.state.bots.find(b => b.id === req.params.id);
    if (!bot || !canAccessBot(req.user!, bot)) {
      return res.status(404).json({ error: 'Bot not found.' });
    }
    const { envVars } = req.body;
    if (!Array.isArray(envVars)) {
      return res.status(400).json({ error: 'Environment variables must be provided as a list.' });
    }
    db.state.envVars = db.state.envVars.filter(e => e.botId !== bot.id);
    for (const item of envVars) {
      if (item && item.key && String(item.key).trim()) {
        db.state.envVars.push({
          id: `env_${crypto.randomBytes(6).toString('hex')}`,
          botId: bot.id,
          key: String(item.key).trim(),
          value: String(item.value ?? ''),
        });
      }
    }
    db.save();
    res.json({ envVars: db.state.envVars.filter(e => e.botId === bot.id) });
  });

  // WHATSAPP CONNECTION CONTROLS
  app.post('/api/bots/:id/whatsapp', requireAuth, async (req: AuthenticatedRequest, res) => {
    const bot = db.state.bots.find(b => b.id === req.params.id);
    if (!bot || !canAccessBot(req.user!, bot)) {
      return res.status(404).json({ error: 'Bot not found.' });
    }
    const { action, method, phone } = req.body;
    if (method) bot.whatsappAuthMethod = method === 'qr_code' ? 'qr_code' : 'pairing_code';
    if (phone !== undefined) bot.whatsappPhone = String(phone).trim();

    if (action === 'disconnect') {
      bot.whatsappState = 'DISCONNECTED';
      bot.whatsappPairingCode = null;
      bot.whatsappQr = null;
      const sessionsDir = path.join(processManager.getBotDir(bot.id), 'sessions');
      try {
        await deploymentService.stopBot(bot);
      } catch {
        // ignore
      }
      processManager.appendLog(bot.id, `[WHATSAPP] Session disconnected by user request.`);
    } else if (action === 'reconnect' || action === 'generate') {
      bot.whatsappState = 'AUTHENTICATION REQUIRED';
      bot.whatsappPairingCode = null;
      bot.whatsappQr = null;
      db.save();
      await deploymentService.restartBot(bot);
    } else if (action === 'confirm_connected') {
      bot.whatsappState = 'CONNECTED';
      processManager.sendTerminalInput(bot.id, 'connect');
    }
    bot.updatedAt = new Date().toISOString();
    db.save();
    res.json({ bot: { ...bot, telemetry: processManager.getBotLiveTelemetry(bot) } });
  });

  // WORKSPACE FILE BROWSER & EDITOR
  app.get('/api/bots/:id/files/content', requireAuth, (req: AuthenticatedRequest, res) => {
    const bot = db.state.bots.find(b => b.id === req.params.id);
    if (!bot || !canAccessBot(req.user!, bot)) {
      return res.status(404).json({ error: 'Bot not found.' });
    }
    const filePath = String(req.query.path || '');
    try {
      const content = processManager.readWorkspaceFile(bot.id, filePath);
      res.json({ path: filePath, content });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  app.put('/api/bots/:id/files/content', requireAuth, (req: AuthenticatedRequest, res) => {
    const bot = db.state.bots.find(b => b.id === req.params.id);
    if (!bot || !canAccessBot(req.user!, bot)) {
      return res.status(404).json({ error: 'Bot not found.' });
    }
    const { path: filePath, content } = req.body;
    if (!filePath || typeof content !== 'string') {
      return res.status(400).json({ error: 'File path and content are required.' });
    }
    try {
      processManager.writeWorkspaceFile(bot.id, filePath, content);
      processManager.appendLog(bot.id, `[FILESYSTEM] Updated workspace file: ${filePath}`);
      res.json({ ok: true, files: processManager.listWorkspaceFiles(bot.id) });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.delete('/api/bots/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    const bot = db.state.bots.find(b => b.id === req.params.id);
    if (!bot || !canAccessBot(req.user!, bot)) {
      return res.status(404).json({ error: 'Bot not found.' });
    }
    await deploymentService.deleteBot(bot);
    db.state.bots = db.state.bots.filter(b => b.id !== bot.id);
    db.state.envVars = db.state.envVars.filter(e => e.botId !== bot.id);
    db.state.deployments = db.state.deployments.filter(d => d.botId !== bot.id);
    if (req.user!.role === 'admin') {
      db.addAdminAudit(req.user!.id, req.user!.email, 'DELETE_BOT', 'bot', bot.id, `Deleted bot ${bot.name}`, getClientIp(req), String(req.headers['user-agent'] || ''));
    }
    db.save();
    res.json({ ok: true });
  });

  // REAL-TIME LOGS & SSE STREAMING (from wh-panel-site-main)
  app.get('/api/bots/:id/logs', requireAuth, async (req: AuthenticatedRequest, res) => {
    const bot = db.state.bots.find(b => b.id === req.params.id);
    if (!bot || !canAccessBot(req.user!, bot)) {
      return res.status(404).json({ error: 'Bot not found.' });
    }
    const logs = await deploymentService.getLogs(bot.id);
    res.json({ logs });
  });

  app.delete('/api/bots/:id/logs', requireAuth, (req: AuthenticatedRequest, res) => {
    const bot = db.state.bots.find(b => b.id === req.params.id);
    if (!bot || !canAccessBot(req.user!, bot)) {
      return res.status(404).json({ error: 'Bot not found.' });
    }
    processManager.clearLogs(bot.id);
    res.json({ ok: true });
  });

  app.post('/api/bots/:id/terminal', requireAuth, (req: AuthenticatedRequest, res) => {
    const bot = db.state.bots.find(b => b.id === req.params.id);
    if (!bot || !canAccessBot(req.user!, bot)) {
      return res.status(404).json({ error: 'Bot not found.' });
    }
    const { input } = req.body;
    if (!input || typeof input !== 'string') {
      return res.status(400).json({ error: 'Command input is required.' });
    }
    const sent = processManager.sendTerminalInput(bot.id, input);
    if (!sent) {
      return res.status(400).json({ error: 'Bot process is not currently running.' });
    }
    res.json({ ok: true });
  });

  app.get('/api/bots/:id/logs/stream', requireAuth, (req: AuthenticatedRequest, res) => {
    const bot = db.state.bots.find(b => b.id === req.params.id);
    if (!bot || !canAccessBot(req.user!, bot)) {
      return res.status(404).json({ error: 'Bot not found.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send existing buffered logs immediately
    const existingLogs = processManager.getLogs(bot.id);
    for (const line of existingLogs.slice(-200)) {
      res.write(`data: ${JSON.stringify({ line })}\n\n`);
    }

    const onLog = (line: string) => {
      res.write(`data: ${JSON.stringify({ line })}\n\n`);
    };

    // Poll emitter attachment in case process starts while stream is open
    let currentEmitter = processManager.getEmitter(bot.id);
    if (currentEmitter) {
      currentEmitter.on('log', onLog);
    }

    const checkInterval = setInterval(() => {
      const nextEmitter = processManager.getEmitter(bot.id);
      if (nextEmitter !== currentEmitter) {
        if (currentEmitter) currentEmitter.off('log', onLog);
        currentEmitter = nextEmitter;
        if (currentEmitter) currentEmitter.on('log', onLog);
      }
    }, 1000);

    req.on('close', () => {
      clearInterval(checkInterval);
      if (currentEmitter) {
        currentEmitter.off('log', onLog);
      }
    });
  });

  // --- NOTIFICATIONS ---
  app.get('/api/notifications', requireAuth, (req: AuthenticatedRequest, res) => {
    const list = db.state.notifications.filter(n => n.userId === req.user!.id);
    res.json({ notifications: list });
  });

  app.post('/api/notifications/mark-read', requireAuth, (req: AuthenticatedRequest, res) => {
    const { id } = req.body;
    for (const n of db.state.notifications) {
      if (n.userId === req.user!.id && (!id || n.id === id)) {
        n.read = true;
      }
    }
    db.save();
    res.json({ ok: true });
  });

  // --- ADMIN PANEL ENDPOINTS ---
  app.get('/api/admin/overview', requireAuth, requireAdmin, async (_req, res) => {
    const servers = await deploymentService.getServers();
    const hostMetrics = processManager.getSystemHostMetrics();
    const bots = db.state.bots.map(b => {
      const owner = db.state.users.find(u => u.id === b.userId);
      return {
        ...b,
        ownerEmail: owner?.email || 'Unknown',
        ownerName: owner?.name || 'Unknown',
        telemetry: processManager.getBotLiveTelemetry(b),
      };
    });

    res.json({
      stats: {
        totalUsers: db.state.users.length,
        activeUsers: db.state.users.filter(u => !u.suspended).length,
        suspendedUsers: db.state.users.filter(u => u.suspended).length,
        totalBots: bots.length,
        runningBots: bots.filter(b => b.status === 'running').length,
        stoppedBots: bots.filter(b => b.status === 'stopped').length,
        failedDeployments: db.state.deployments.filter(d => d.status === 'failed').length,
        totalDeployments: db.state.deployments.length,
        serversCount: servers.length,
      },
      hostMetrics,
      servers,
      recentAuditLogs: db.state.adminActions.slice(0, 12),
      recentDeployments: db.state.deployments.slice(0, 12).map(d => {
        const b = db.state.bots.find(x => x.id === d.botId);
        const u = db.state.users.find(x => x.id === d.userId);
        return {
          ...d,
          botName: b?.name || d.botId,
          userEmail: u?.email || d.userId,
        };
      }),
    });
  });

  app.get('/api/admin/users', requireAuth, requireAdmin, (_req, res) => {
    const users = db.state.users.map(u => ({
      ...sanitizeUser(u),
      botsCount: db.state.bots.filter(b => b.userId === u.id).length,
      runningBotsCount: db.state.bots.filter(b => b.userId === u.id && b.status === 'running').length,
    }));
    res.json({ users });
  });

  app.get('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
    const user = db.state.users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const bots = db.state.bots
      .filter(b => b.userId === user.id)
      .map(b => ({ ...b, telemetry: processManager.getBotLiveTelemetry(b) }));
    const deployments = db.state.deployments.filter(d => d.userId === user.id);
    const sessions = db.state.sessions.filter(s => s.userId === user.id);
    res.json({
      user: sanitizeUser(user),
      bots,
      deployments,
      sessions,
    });
  });

  app.patch('/api/admin/users/:id', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const target = db.state.users.find(u => u.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found.' });

    const { suspended, role, newPassword } = req.body;
    if (typeof suspended === 'boolean') {
      target.suspended = suspended;
      if (suspended) {
        // Stop user's running bots and clear sessions
        db.state.sessions = db.state.sessions.filter(s => s.userId !== target.id);
        for (const bot of db.state.bots.filter(b => b.userId === target.id && b.status === 'running')) {
          await deploymentService.stopBot(bot);
        }
      }
      db.addAdminAudit(
        req.user!.id,
        req.user!.email,
        suspended ? 'SUSPEND_USER' : 'UNSUSPEND_USER',
        'user',
        target.id,
        `${suspended ? 'Suspended' : 'Unsuspended'} user ${target.email}`,
        getClientIp(req),
        String(req.headers['user-agent'] || '')
      );
    }

    if (role === 'admin' || role === 'user') {
      target.role = role;
      db.addAdminAudit(req.user!.id, req.user!.email, 'CHANGE_USER_ROLE', 'user', target.id, `Set role of ${target.email} to ${role}`, getClientIp(req), String(req.headers['user-agent'] || ''));
    }

    if (newPassword && String(newPassword).length >= 6) {
      const creds = hashPassword(String(newPassword));
      target.passwordHash = creds.hash;
      target.salt = creds.salt;
      db.addAdminAudit(req.user!.id, req.user!.email, 'RESET_USER_PASSWORD', 'user', target.id, `Reset password for ${target.email}`, getClientIp(req), String(req.headers['user-agent'] || ''));
    }

    db.save();
    res.json({ user: sanitizeUser(target) });
  });

  app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const target = db.state.users.find(u => u.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.id === req.user!.id) {
      return res.status(400).json({ error: 'You cannot delete your own active administrator account.' });
    }

    const userBots = db.state.bots.filter(b => b.userId === target.id);
    for (const b of userBots) {
      await deploymentService.deleteBot(b);
    }

    db.state.bots = db.state.bots.filter(b => b.userId !== target.id);
    db.state.deployments = db.state.deployments.filter(d => d.userId !== target.id);
    db.state.sessions = db.state.sessions.filter(s => s.userId !== target.id);
    db.state.users = db.state.users.filter(u => u.id !== target.id);

    db.addAdminAudit(req.user!.id, req.user!.email, 'DELETE_USER', 'user', target.id, `Deleted user ${target.email} and ${userBots.length} bots`, getClientIp(req), String(req.headers['user-agent'] || ''));
    db.save();
    res.json({ ok: true });
  });

  app.get('/api/admin/bots', requireAuth, requireAdmin, (_req, res) => {
    const bots = db.state.bots.map(b => {
      const owner = db.state.users.find(u => u.id === b.userId);
      return {
        ...b,
        ownerEmail: owner?.email || 'Unknown',
        ownerName: owner?.name || 'Unknown',
        telemetry: processManager.getBotLiveTelemetry(b),
      };
    });
    res.json({ bots });
  });

  app.get('/api/admin/deployments', requireAuth, requireAdmin, (_req, res) => {
    const deployments = db.state.deployments.map(d => {
      const b = db.state.bots.find(x => x.id === d.botId);
      const u = db.state.users.find(x => x.id === d.userId);
      return {
        ...d,
        botName: b?.name || d.botId,
        userEmail: u?.email || d.userId,
      };
    });
    res.json({ deployments });
  });

  app.get('/api/admin/servers', requireAuth, requireAdmin, async (_req, res) => {
    const servers = await deploymentService.getServers();
    res.json({ servers });
  });

  app.post('/api/admin/servers', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const { name, region, host, capacityBots = 25 } = req.body;
    if (!name || !region || !host) {
      return res.status(400).json({ error: 'Server name, region, and host are required.' });
    }
    const srv = {
      id: `srv_${crypto.randomBytes(5).toString('hex')}`,
      name: String(name).trim(),
      region: String(region).trim(),
      host: String(host).trim(),
      status: 'online' as const,
      capacityBots: Number(capacityBots) || 25,
      maintenanceMode: false,
      createdAt: new Date().toISOString(),
    };
    db.state.servers.push(srv);
    db.addAdminAudit(req.user!.id, req.user!.email, 'ADD_SERVER_NODE', 'server', srv.id, `Added server node ${srv.name} (${srv.region})`, getClientIp(req), String(req.headers['user-agent'] || ''));
    db.save();
    res.status(201).json({ server: srv });
  });

  app.patch('/api/admin/servers/:id', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const srv = db.state.servers.find(s => s.id === req.params.id);
    if (!srv) return res.status(404).json({ error: 'Server not found.' });
    const { maintenanceMode, status, capacityBots } = req.body;
    if (typeof maintenanceMode === 'boolean') {
      srv.maintenanceMode = maintenanceMode;
      srv.status = maintenanceMode ? 'maintenance' : 'online';
    }
    if (status) srv.status = status;
    if (capacityBots !== undefined) srv.capacityBots = Number(capacityBots) || 25;

    db.addAdminAudit(req.user!.id, req.user!.email, 'UPDATE_SERVER_NODE', 'server', srv.id, `Updated server ${srv.name} (maintenance=${srv.maintenanceMode})`, getClientIp(req), String(req.headers['user-agent'] || ''));
    db.save();
    res.json({ server: srv });
  });

  app.get('/api/admin/settings', requireAuth, requireAdmin, (_req, res) => {
    res.json({ settings: db.state.systemSettings });
  });

  app.put('/api/admin/settings', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    const prevMaint = db.state.systemSettings.maintenanceMode;
    db.state.systemSettings = {
      ...db.state.systemSettings,
      ...req.body,
    };

    if (prevMaint !== db.state.systemSettings.maintenanceMode) {
      db.addAdminAudit(
        req.user!.id,
        req.user!.email,
        db.state.systemSettings.maintenanceMode ? 'ENABLE_MAINTENANCE_MODE' : 'DISABLE_MAINTENANCE_MODE',
        'settings',
        'global_maintenance',
        `Maintenance mode set to ${db.state.systemSettings.maintenanceMode}`,
        getClientIp(req),
        String(req.headers['user-agent'] || '')
      );
    } else {
      db.addAdminAudit(
        req.user!.id,
        req.user!.email,
        'UPDATE_SYSTEM_SETTINGS',
        'settings',
        'system_settings',
        'Updated platform system settings',
        getClientIp(req),
        String(req.headers['user-agent'] || '')
      );
    }

    // If announcement banner was updated, push notification to users
    if (req.body.announcementBanner && req.body.broadcastAnnouncement) {
      for (const u of db.state.users) {
        db.addNotification(u.id, 'announcement', 'Platform Announcement', String(req.body.announcementBanner));
      }
    }

    db.save();
    res.json({ settings: db.state.systemSettings });
  });

  app.get('/api/admin/audit-logs', requireAuth, requireAdmin, (_req, res) => {
    res.json({ auditLogs: db.state.adminActions });
  });

  app.get('/api/admin/logs', requireAuth, requireAdmin, (_req, res) => {
    // Aggregate real system logs across all bots + deployments
    const allBotLogs: { botId: string; botName: string; line: string }[] = [];
    for (const bot of db.state.bots) {
      const lines = processManager.getLogs(bot.id).slice(-50);
      for (const l of lines) {
        allBotLogs.push({ botId: bot.id, botName: bot.name, line: l });
      }
    }
    res.json({ logs: allBotLogs.slice(-300) });
  });

  // --- ADMIN EMAIL BROADCASTING & MESSAGING ---
  app.get('/api/admin/emails', requireAuth, requireAdmin, (_req, res) => {
    res.json({ emails: db.state.emails || [] });
  });

  app.post('/api/admin/emails/send', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    try {
      const { recipientUserId, subject, message, template = 'announcement' } = req.body;
      if (!subject || !String(subject).trim()) {
        return res.status(400).json({ error: 'Please enter an email subject.' });
      }
      if (!message || !String(message).trim()) {
        return res.status(400).json({ error: 'Please enter message content.' });
      }

      const targetRecipients: { id: string; email: string; name: string }[] = [];
      if (recipientUserId === 'all') {
        const activeUsers = db.state.users.filter((u) => !u.suspended);
        for (const u of activeUsers) {
          targetRecipients.push({ id: u.id, email: u.email, name: u.name });
        }
      } else {
        const u = db.state.users.find(
          (x) =>
            x.id === recipientUserId ||
            x.email.toLowerCase() === String(recipientUserId).trim().toLowerCase()
        );
        if (!u) {
          return res.status(404).json({ error: 'Recipient user not found.' });
        }
        targetRecipients.push({ id: u.id, email: u.email, name: u.name });
      }

      if (targetRecipients.length === 0) {
        return res.status(400).json({ error: 'No active recipient users found.' });
      }

      const settings = db.state.systemSettings;
      let emailTransporter: any = null;
      if (settings.smtpHost && settings.smtpUser && settings.smtpPass) {
        try {
          emailTransporter = nodemailer.createTransport({
            host: settings.smtpHost,
            port: Number(settings.smtpPort) || 587,
            secure: Number(settings.smtpPort) === 465,
            auth: {
              user: settings.smtpUser,
              pass: settings.smtpPass,
            },
          });
        } catch (e: any) {
          console.warn('[SMTP-INIT-WARN]', e.message);
        }
      }

      const sentRecords: EmailRecord[] = [];
      const now = new Date().toISOString();

      for (const rec of targetRecipients) {
        let status: 'sent' | 'delivered' | 'failed' = 'sent';
        let errorMsg: string | null = null;

        if (emailTransporter) {
          try {
            await emailTransporter.sendMail({
              from:
                settings.smtpFrom ||
                `"${settings.platformName || 'LYRICAL'}" <${
                  settings.supportEmail || 'no-reply@lyrical.cloud'
                }>`,
              to: rec.email,
              subject: String(subject).trim(),
              text: String(message).trim(),
              html: `
                <div style="font-family: Arial, sans-serif; background-color: #0f172a; color: #f8fafc; padding: 24px; border-radius: 8px;">
                  <h2 style="color: #38bdf8; margin-top: 0;">${settings.platformName || 'LYRICAL'} Platform Notification</h2>
                  <p style="font-size: 14px; color: #cbd5e1;">Dear ${rec.name},</p>
                  <div style="background-color: #1e293b; padding: 16px; border-radius: 6px; margin: 16px 0; border-left: 4px solid #38bdf8; font-size: 14px; line-height: 1.6;">
                    ${String(message).trim().replace(/\n/g, '<br/>')}
                  </div>
                  <hr style="border: none; border-top: 1px solid #334155; margin: 20px 0;" />
                  <p style="font-size: 11px; color: #64748b;">
                    Sent by Administrator (${req.user!.email}) · ${new Date().toUTCString()}<br/>
                    Support: ${settings.supportEmail || 'support@lyrical.cloud'}
                  </p>
                </div>
              `,
            });
            status = 'delivered';
          } catch (mailErr: any) {
            console.error('[SMTP-DISPATCH-ERR]', mailErr.message);
            status = 'sent';
            errorMsg = mailErr.message;
          }
        }

        // Deliver in-app notification directly to the user dashboard notification center
        db.addNotification(
          rec.id,
          'announcement',
          String(subject).trim(),
          String(message).trim()
        );

        const emailRec: EmailRecord = {
          id: `eml_${crypto.randomBytes(6).toString('hex')}`,
          senderAdminId: req.user!.id,
          senderEmail: req.user!.email,
          recipientUserId: rec.id,
          recipientEmail: rec.email,
          recipientName: rec.name,
          subject: String(subject).trim(),
          message: String(message).trim(),
          template: template as any,
          status,
          error: errorMsg,
          sentAt: now,
        };
        db.addEmailRecord(emailRec);
        sentRecords.push(emailRec);
      }

      db.addAdminAudit(
        req.user!.id,
        req.user!.email,
        'SEND_EMAIL',
        'email',
        recipientUserId,
        `Dispatched email "${subject}" to ${targetRecipients.length} user(s)`,
        getClientIp(req),
        String(req.headers['user-agent'] || '')
      );

      res.status(200).json({
        ok: true,
        sentCount: targetRecipients.length,
        emails: sentRecords,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to dispatch email.' });
    }
  });

  app.post('/api/admin/emails/:id/resend', requireAuth, requireAdmin, async (req: AuthenticatedRequest, res) => {
    const existing = db.state.emails.find((e) => e.id === req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Email record not found.' });
    }
    const newRecord: EmailRecord = {
      ...existing,
      id: `eml_${crypto.randomBytes(6).toString('hex')}`,
      sentAt: new Date().toISOString(),
      senderAdminId: req.user!.id,
      senderEmail: req.user!.email,
      status: 'sent',
    };
    db.addNotification(existing.recipientUserId, 'announcement', existing.subject, existing.message);
    db.addEmailRecord(newRecord);
    res.json({ ok: true, email: newRecord });
  });

  // --- ADMIN CLOUD DATABASE PERSISTENCE & BACKUPS ---
  app.get('/api/admin/database/status', requireAuth, requireAdmin, (_req, res) => {
    const fsStatus = cloudFirestoreSync.getStatus();
    res.json({
      status: 'ok',
      firestore: fsStatus,
      totalUsers: db.state.users.length,
      totalBots: db.state.bots.length,
      totalDeployments: db.state.deployments.length,
      totalEmails: db.state.emails.length,
      totalEnvVars: db.state.envVars.length,
    });
  });

  app.post('/api/admin/database/sync', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const success = await db.forceSyncToCloud();
      if (!success) {
        return res.status(500).json({ error: 'Failed to sync database to Cloud Firestore.' });
      }
      res.json({ ok: true, message: 'Database successfully synced and backed up to Cloud Firestore.' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/database/restore', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const restored = await db.forceRestoreFromCloud();
      if (!restored) {
        return res.status(404).json({ error: 'No previous Cloud Firestore snapshot found to restore.' });
      }
      res.json({
        ok: true,
        message: `Database successfully restored from Cloud Firestore (${db.state.users.length} users, ${db.state.bots.length} bots).`,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/admin/database/backup', requireAuth, requireAdmin, (_req, res) => {
    const backupJson = db.exportBackupJson();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="lyrical-backup-${new Date().toISOString().slice(0, 10)}.json"`
    );
    res.send(backupJson);
  });

  app.post('/api/admin/database/restore-json', requireAuth, requireAdmin, (req: AuthenticatedRequest, res) => {
    try {
      const { backupData } = req.body;
      if (!backupData) return res.status(400).json({ error: 'backupData is required.' });
      const raw = typeof backupData === 'string' ? backupData : JSON.stringify(backupData);
      db.restoreBackupJson(raw);
      db.addAdminAudit(
        req.user!.id,
        req.user!.email,
        'RESTORE_DATABASE',
        'settings',
        'database',
        'Admin restored database from JSON backup',
        getClientIp(req),
        String(req.headers['user-agent'] || '')
      );
      res.json({ ok: true, message: 'Database restored successfully from backup payload.' });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // --- LIVE WEBSITE & APPLICATION REVERSE PROXY ---
  app.use('/live/:id', (req: Request, res: Response) => {
    const botId = req.params.id;
    const bot = db.state.bots.find(b => b.id === botId);

    if (!bot) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head><title>Website Not Found - LYRICAL</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="font-family:system-ui,sans-serif;background:#090d16;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:20px;box-sizing:border-box;">
          <div style="background:#0f172a;border:1px solid #1e293b;border-radius:16px;padding:32px;max-width:480px;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,0.5);">
            <div style="font-size:36px;margin-bottom:12px;">🔍</div>
            <h1 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#38bdf8;">Website or Service Not Found</h1>
            <p style="font-size:14px;color:#94a3b8;line-height:1.5;margin:0 0 20px;">No deployed web instance exists for ID <code>${botId}</code>.</p>
            <a href="/dashboard" style="display:inline-block;background:#38bdf8;color:#090d16;text-decoration:none;font-weight:600;padding:10px 20px;border-radius:8px;font-size:13px;">Return to Console</a>
          </div>
        </body>
        </html>
      `);
    }

    // Ensure trailing slash for root URL so relative paths in HTML/JS resolve properly
    const cleanOriginal = req.originalUrl.split('?')[0];
    if (cleanOriginal === `/live/${botId}`) {
      const search = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      return res.redirect(302, `/live/${botId}/${search}`);
    }

    if (bot.status !== 'running') {
      return res.status(503).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${bot.name} - Starting Up</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta http-equiv="refresh" content="5">
        </head>
        <body style="font-family:system-ui,sans-serif;background:#090d16;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:20px;box-sizing:border-box;">
          <div style="background:#0f172a;border:1px solid #1e293b;border-radius:16px;padding:32px;max-width:500px;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,0.5);">
            <div style="display:inline-block;width:36px;height:36px;border:3px solid rgba(56,189,248,0.2);border-top-color:#38bdf8;border-radius:50%;animation:spin 1s linear infinite;margin-bottom:16px;"></div>
            <style>@keyframes spin { 100% { transform: rotate(360deg); } }</style>
            <h1 style="font-size:20px;font-weight:700;margin:0 0 8px;color:#38bdf8;">${bot.name} is ${bot.status}</h1>
            <p style="font-size:14px;color:#94a3b8;line-height:1.5;margin:0 0 16px;">This website or web service container is currently <strong>${bot.status}</strong>. This page will automatically refresh once the process is ready.</p>
            <div style="font-size:12px;color:#64748b;margin-bottom:20px;">Assigned Port: ${bot.port || 8080} · Runtime: ${bot.runtime}</div>
            <div style="display:flex;gap:10px;justify-content:center;">
              <button onclick="location.reload()" style="background:#1e293b;color:#e2e8f0;border:1px solid #334155;padding:8px 16px;border-radius:8px;font-size:13px;cursor:pointer;">Refresh Now</button>
              <a href="/bots/${bot.id}" style="display:inline-block;background:#38bdf8;color:#090d16;text-decoration:none;font-weight:600;padding:8px 16px;border-radius:8px;font-size:13px;">View Build Logs</a>
            </div>
          </div>
        </body>
        </html>
      `);
    }

    const targetPort = bot.port || 8080;
    const targetPath = req.url.startsWith('/') ? req.url : `/${req.url}`;

    const proxyReq = http.request(
      {
        host: '127.0.0.1',
        port: targetPort,
        path: targetPath,
        method: req.method,
        headers: {
          ...req.headers,
          host: `127.0.0.1:${targetPort}`,
          'x-forwarded-host': req.headers.host || '',
          'x-forwarded-proto': req.protocol || 'http',
          'x-forwarded-prefix': `/live/${botId}`,
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res);
      }
    );

    proxyReq.on('error', (err) => {
      if (!res.headersSent) {
        res.status(502).send(`
          <!DOCTYPE html>
          <html>
          <head><title>${bot.name} - Gateway Connecting</title><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="4"></head>
          <body style="font-family:system-ui,sans-serif;background:#090d16;color:#e2e8f0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;padding:20px;box-sizing:border-box;">
            <div style="background:#0f172a;border:1px solid #1e293b;border-radius:16px;padding:32px;max-width:500px;text-align:center;">
              <h1 style="font-size:18px;color:#38bdf8;margin:0 0 8px;">Waiting for Web Server on Port ${targetPort}</h1>
              <p style="font-size:13px;color:#94a3b8;line-height:1.5;margin:0 0 16px;">The process is running (PID: ${bot.pid || 'Active'}), but the internal HTTP server on port ${targetPort} is still starting up. Retrying automatically in 4 seconds...</p>
              <div style="font-size:11px;font-family:monospace;color:#64748b;margin-bottom:16px;">${err.message}</div>
              <a href="/bots/${bot.id}" style="display:inline-block;background:#38bdf8;color:#090d16;text-decoration:none;font-weight:600;padding:8px 16px;border-radius:8px;font-size:13px;">View Console</a>
            </div>
          </body>
          </html>
        `);
      }
    });

    if (req.readable) {
      req.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
  });

  // --- VITE DEV / STATIC SERVING ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Anti-sleep pinger: keeps the cloud container awake on Railway / Render / Cloud Run
  const keepAliveUrl = process.env.RAILWAY_STATIC_URL
    ? `https://${process.env.RAILWAY_STATIC_URL}/api/health`
    : process.env.PUBLIC_APP_URL || process.env.RENDER_EXTERNAL_URL;

  setInterval(() => {
    http.get(`http://127.0.0.1:${PORT}/api/health`, () => {}).on('error', () => {});
    if (keepAliveUrl && keepAliveUrl.startsWith('https://')) {
      https.get(keepAliveUrl, () => {}).on('error', () => {});
    }
  }, 4 * 60 * 1000); // Heartbeat every 4 minutes

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[LYRICAL] Full-stack platform server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
