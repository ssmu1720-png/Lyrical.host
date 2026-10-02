import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA_DIR = path.resolve(process.cwd(), 'data');
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
  targetType: 'user' | 'bot' | 'server' | 'settings' | 'auth' | 'deployment';
  targetId: string;
  details: string;
  ip: string;
  userAgent: string;
  timestamp: string;
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
    }
  };
}

class DatabaseManager {
  private data: DatabaseSchema;

  constructor() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
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
      } catch {
        this.data = getInitialDatabase();
        this.save();
      }
    } else {
      this.data = getInitialDatabase();
      this.save();
    }
  }

  public get state(): DatabaseSchema {
    return this.data;
  }

  public save(): void {
    try {
      const tmpPath = `${DB_PATH}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmpPath, DB_PATH);
    } catch (err) {
      console.error('Failed to persist database:', err);
    }
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
