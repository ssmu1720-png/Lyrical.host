import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { cloudFirestoreSync } from './cloudFirestoreSync.ts';

function resolveDataDirectory(): string {
  const envDir = process.env.DATA_DIR;
  if (envDir && fs.existsSync(envDir)) return envDir;
  if (fs.existsSync('/railway/data')) return '/railway/data';
  const localData = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(localData)) {
    try {
      fs.mkdirSync(localData, { recursive: true });
    } catch {}
  }
  return localData;
}

const DATA_DIR = resolveDataDirectory();
const DB_PATH = path.join(DATA_DIR, 'lyrical-db.json');

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  salt: string;
  role: 'user' | 'admin';
  suspended: boolean;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  githubToken?: string;
  githubUsername?: string;
  githubAvatarUrl?: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  token: string;
  ip: string;
  userAgent: string;
  expiresAt: string;
  createdAt: string;
}

export interface BotRecord {
  id: string;
  userId: string;
  name: string;
  description: string;
  runtime: 'nodejs' | 'python';
  repoUrl: string;
  branch: string;
  startCommand: string;
  buildCommand: string;
  port: number;
  region: string;
  serverId: string;
  containerId: string | null;
  status: 'running' | 'stopped' | 'deploying' | 'failed';
  whatsappAuthMethod: 'pairing_code' | 'qr_code';
  whatsappPhone: string;
  whatsappState: 'CONNECTED' | 'CONNECTING' | 'DISCONNECTED' | 'AUTHENTICATION REQUIRED' | 'ERROR';
  whatsappQr: string | null;
  whatsappPairingCode: string | null;
  pid: number | null;
  startedAt: string | null;
  lastRestartAt: string | null;
  autoRestart?: boolean;
  restartCount?: number;
  category?: 'whatsapp_bot' | 'website' | 'web_service';
  createdAt: string;
  updatedAt: string;
}

export interface EnvVarRecord {
  id: string;
  botId: string;
  key: string;
  value: string;
}

export interface DeploymentRecord {
  id: string;
  botId: string;
  userId: string;
  status: 'pending' | 'building' | 'running' | 'success' | 'failed';
  commitHash: string | null;
  startTime: string;
  endTime: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  logs: string[];
}

export interface ServerRecord {
  id: string;
  name: string;
  region: string;
  host: string;
  status: 'online' | 'maintenance' | 'offline';
  capacityBots: number;
  maintenanceMode: boolean;
  createdAt: string;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  type: 'deployment_started' | 'deployment_success' | 'deployment_failed' | 'bot_started' | 'bot_stopped' | 'bot_crashed' | 'whatsapp_disconnected' | 'server_problem' | 'announcement';
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface AdminActionRecord {
  id: string;
  adminId: string;
  adminEmail: string;
  action: string;
  targetType: 'user' | 'bot' | 'server' | 'settings' | 'auth' | 'deployment' | 'email';
  targetId: string;
  details: string;
  ip: string;
  userAgent: string;
  timestamp: string;
}

export interface EmailRecord {
  id: string;
  senderAdminId: string;
  senderEmail: string;
  recipientUserId: string; // 'all' or specific user id
  recipientEmail: string;
  recipientName: string;
  subject: string;
  message: string;
  template: 'announcement' | 'warning' | 'account' | 'custom';
  status: 'sent' | 'delivered' | 'queued' | 'failed';
  error?: string | null;
  sentAt: string;
}

export interface SystemSettingsRecord {
  platformName: string;
  logoText: string;
  defaultTheme: 'dark' | 'light';
  registrationEnabled: boolean;
  maintenanceMode: boolean;
  maintenanceMessage: string;
  maintenanceReturnTime: string;
  maxBotsPerUser: number;
  maxConcurrentDeployments: number;
  announcementBanner: string;
  supportEmail: string;
  supportDocsUrl: string;
  deploymentApiUrl: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpFrom?: string;
  platformDomain?: string;
  requireSignupOtp?: boolean;
  githubClientId?: string;
  githubClientSecret?: string;
}

export interface DatabaseSchema {
  users: UserRecord[];
  sessions: SessionRecord[];
  bots: BotRecord[];
  envVars: EnvVarRecord[];
  deployments: DeploymentRecord[];
  servers: ServerRecord[];
  notifications: NotificationRecord[];
  adminActions: AdminActionRecord[];
  systemSettings: SystemSettingsRecord;
  emails: EmailRecord[];
}

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, actualSalt, 64).toString('hex');
  return { hash, salt: actualSalt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const computed = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
}

