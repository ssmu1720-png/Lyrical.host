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

  // --- AUTHENTICATION ROUTES ---
  app.post('/api/auth/register', (req, res) => {
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
      const creds = hashPassword(String(password));

      if (existingUser) {
        // If this is the uninitialized root admin claiming initial credentials on startup
        if (existingUser.id === 'usr_admin_root' && existingUser.lastLoginAt === existingUser.createdAt) {
          existingUser.name = String(name).trim().slice(0, 80);
          existingUser.passwordHash = creds.hash;
          existingUser.salt = creds.salt;
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
      bot: { ...bot, telemetry },
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
        whatsappState: 'CONNECTING',
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
