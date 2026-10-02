import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  Shield,
  Users,
  Bot as BotIcon,
  Server,
  Rocket,
  Activity,
  Search,
  AlertTriangle,
  CheckCircle2,
  Play,
  Square,
  RotateCw,
  Trash2,
  Plus,
  Save,
  ArrowLeft,
} from 'lucide-react';
import { apiRequest, formatUptime } from '../lib/api';

export const AdminOverviewPage: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadOverview = async () => {
    try {
      const res = await apiRequest('/api/admin/overview');
      setData(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
    const interval = setInterval(loadOverview, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !data) {
    return <div className="p-12 text-center text-xs text-slate-400">Loading administrator telemetry...</div>;
  }

  const stats = data?.stats || {};
  const host = data?.hostMetrics || {};

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
            <Shield className="w-6 h-6 text-purple-400" />
            LYRICAL Global Administrator Control Plane
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Platform-wide user governance, container process oversight, server capacity, and audit logs
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/admin/settings"
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-purple-600 text-white hover:bg-purple-500 transition-colors"
          >
            System & Maintenance Settings
          </Link>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="text-xs text-slate-400">Total Users</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-white mt-2">
            {stats.totalUsers ?? 0}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Active: {stats.activeUsers ?? 0} · Suspended: {stats.suspendedUsers ?? 0}
          </div>
        </div>

        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="text-xs text-slate-400">Platform Bots</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-cyan-400 mt-2">
            {stats.totalBots ?? 0}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Running: {stats.runningBots ?? 0} · Stopped: {stats.stoppedBots ?? 0}
          </div>
        </div>

        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="text-xs text-slate-400">Host CPU & Memory</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-purple-400 mt-2">
            {host.cpuUsagePercent ?? 0}% · {host.ramUsagePercent ?? 0}%
          </div>
          <div className="text-xs text-slate-500 mt-1">
            RAM: {host.ramUsedMb ?? 0} / {host.ramTotalMb ?? 0} MB
          </div>
        </div>

        <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/60">
          <div className="text-xs text-slate-400">Deployments & Servers</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-emerald-400 mt-2">
            {stats.totalDeployments ?? 0}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Failed: {stats.failedDeployments ?? 0} · Nodes: {stats.serversCount ?? 1}
          </div>
        </div>
      </div>

      {/* Recent Deployments & Admin Audit Split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Recent Platform Deployments</h2>
            <Link to="/admin/deployments" className="text-xs text-purple-400 hover:underline">
              View all →
            </Link>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 divide-y divide-slate-800 text-xs">
            {(data?.recentDeployments || []).length === 0 ? (
              <div className="p-6 text-slate-500 text-center">No deployments yet.</div>
            ) : (
              (data?.recentDeployments || []).map((d: any) => (
                <div key={d.id} className="p-3.5 flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-white">{d.botName}</div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      {d.userEmail} · {d.id}
                    </div>
                  </div>
                  <span
                    className={`font-mono ${
                      d.status === 'success'
                        ? 'text-emerald-400'
                        : d.status === 'failed'
                        ? 'text-rose-400'
                        : 'text-cyan-400'
                    }`}
                  >
                    {d.status.toUpperCase()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Recent Administrator Audit Log</h2>
            <Link to="/admin/audit-logs" className="text-xs text-purple-400 hover:underline">
              Full audit log →
            </Link>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 divide-y divide-slate-800 text-xs">
            {(data?.recentAuditLogs || []).length === 0 ? (
              <div className="p-6 text-slate-500 text-center">No audit entries recorded.</div>
            ) : (
              (data?.recentAuditLogs || []).map((a: any) => (
                <div key={a.id} className="p-3.5 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-mono font-semibold text-purple-300">{a.action}</div>
                    <div className="text-[11px] text-slate-400">{a.details}</div>
                  </div>
                  <div className="text-right text-[11px] font-mono text-slate-500">
                    <div>{a.adminEmail}</div>
                    <div>{new Date(a.timestamp).toLocaleTimeString()}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export const AdminUsersPage: React.FC = () => {
  const navigate = useNavigate();
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [userToDelete, setUserToDelete] = useState<any | null>(null);

  const loadUsers = async () => {
    const res = await apiRequest('/api/admin/users');
    setUsers(res.users || []);
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleToggleSuspend = async (u: any) => {
    await apiRequest(`/api/admin/users/${u.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ suspended: !u.suspended }),
    });
    await loadUsers();
  };

  const handleConfirmDelete = async () => {
    if (!userToDelete) return;
    const target = userToDelete;
    setUserToDelete(null);
    await apiRequest(`/api/admin/users/${target.id}`, { method: 'DELETE' });
    await loadUsers();
  };

  const filtered = users.filter(
    (u) =>
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      u.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold">User Management</h1>
          <p className="text-xs text-slate-400 mt-1">
            Inspect user accounts, suspend access, reset passwords, or view user bots
          </p>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users by name or email..."
            className="w-full pl-9 pr-4 py-2 text-xs bg-slate-900 border border-slate-800 rounded-lg text-white"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-[11px] text-slate-400">
              <th className="py-3 px-4">User</th>
              <th className="py-3 px-4">Role</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Bots (Running/Total)</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-xs">
            {filtered.map((u) => (
              <tr key={u.id} className="hover:bg-slate-900/90">
                <td className="py-3.5 px-4">
                  <Link
                    to={`/admin/users/${u.id}`}
                    className="font-semibold text-white hover:text-purple-400"
                  >
                    {u.name}
                  </Link>
                  <div className="text-[11px] text-slate-500 font-mono">{u.email}</div>
                </td>
                <td className="py-3.5 px-4 font-mono uppercase text-slate-300">{u.role}</td>
                <td className="py-3.5 px-4 font-mono">
                  <span className={u.suspended ? 'text-rose-400' : 'text-emerald-400'}>
                    {u.suspended ? 'SUSPENDED' : 'ACTIVE'}
                  </span>
                </td>
                <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-300">
                  {u.runningBotsCount} / {u.botsCount}
                </td>
                <td className="py-3.5 px-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/admin/users/${u.id}`)}
                      className="px-2.5 py-1 rounded border border-slate-700 text-slate-200 hover:border-purple-500/40"
                    >
                      Details
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleSuspend(u)}
                      className="px-2.5 py-1 rounded border border-amber-500/40 text-amber-300 hover:bg-amber-500/15"
                    >
                      {u.suspended ? 'Unsuspend' : 'Suspend'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setUserToDelete(u)}
                      className="p-1.5 rounded border border-slate-800 text-slate-400 hover:text-rose-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {userToDelete && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-2 text-rose-400">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-base font-semibold text-white">Delete User Account?</h3>
            </div>
            <p className="text-sm text-slate-300">
              Delete user <strong>{userToDelete.email}</strong> and terminate all of their bots? This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setUserToDelete(null)}
                className="px-4 py-2 text-xs rounded-lg border border-slate-700 text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-xs rounded-lg bg-rose-600 text-white"
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

export const AdminUserDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [newPassword, setNewPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const loadUser = async () => {
    if (!id) return;
    const res = await apiRequest(`/api/admin/users/${id}`);
    setData(res);
  };

  useEffect(() => {
    loadUser();
  }, [id]);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || newPassword.length < 6) return;
    await apiRequest(`/api/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ newPassword }),
    });
    setNewPassword('');
    setNotice('User password has been reset and recorded in the audit log.');
  };

  if (!data?.user) {
    return <div className="p-8 text-xs text-slate-400">Loading user profile...</div>;
  }

  const u = data.user;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <Link to="/admin/users" className="text-xs text-purple-400 hover:underline flex items-center gap-1">
            <ArrowLeft className="w-3.5 h-3.5" />
            All Users
          </Link>
          <h1 className="text-2xl font-bold mt-1">{u.name}</h1>
          <div className="text-xs font-mono text-slate-400">
            {u.email} · {u.id} · Role: {u.role.toUpperCase()}
          </div>
        </div>
      </div>

      {notice && (
        <div className="p-3 rounded-xl bg-cyan-950/60 border border-cyan-500/40 text-xs text-cyan-200">
          {notice}
        </div>
      )}

      <form
        onSubmit={handleResetPassword}
        className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 flex flex-col sm:flex-row items-end gap-4"
      >
        <div className="flex-1 w-full">
          <label className="block text-xs font-medium text-slate-300 mb-1.5">
            Reset User Password
          </label>
          <input
            type="password"
            minLength={6}
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Enter new password for user..."
            className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-2 text-xs font-semibold rounded-lg bg-purple-600 text-white hover:bg-purple-500 whitespace-nowrap"
        >
          Reset Password
        </button>
      </form>

      <div className="space-y-3">
        <h2 className="text-base font-semibold">User's Bots ({(data.bots || []).length})</h2>
        <div className="rounded-xl border border-slate-800 bg-slate-900/50 divide-y divide-slate-800 text-xs">
          {(data.bots || []).map((b: any) => (
            <div key={b.id} className="p-4 flex items-center justify-between">
              <div>
                <Link to={`/bots/${b.id}`} className="font-semibold text-white hover:text-cyan-400">
                  {b.name}
                </Link>
                <div className="text-[11px] font-mono text-slate-500">
                  {b.id} · {b.runtime} · Status: {b.status.toUpperCase()}
                </div>
              </div>
              <Link
                to={`/bots/${b.id}`}
                className="px-3 py-1 rounded border border-slate-700 text-slate-200 hover:border-cyan-500/40"
              >
                Inspect Bot
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const AdminBotsPage: React.FC = () => {
  const [bots, setBots] = useState<any[]>([]);
  const [search, setSearch] = useState('');

  const loadBots = async () => {
    const res = await apiRequest('/api/admin/bots');
    setBots(res.bots || []);
  };

  useEffect(() => {
    loadBots();
    const interval = setInterval(loadBots, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleAction = async (botId: string, action: 'start' | 'stop' | 'restart' | 'redeploy') => {
    await apiRequest(`/api/bots/${botId}/${action}`, { method: 'POST' });
    await loadBots();
  };

  const filtered = bots.filter(
    (b) =>
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      (b.ownerEmail || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold">All Platform Bots</h1>
          <p className="text-xs text-slate-400 mt-1">
            Monitor and control every WhatsApp bot container across all user accounts
          </p>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by bot name or owner email..."
            className="w-full pl-9 pr-4 py-2 text-xs bg-slate-900 border border-slate-800 rounded-lg text-white"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-[11px] text-slate-400">
              <th className="py-3 px-4">Bot</th>
              <th className="py-3 px-4">Owner</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">PID / CPU / RAM</th>
              <th className="py-3 px-4 text-right">Controls</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-xs">
            {filtered.map((b) => (
              <tr key={b.id}>
                <td className="py-3.5 px-4">
                  <Link to={`/bots/${b.id}`} className="font-semibold text-white hover:text-cyan-400">
                    {b.name}
                  </Link>
                  <div className="text-[11px] font-mono text-slate-500">{b.id}</div>
                </td>
                <td className="py-3.5 px-4 font-mono text-slate-300">{b.ownerEmail}</td>
                <td className="py-3.5 px-4 font-mono">
                  <span
                    className={
                      b.status === 'running'
                        ? 'text-emerald-400'
                        : b.status === 'failed'
                        ? 'text-rose-400'
                        : 'text-slate-400'
                    }
                  >
                    {b.status.toUpperCase()}
                  </span>
                </td>
                <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-300">
                  {b.telemetry?.pid ? `PID ${b.telemetry.pid}` : '—'} · {b.telemetry?.cpuPercent ?? 0}% ·{' '}
                  {b.telemetry?.ramMb ?? 0} MB
                </td>
                <td className="py-3.5 px-4 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {b.status !== 'running' ? (
                      <button
                        onClick={() => handleAction(b.id, 'start')}
                        className="px-2 py-1 rounded bg-emerald-500/15 text-emerald-300"
                      >
                        Start
                      </button>
                    ) : (
                      <button
                        onClick={() => handleAction(b.id, 'stop')}
                        className="px-2 py-1 rounded bg-amber-500/15 text-amber-300"
                      >
                        Stop
                      </button>
                    )}
                    <button
                      onClick={() => handleAction(b.id, 'restart')}
                      className="px-2 py-1 rounded border border-slate-700 text-slate-300"
                    >
                      Restart
                    </button>
                    <Link
                      to={`/bots/${b.id}`}
                      className="px-2.5 py-1 rounded border border-cyan-500/40 text-cyan-300"
                    >
                      Open
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const AdminDeploymentsPage: React.FC = () => {
  const [deployments, setDeployments] = useState<any[]>([]);

  useEffect(() => {
    apiRequest('/api/admin/deployments').then((res) => setDeployments(res.deployments || []));
  }, []);

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-slate-800">
        <h1 className="text-2xl font-bold">Global Deployment History</h1>
        <p className="text-xs text-slate-400 mt-1">
          Inspect build durations, status outcomes, and error diagnostics across all users
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-[11px] text-slate-400">
              <th className="py-3 px-4">Deployment ID</th>
              <th className="py-3 px-4">Bot</th>
              <th className="py-3 px-4">User</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Started</th>
              <th className="py-3 px-4 text-right">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 text-xs font-mono">
            {deployments.map((d) => (
              <tr key={d.id}>
                <td className="py-3.5 px-4 text-slate-200">{d.id}</td>
                <td className="py-3.5 px-4">
                  <Link to={`/bots/${d.botId}`} className="text-cyan-400 hover:underline">
                    {d.botName}
                  </Link>
                </td>
                <td className="py-3.5 px-4 text-slate-400">{d.userEmail}</td>
                <td className="py-3.5 px-4">
                  <span
                    className={
                      d.status === 'success'
                        ? 'text-emerald-400'
                        : d.status === 'failed'
                        ? 'text-rose-400'
                        : 'text-cyan-400'
                    }
                  >
                    {d.status.toUpperCase()}
                  </span>
                  {d.errorMessage && (
                    <div className="text-[11px] text-rose-400 truncate max-w-xs">
                      {d.errorMessage}
                    </div>
                  )}
                </td>
                <td className="py-3.5 px-4 text-slate-400">
                  {new Date(d.startTime).toLocaleString()}
                </td>
                <td className="py-3.5 px-4 text-right tabular-nums text-slate-300">
                  {d.durationMs !== null ? `${(d.durationMs / 1000).toFixed(1)}s` : 'Active'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const AdminServersPage: React.FC = () => {
  const [servers, setServers] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [newRegion, setNewRegion] = useState('');
  const [newHost, setNewHost] = useState('');

  const loadServers = async () => {
    const res = await apiRequest('/api/admin/servers');
    setServers(res.servers || []);
  };

  useEffect(() => {
    loadServers();
  }, []);

  const handleAddServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newRegion || !newHost) return;
    await apiRequest('/api/admin/servers', {
      method: 'POST',
      body: JSON.stringify({ name: newName, region: newRegion, host: newHost }),
    });
    setNewName('');
    setNewRegion('');
    setNewHost('');
    await loadServers();
  };

  const toggleServerMaintenance = async (srv: any) => {
    await apiRequest(`/api/admin/servers/${srv.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ maintenanceMode: !srv.maintenanceMode }),
    });
    await loadServers();
  };

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-slate-800">
        <h1 className="text-2xl font-bold">Server Node Management</h1>
        <p className="text-xs text-slate-400 mt-1">
          Inspect live Linux host metrics, bot capacity, and server maintenance states
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {servers.map((srv) => (
          <div
            key={srv.id}
            className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-white">{srv.name}</h3>
                <div className="text-xs font-mono text-slate-400">
                  {srv.region} · {srv.host}
                </div>
              </div>
              <span
                className={`text-xs font-mono font-semibold ${
                  srv.status === 'online' ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {srv.status.toUpperCase()}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs font-mono border-y border-slate-800 py-3 tabular-nums">
              <div>
                <span className="text-slate-500 block">CPU Load</span>
                <span className="text-cyan-400">{srv.metrics?.cpuUsagePercent ?? 0}%</span>
              </div>
              <div>
                <span className="text-slate-500 block">RAM Used</span>
                <span className="text-blue-400">
                  {srv.metrics?.ramUsedMb ?? 0} / {srv.metrics?.ramTotalMb ?? 0} MB
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Running Bots</span>
                <span className="text-emerald-400">
                  {srv.runningBots} / {srv.capacityBots}
                </span>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => toggleServerMaintenance(srv)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 text-slate-200 hover:border-purple-500/40"
              >
                {srv.maintenanceMode ? 'Exit Server Maintenance' : 'Put Node in Maintenance'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={handleAddServer}
        className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4"
      >
        <h3 className="text-sm font-semibold text-white">Register Additional Server Node</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <input
            type="text"
            required
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Node Name (e.g. LYRICAL-EU-02)"
            className="px-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
          />
          <input
            type="text"
            required
            value={newRegion}
            onChange={(e) => setNewRegion(e.target.value)}
            placeholder="Region (e.g. eu-central-1)"
            className="px-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
          />
          <input
            type="text"
            required
            value={newHost}
            onChange={(e) => setNewHost(e.target.value)}
            placeholder="Host IP or Endpoint"
            className="px-3.5 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg text-white"
          />
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-purple-600 text-white hover:bg-purple-500 flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Server Node
          </button>
        </div>
      </form>
    </div>
  );
};

export const AdminLogsAndAuditPage: React.FC<{ mode: 'logs' | 'audit' }> = ({ mode }) => {
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    if (mode === 'audit') {
      apiRequest('/api/admin/audit-logs').then((res) => setItems(res.auditLogs || []));
    } else {
      apiRequest('/api/admin/logs').then((res) => setItems(res.logs || []));
    }
  }, [mode]);

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-slate-800">
        <h1 className="text-2xl font-bold">
          {mode === 'audit' ? 'Administrator Security Audit Log' : 'Aggregated Container Logs'}
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          {mode === 'audit'
            ? 'Immutable trail of administrator logins, user suspensions, bot operations, and maintenance changes'
            : 'Real-time aggregated process logs across all hosted WhatsApp bots'}
        </p>
      </div>

      {mode === 'audit' ? (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Administrator</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Target</th>
                <th className="py-3 px-4">Details</th>
                <th className="py-3 px-4 text-right">Client IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-xs font-mono">
              {items.map((a) => (
                <tr key={a.id}>
                  <td className="py-3 px-4 text-slate-400">
                    {new Date(a.timestamp).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-slate-200">{a.adminEmail}</td>
                  <td className="py-3 px-4 text-purple-400 font-semibold">{a.action}</td>
                  <td className="py-3 px-4 text-slate-400">
                    {a.targetType}:{a.targetId}
                  </td>
                  <td className="py-3 px-4 text-slate-300 font-sans">{a.details}</td>
                  <td className="py-3 px-4 text-right text-slate-500">{a.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-4 rounded-xl border border-slate-800 bg-slate-950 font-mono text-xs space-y-1.5 max-h-[65vh] overflow-y-auto">
          {items.length === 0 ? (
            <div className="text-slate-500 py-8 text-center">No bot process logs recorded yet.</div>
          ) : (
            items.map((entry, idx) => (
              <div key={idx} className="text-slate-300 break-all">
                <span className="text-cyan-400">[{entry.botName}]</span> {entry.line}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export const AdminSettingsPage: React.FC<{ onSettingsUpdated?: () => void }> = ({
  onSettingsUpdated,
}) => {
  const [settings, setSettings] = useState<any>(null);
  const [broadcast, setBroadcast] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    apiRequest('/api/admin/settings').then((res) => setSettings(res.settings));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiRequest('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({ ...settings, broadcastAnnouncement: broadcast }),
    });
    setSettings(res.settings);
    setNotice('Platform settings saved and recorded in administrator audit log.');
    if (onSettingsUpdated) onSettingsUpdated();
  };

  if (!settings) {
    return <div className="p-8 text-xs text-slate-400">Loading system settings...</div>;
  }

  return (
    <form onSubmit={handleSave} className="max-w-3xl mx-auto space-y-6">
      <div className="pb-4 border-b border-slate-800">
        <h1 className="text-2xl font-bold">System & Maintenance Configuration</h1>
        <p className="text-xs text-slate-400 mt-1">
          Configure global maintenance mode, user bot quotas, announcements, and upstream deployment API adapter URL
        </p>
      </div>

      {notice && (
        <div className="p-3 rounded-xl bg-cyan-950/60 border border-cyan-500/40 text-xs text-cyan-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-cyan-400" />
          {notice}
        </div>
      )}

      <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 space-y-5">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div>
            <div className="text-sm font-bold text-white">Global Maintenance Mode</div>
            <div className="text-xs text-slate-400">
              When enabled, standard users see the Maintenance Screen while administrators retain full console access.
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.maintenanceMode}
            onChange={(e) => setSettings({ ...settings, maintenanceMode: e.target.checked })}
            className="w-5 h-5 accent-purple-500"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5">
            Maintenance Message
          </label>
          <textarea
            rows={2}
            value={settings.maintenanceMessage}
            onChange={(e) => setSettings({ ...settings, maintenanceMessage: e.target.value })}
            className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Estimated Return Time (ISO or Text)
            </label>
            <input
              type="text"
              value={settings.maintenanceReturnTime}
              onChange={(e) => setSettings({ ...settings, maintenanceReturnTime: e.target.value })}
              className="w-full px-3.5 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Maximum Bots Per User
            </label>
            <input
              type="number"
              value={settings.maxBotsPerUser}
              onChange={(e) =>
                setSettings({ ...settings, maxBotsPerUser: Number(e.target.value) })
              }
              className="w-full px-3.5 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg text-white"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div>
            <div className="text-xs font-semibold text-white">Allow New User Registrations</div>
            <div className="text-[11px] text-slate-400">
              Disable to restrict platform to existing accounts only
            </div>
          </div>
          <input
            type="checkbox"
            checked={settings.registrationEnabled}
            onChange={(e) => setSettings({ ...settings, registrationEnabled: e.target.checked })}
            className="w-4 h-4 accent-cyan-500"
          />
        </div>
      </div>

      <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4">
        <h2 className="text-sm font-semibold text-white">
          Global Announcement Banner & External Deployment Adapter
        </h2>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5">
            Announcement Banner (shown at top of dashboard)
          </label>
          <input
            type="text"
            value={settings.announcementBanner}
            onChange={(e) => setSettings({ ...settings, announcementBanner: e.target.value })}
            placeholder="Optional platform-wide announcement..."
            className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
          />
          <label className="inline-flex items-center gap-2 text-xs text-slate-400 mt-2">
            <input
              type="checkbox"
              checked={broadcast}
              onChange={(e) => setBroadcast(e.target.checked)}
              className="accent-cyan-500"
            />
            Also send as an in-app notification to all users
          </label>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5">
            External Deployment API URL (Optional — leaves local OS ProcessManager active when blank)
          </label>
          <input
            type="text"
            value={settings.deploymentApiUrl || ''}
            onChange={(e) => setSettings({ ...settings, deploymentApiUrl: e.target.value })}
            placeholder="https://your-deployment-api.example.com/v1"
            className="w-full px-3.5 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg text-white"
          />
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            className="px-5 py-2.5 text-xs font-semibold rounded-lg bg-purple-600 text-white hover:bg-purple-500 flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            Save System Configuration
          </button>
        </div>
      </div>
    </form>
  );
};