function getInitialDatabase(): DatabaseSchema {
  const adminCreds = hashPassword(process.env.ADMIN_SECRET || 'LyricalAdmin2026!');
  const now = new Date().toISOString();

  return {
    users: [
      {
        id: 'usr_admin_root',
        email: 'ssmu1720@gmail.com',
        name: 'System Administrator',
        passwordHash: adminCreds.hash,
        salt: adminCreds.salt,
        role: 'admin',
        suspended: false,
        emailVerified: true,
        createdAt: now,
        lastLoginAt: now,
      },
      {
        id: 'usr_admin_fallback',
        email: 'admin@lyrical.cloud',
        name: 'LYRICAL Root Admin',
        passwordHash: adminCreds.hash,
        salt: adminCreds.salt,
        role: 'admin',
        suspended: false,
        emailVerified: true,
        createdAt: now,
        lastLoginAt: null,
      }
    ],
    sessions: [],
    bots: [],
    envVars: [],
    deployments: [],
    servers: [
      {
        id: 'srv_local_primary',
        name: 'LYRICAL-CORE-01 (Primary Runtime)',
        region: 'eu-west-2 (London)',
        host: '127.0.0.1 (Local Host Node)',
        status: 'online',
        capacityBots: 25,
        maintenanceMode: false,
        createdAt: now,
      }
    ],
    notifications: [],
    adminActions: [],
    emails: [],
    systemSettings: {
      platformName: 'LYRICAL',
      logoText: 'LYRICAL',
      defaultTheme: 'dark',
      registrationEnabled: true,
      maintenanceMode: false,
      maintenanceMessage: 'LYRICAL is currently undergoing scheduled infrastructure upgrades. Active WhatsApp bot containers remain online.',
      maintenanceReturnTime: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
      maxBotsPerUser: 10,
      maxConcurrentDeployments: 5,
      announcementBanner: '',
      supportEmail: 'support@lyrical.cloud',
      supportDocsUrl: 'https://baileys.whiskeysockets.io',
      deploymentApiUrl: process.env.DEPLOYMENT_API_URL || '',
      platformDomain: 'lyrical.cloud',
      requireSignupOtp: true,
    }
  };
}

