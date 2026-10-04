import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Rocket,
  Play,
  Square,
  RotateCw,
  Trash2,
  Terminal,
  Search,
  AlertTriangle,
  Cloud as FolderCloud,
  Globe,
  ExternalLink,
} from 'lucide-react';
import { apiRequest, Bot, Deployment, NotificationItem, formatUptime } from '../lib/api';
import { GoogleDriveModal } from '../components/GoogleDriveModal';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [bots, setBots] = useState<Bot[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [hostMetrics, setHostMetrics] = useState<any>(null);
  const [driveOpen, setDriveOpen] = useState(false);

  const fetchDashboard = async () => {
    try {
      const data = await apiRequest('/api/dashboard');
      setStats(data.stats);
      setBots(data.bots || []);
      setDeployments(data.recentDeployments || []);
      setNotifications(data.notifications || []);
      setHostMetrics(data.hostMetrics);
    } catch {
      // handled globally or retry
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !stats) {
    return (
      <div className="space-y-6">
        <div className="h-20 rounded-xl bg-slate-900/60 border border-slate-800 animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-24 rounded-xl bg-slate-900/60 border border-slate-800 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Hero / Focal Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
            Bot Operations Center
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Real-time Linux container telemetry, WhatsApp session monitoring, and Google Drive workspace sync
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setDriveOpen(true)}
            className="px-4 py-2.5 text-xs font-medium rounded-lg border border-slate-800 bg-slate-900/80 text-slate-200 hover:border-cyan-500/40 transition-colors flex items-center gap-2 whitespace-nowrap"
          >
            <FolderCloud className="w-4 h-4 text-cyan-400" />
            Google Drive Files
          </button>

          <button
            type="button"
            onClick={() => navigate('/deploy')}
            className="px-5 py-2.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 hover:from-cyan-400 hover:to-blue-500 transition-all flex items-center gap-2 shadow-sm whitespace-nowrap"
          >
            <Rocket className="w-4 h-4" />
            Deploy New Bot
          </button>
        </div>
      </div>

      {/* Primary Telemetry Grid (Single-Elevation, Tabular Numerals) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50">
          <div className="text-xs text-slate-400">Total Bots</div>
          <div className="text-2xl font-bold font-mono tabular-nums mt-2 text-white">
            {stats?.totalBots ?? 0}{' '}
            <span className="text-xs font-normal text-slate-500">
              / {stats?.maxBotsAllowed ?? 10}
            </span>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Running: {stats?.runningBots ?? 0} · Stopped: {stats?.stoppedBots ?? 0}
          </div>
        </div>

        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50">
          <div className="text-xs text-slate-400">Active Bot CPU Load</div>
          <div className="text-2xl font-bold font-mono tabular-nums mt-2 text-cyan-400">
            {stats?.cpuUsagePercent ?? 0}%
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Host Load: {hostMetrics?.cpuUsagePercent ?? 0}% ({hostMetrics?.cpuCores ?? 1} vCPU)
          </div>
        </div>

        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50">
          <div className="text-xs text-slate-400">Memory Allocation (RSS)</div>
          <div className="text-2xl font-bold font-mono tabular-nums mt-2 text-blue-400">
            {stats?.ramUsageMb ?? 0} MB
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Storage Used: {stats?.storageUsageMb ?? 0} MB
          </div>
        </div>

        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50">
          <div className="text-xs text-slate-400">Node Uptime & Failures</div>
          <div className="text-2xl font-bold font-mono tabular-nums mt-2 text-emerald-400">
            {formatUptime(stats?.hostUptimeSeconds ?? 0)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Failed Deployments: {stats?.failedDeployments ?? 0}
          </div>
        </div>
      </div>

      {/* Active Bot Instances Table */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Active Bot Instances</h2>
          <Link to="/bots" className="text-xs text-cyan-400 hover:underline">
            View all bots →
          </Link>
        </div>

        {bots.length === 0 ? (
          <div className="p-10 rounded-xl border border-slate-800 bg-slate-900/40 text-center space-y-4">
            <div className="text-base font-semibold">No WhatsApp bots deployed yet</div>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Deploy a Node.js or Python WhatsApp bot from a GitHub repository, Google Drive script, or LYRICAL's built-in multi-device engine.
            </p>
            <button
              type="button"
              onClick={() => navigate('/deploy')}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors"
            >
              Launch First Bot
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/50">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] text-slate-400 font-medium">
                  <th className="py-3 px-4">Bot Name</th>
                  <th className="py-3 px-4">Process Status</th>
                  <th className="py-3 px-4">WhatsApp Session</th>
                  <th className="py-3 px-4 text-right">PID / Uptime</th>
                  <th className="py-3 px-4 text-right">CPU / RAM</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 text-xs">
                {bots.map((bot) => (
                  <tr key={bot.id} className="hover:bg-slate-900/80 transition-colors">
                    <td className="py-3.5 px-4">
                      <Link
                        to={`/bots/${bot.id}`}
                        className="font-semibold text-white hover:text-cyan-400 transition-colors"
                      >
                        {bot.name}
                      </Link>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {bot.runtime.toUpperCase()} · {bot.region}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono">
                      <span
                        className={
                          bot.status === 'running'
                            ? 'text-emerald-400'
                            : bot.status === 'deploying'
                            ? 'text-cyan-400'
                            : bot.status === 'failed'
                            ? 'text-rose-400'
                            : 'text-slate-400'
                        }
                      >
                        {bot.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono">
                      <span
                        className={
                          bot.whatsappState === 'CONNECTED'
                            ? 'text-emerald-400'
                            : bot.whatsappState === 'AUTHENTICATION REQUIRED'
                            ? 'text-amber-400'
                            : 'text-slate-400'
                        }
                      >
                        {bot.whatsappState}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-300">
                      {bot.telemetry?.pid ? `PID ${bot.telemetry.pid}` : '—'} ·{' '}
                      {formatUptime(bot.telemetry?.uptimeSeconds || 0)}
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-300">
                      {bot.telemetry?.cpuPercent ?? 0}% · {bot.telemetry?.ramMb ?? 0} MB
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          to={`/bots/${bot.id}`}
                          className="px-2.5 py-1 rounded-md border border-slate-700 text-slate-200 hover:border-cyan-500/50 hover:text-cyan-300 transition-colors whitespace-nowrap"
                        >
                          Manage
                        </Link>
                        <Link
                          to={`/bots/${bot.id}/logs`}
                          className="px-2.5 py-1 rounded-md border border-slate-800 text-slate-400 hover:text-white transition-colors whitespace-nowrap"
                        >
                          Logs
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Deployments & Activity Split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <h2 className="text-base font-semibold">Recent Deployments</h2>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 divide-y divide-slate-800">
            {deployments.length === 0 ? (
              <div className="p-6 text-xs text-slate-500 text-center">
                No deployments recorded yet.
              </div>
            ) : (
              deployments.slice(0, 5).map((dep) => (
                <div key={dep.id} className="p-4 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <Link
                      to={`/bots/${dep.botId}`}
                      className="font-medium text-slate-200 hover:text-cyan-400"
                    >
                      {dep.botName || dep.botId}
                    </Link>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                      {dep.id} · {new Date(dep.startTime).toLocaleTimeString()}
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <span
                      className={
                        dep.status === 'success'
                          ? 'text-emerald-400'
                          : dep.status === 'failed'
                          ? 'text-rose-400'
                          : 'text-cyan-400'
                      }
                    >
                      {dep.status.toUpperCase()}
                    </span>
                    {dep.durationMs !== null && (
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {(dep.durationMs / 1000).toFixed(1)}s
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Recent Activity & Alerts</h2>
            <Link to="/notifications" className="text-xs text-cyan-400 hover:underline">
              All notifications →
            </Link>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 divide-y divide-slate-800">
            {notifications.length === 0 ? (
              <div className="p-6 text-xs text-slate-500 text-center">No recent alerts.</div>
            ) : (
              notifications.slice(0, 5).map((n) => (
                <div key={n.id} className="p-4 space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200">{n.title}</span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {new Date(n.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-slate-400">{n.message}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <GoogleDriveModal isOpen={driveOpen} onClose={() => setDriveOpen(false)} />
    </div>
  );
};

export const BotsListPage: React.FC = () => {
  const navigate = useNavigate();
  const [bots, setBots] = useState<Bot[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'stopped' | 'failed'>('all');
  const [botToDelete, setBotToDelete] = useState<Bot | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const loadBots = async () => {
    try {
      const res = await apiRequest<{ bots: Bot[] }>('/api/bots');
      setBots(res.bots || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBots();
    const interval = setInterval(loadBots, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleLifecycle = async (botId: string, action: 'start' | 'stop' | 'restart') => {
    setActionBusy(`${botId}:${action}`);
    try {
      await apiRequest(`/api/bots/${botId}/${action}`, { method: 'POST' });
      await loadBots();
    } finally {
      setActionBusy(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!botToDelete) return;
    const target = botToDelete;
    setBotToDelete(null);
    setActionBusy(`${target.id}:delete`);
    try {
      await apiRequest(`/api/bots/${target.id}`, { method: 'DELETE' });
      await loadBots();
    } finally {
      setActionBusy(null);
    }
  };

  const filtered = bots.filter((b) => {
    const matchesSearch =
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      b.id.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || b.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold">My WhatsApp Bots</h1>
          <p className="text-xs text-slate-400 mt-1">
            Manage container processes, inspect real-time logs, and configure WhatsApp pairing
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/deploy')}
          className="px-4 py-2 text-xs font-semibold rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 hover:from-cyan-400 hover:to-blue-500 transition-all flex items-center gap-2 self-start sm:self-auto"
        >
          <Rocket className="w-4 h-4" />
          Deploy New Bot
        </button>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search bots by name or ID..."
            className="w-full pl-9 pr-4 py-2 text-xs bg-slate-900 border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg self-start">
          {(['all', 'running', 'stopped', 'failed'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize whitespace-nowrap ${
                statusFilter === st
                  ? 'bg-cyan-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-xs text-slate-400">Loading bot instances...</div>
      ) : filtered.length === 0 ? (
        <div className="p-12 rounded-xl border border-slate-800 bg-slate-900/40 text-center space-y-3">
          <div className="text-sm font-semibold">No matching bots found</div>
          <p className="text-xs text-slate-500">
            Deploy a new WhatsApp bot or adjust your search filters.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((bot) => (
            <div
              key={bot.id}
              className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-slate-700 transition-colors flex flex-col justify-between gap-4"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <Link
                      to={`/bots/${bot.id}`}
                      className="text-base font-bold text-white hover:text-cyan-400 transition-colors"
                    >
                      {bot.name}
                    </Link>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {bot.runtime.toUpperCase()} · {bot.region} · Port {bot.port}
                    </div>
                  </div>
                  <span
                    className={`text-xs font-mono font-semibold ${
                      bot.status === 'running'
                        ? 'text-emerald-400'
                        : bot.status === 'deploying'
                        ? 'text-cyan-400'
                        : bot.status === 'failed'
                        ? 'text-rose-400'
                        : 'text-slate-400'
                    }`}
                  >
                    {bot.status.toUpperCase()}
                  </span>
                </div>

                {bot.description && (
                  <p className="text-xs text-slate-400 line-clamp-2">{bot.description}</p>
                )}

                <div className="pt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-mono text-slate-400 tabular-nums">
                  <span>WhatsApp: {bot.whatsappState}</span>
                  <span>·</span>
                  <span>CPU: {bot.telemetry?.cpuPercent ?? 0}%</span>
                  <span>·</span>
                  <span>RAM: {bot.telemetry?.ramMb ?? 0} MB</span>
                  <span>·</span>
                  <span>Uptime: {formatUptime(bot.telemetry?.uptimeSeconds || 0)}</span>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {bot.status !== 'running' ? (
                    <button
                      type="button"
                      disabled={actionBusy !== null}
                      onClick={() => handleLifecycle(bot.id, 'start')}
                      className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25 flex items-center gap-1"
                    >
                      <Play className="w-3.5 h-3.5" />
                      Start
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={actionBusy !== null}
                      onClick={() => handleLifecycle(bot.id, 'stop')}
                      className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 hover:bg-amber-500/25 flex items-center gap-1"
                    >
                      <Square className="w-3.5 h-3.5" />
                      Stop
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={actionBusy !== null}
                    onClick={() => handleLifecycle(bot.id, 'restart')}
                    className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 flex items-center gap-1"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    Restart
                  </button>

                  <button
                    type="button"
                    onClick={() => navigate(`/bots/${bot.id}/logs`)}
                    className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 flex items-center gap-1"
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    Logs
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {bot.status === 'running' && (
                    <a
                      href={`/live/${bot.id}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors inline-flex items-center gap-1 shadow-sm"
                      title="Open Live Website / Preview"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      Live Site ↗
                    </a>
                  )}
                  <Link
                    to={`/bots/${bot.id}`}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/25"
                  >
                    Open Console
                  </Link>
                  <button
                    type="button"
                    onClick={() => setBotToDelete(bot)}
                    className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-rose-400 hover:border-rose-500/40"
                    title="Delete Bot"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Confirmation Dialog for Bot Deletion */}
      {botToDelete && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-rose-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="text-base font-semibold text-white">Delete Bot Instance?</h3>
            </div>
            <p className="text-sm text-slate-300">
              Are you sure you want to permanently stop and delete <strong>{botToDelete.name}</strong> ({botToDelete.id}) and all of its workspace files? This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setBotToDelete(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-rose-600 text-white hover:bg-rose-500"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
