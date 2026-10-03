export interface User {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  suspended: boolean;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface BotTelemetry {
  online: boolean;
  pid: number | null;
  uptimeSeconds: number;
  cpuPercent: number;
  ramMb: number;
  storageMb: number;
  rxBytes: number;
  txBytes: number;
}

export interface Bot {
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
  liveUrl?: string;
  createdAt: string;
  updatedAt: string;
  ownerEmail?: string;
  ownerName?: string;
  telemetry?: BotTelemetry;
}

export interface Deployment {
  id: string;
  botId: string;
  botName?: string;
  userId: string;
  userEmail?: string;
  status: 'pending' | 'building' | 'running' | 'success' | 'failed';
  commitHash: string | null;
  startTime: string;
  endTime: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  logs: string[];
}

export interface NotificationItem {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

const SESSION_TOKEN_KEY = 'lyrical_session_token';

export function getStoredSessionToken(): string | null {
  return localStorage.getItem(SESSION_TOKEN_KEY);
}

export function setStoredSessionToken(token: string | null): void {
  if (token) {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(SESSION_TOKEN_KEY);
  }
}

export async function apiRequest<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredSessionToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error(data.error || 'Request could not be completed. Please try again.');
    err.status = res.status;
    err.details = data.details || null;
    err.maintenanceMode = Boolean(data.maintenanceMode);
    err.maintenanceReturnTime = data.maintenanceReturnTime || null;
    throw err;
  }
  return data as T;
}

export function formatUptime(seconds: number): string {
  if (!seconds || seconds <= 0) return '0s';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