class DatabaseManager {
  private data: DatabaseSchema;
  private cloudSyncTimer: NodeJS.Timeout | null = null;
  private saveDebounceTimer: NodeJS.Timeout | null = null;

  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      } catch {}
    }
    if (fs.existsSync(DB_PATH)) {
      try {
        const raw = fs.readFileSync(DB_PATH, 'utf-8');
        this.data = JSON.parse(raw);
        // Ensure schema completeness on upgrade
        const init = getInitialDatabase();
        this.data.systemSettings = { ...init.systemSettings, ...this.data.systemSettings };
        if (!this.data.servers || this.data.servers.length === 0) {
          this.data.servers = init.servers;
        }
        if (!this.data.emails) {
          this.data.emails = [];
        }
      } catch {
        this.data = getInitialDatabase();
        this.save();
      }
    } else {
      this.data = getInitialDatabase();
      this.save();
    }

    // Immediately trigger asynchronous cloud restoration from Cloud Firestore
    this.hydrateFromCloudFirestore();

    // Start 60-second periodic background cloud sync to ensure zero data loss
    this.cloudSyncTimer = setInterval(() => {
      cloudFirestoreSync.saveToFirestore(this.data).catch(() => {});
    }, 60 * 1000);
    if (this.cloudSyncTimer.unref) {
      this.cloudSyncTimer.unref();
    }
  }

  /**
   * Hydrates database from Cloud Firestore to survive container redeployments and restarts
   */
  public async hydrateFromCloudFirestore(): Promise<boolean> {
    try {
      const cloudData = await cloudFirestoreSync.loadFromFirestore();
      if (!cloudData) return false;

      // Merge users: keep all cloud users and local users without duplicates
      const localUsers = this.data.users || [];
      const cloudUsers = cloudData.users || [];
      const mergedUsersMap = new Map<string, UserRecord>();

      for (const u of cloudUsers) {
        mergedUsersMap.set(u.email.toLowerCase(), u);
      }
      for (const u of localUsers) {
        if (!mergedUsersMap.has(u.email.toLowerCase())) {
          mergedUsersMap.set(u.email.toLowerCase(), u);
        }
      }
      this.data.users = Array.from(mergedUsersMap.values());

      // Merge bots
      const localBots = this.data.bots || [];
      const cloudBots = cloudData.bots || [];
      const mergedBotsMap = new Map<string, BotRecord>();
      for (const b of cloudBots) {
        mergedBotsMap.set(b.id, b);
      }
      for (const b of localBots) {
        if (!mergedBotsMap.has(b.id)) {
          mergedBotsMap.set(b.id, b);
        }
      }
      this.data.bots = Array.from(mergedBotsMap.values());

      // Merge envVars
      const localEnv = this.data.envVars || [];
      const cloudEnv = cloudData.envVars || [];
      const envKey = (e: EnvVarRecord) => `${e.botId}_${e.key}`;
      const mergedEnvMap = new Map<string, EnvVarRecord>();
      for (const e of cloudEnv) {
        mergedEnvMap.set(envKey(e), e);
      }
      for (const e of localEnv) {
        if (!mergedEnvMap.has(envKey(e))) {
          mergedEnvMap.set(envKey(e), e);
        }
      }
      this.data.envVars = Array.from(mergedEnvMap.values());

      // Deployments, emails, notifications
      if (cloudData.deployments && cloudData.deployments.length > (this.data.deployments?.length || 0)) {
        this.data.deployments = cloudData.deployments;
      }
      if (cloudData.emails && cloudData.emails.length > (this.data.emails?.length || 0)) {
        this.data.emails = cloudData.emails;
      }
      if (cloudData.notifications && cloudData.notifications.length > (this.data.notifications?.length || 0)) {
        this.data.notifications = cloudData.notifications;
      }

      // Persist merged unified state to local file
      this.saveLocal();
      console.log(
        `[LYRICAL-DB] Successfully hydrated persistent records: ${this.data.users.length} users, ${this.data.bots.length} bots, ${this.data.deployments.length} deployments.`
      );
      return true;
    } catch (err: any) {
      console.warn('[LYRICAL-DB] Cloud hydration warning:', err.message);
      return false;
    }
  }

  public get state(): DatabaseSchema {
    return this.data;
  }

  private saveLocal(): void {
    try {
      const tmpPath = `${DB_PATH}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmpPath, DB_PATH);
    } catch (err) {
      console.error('Failed to persist local database file:', err);
    }
  }

  public save(): void {
    this.saveLocal();

    // Debounce cloud push to avoid spamming the network while ensuring fast persistence
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = setTimeout(() => {
      cloudFirestoreSync.saveToFirestore(this.data).catch(() => {});
    }, 1500);
  }

  public async forceSyncToCloud(): Promise<boolean> {
    this.saveLocal();
    const ok = await cloudFirestoreSync.saveToFirestore(this.data);
    await cloudFirestoreSync.saveHistoricalSnapshot(this.data);
    return ok;
  }

  public async forceRestoreFromCloud(): Promise<boolean> {
    return await this.hydrateFromCloudFirestore();
  }

  public exportBackupJson(): string {
    return JSON.stringify(this.data, null, 2);
  }

  public restoreBackupJson(rawJson: string): boolean {
    try {
      const parsed: DatabaseSchema = JSON.parse(rawJson);
      if (!parsed.users || !Array.isArray(parsed.users)) {
        throw new Error('Invalid database backup format: missing users array.');
      }
      this.data = parsed;
      this.save();
      return true;
    } catch (err: any) {
      throw new Error(`Backup restore failed: ${err.message}`);
    }
  }

  public addEmailRecord(email: EmailRecord): EmailRecord {
    this.data.emails.unshift(email);
    if (this.data.emails.length > 500) {
      this.data.emails = this.data.emails.slice(0, 500);
    }
    this.save();
    return email;
  }

  public addNotification(userId: string, type: NotificationRecord['type'], title: string, message: string): NotificationRecord {
    const notif: NotificationRecord = {
      id: `ntf_${crypto.randomBytes(6).toString('hex')}`,
      userId,
      type,
      title,
      message,
      read: false,
      createdAt: new Date().toISOString(),
    };
    this.data.notifications.unshift(notif);
    if (this.data.notifications.length > 500) {
      this.data.notifications = this.data.notifications.slice(0, 500);
    }
    this.save();
    return notif;
  }

  public addAdminAudit(
    adminId: string,
    adminEmail: string,
    action: string,
    targetType: AdminActionRecord['targetType'],
    targetId: string,
    details: string,
    ip: string,
    userAgent: string
  ): AdminActionRecord {
    const record: AdminActionRecord = {
      id: `aud_${crypto.randomBytes(6).toString('hex')}`,
      adminId,
      adminEmail,
      action,
      targetType,
      targetId,
      details,
      ip,
      userAgent,
      timestamp: new Date().toISOString(),
    };
    this.data.adminActions.unshift(record);
    if (this.data.adminActions.length > 1000) {
      this.data.adminActions = this.data.adminActions.slice(0, 1000);
    }
    this.save();
    return record;
  }
}

export const db = new DatabaseManager();
