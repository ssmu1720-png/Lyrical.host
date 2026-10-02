import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  Play,
  Square,
  RotateCw,
  Rocket,
  Trash2,
  Eye,
  EyeOff,
  Plus,
  Save,
  Smartphone,
  QrCode,
  FileCode,
  Cloud as FolderCloud,
  GitBranch,
  AlertTriangle,
  CheckCircle2,
  ArrowLeft,
} from 'lucide-react';
import { apiRequest, Bot, Deployment, formatUptime, formatBytes } from '../lib/api';
import { TerminalLogViewer } from '../components/TerminalLogViewer';
import { GoogleDriveModal } from '../components/GoogleDriveModal';
import {
  saveFileToGoogleDrive,
  googleSignIn,
  githubSignIn,
  listUserGithubRepos,
  getGithubAccessToken,
  GithubRepoItem,
  syncBotDocumentToFirestore,
  deleteBotDocumentFromFirestore,
  formatAuthError,
} from '../lib/workspaceAuth';

export const BotDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const initialTab = location.pathname.endsWith('/logs')
    ? 'logs'
    : location.pathname.endsWith('/settings')
    ? 'settings'
    : 'overview';

  const [activeTab, setActiveTab] = useState<
    'overview' | 'logs' | 'whatsapp' | 'files' | 'deployments' | 'settings'
  >(initialTab);

  const [bot, setBot] = useState<Bot | null>(null);
  const [envVars, setEnvVars] = useState<{ key: string; value: string; visible?: boolean }[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [serverInfo, setServerInfo] = useState<any>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('index.js');
  const [fileContent, setFileContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Settings form state
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editRepo, setEditRepo] = useState('');
  const [editBranch, setEditBranch] = useState('main');
  const [editStartCmd, setEditStartCmd] = useState('');
  const [editBuildCmd, setEditBuildCmd] = useState('');
  const [editPort, setEditPort] = useState(8080);
  const [editAutoRestart, setEditAutoRestart] = useState(true);

  // Confirmation dialogs for destructive actions
  const [confirmAction, setConfirmAction] = useState<
    null | 'stop' | 'restart' | 'redeploy' | 'delete' | 'disconnect_wa'
  >(null);
  const [driveOpen, setDriveOpen] = useState(false);
  const [githubRepos, setGithubRepos] = useState<GithubRepoItem[]>([]);
  const [showGithubList, setShowGithubList] = useState(false);

  const handleLoadGithubRepos = async () => {
    setError(null);
    try {
      if (!getGithubAccessToken()) {
        const gh = await githubSignIn();
        if (!gh) return;
      }
      const repos = await listUserGithubRepos();
      setGithubRepos(repos);
      setShowGithubList(true);
    } catch (err: any) {
      const friendly = formatAuthError(err);
      if (friendly) {
        setError(friendly);
      }
    }
  };

  const fetchBotDetails = async (populateForm = false) => {
    if (!id) return;
    try {
      const res = await apiRequest(`/api/bots/${id}`);
      setBot(res.bot);
      setDeployments(res.deployments || []);
      setServerInfo(res.server);
      setFiles(res.files || []);
      if (populateForm) {
        setEnvVars(
          (res.envVars || []).map((e: any) => ({
            key: e.key,
            value: e.value,
            visible: false,
          }))
        );
        setEditName(res.bot.name);
        setEditDesc(res.bot.description || '');
        setEditRepo(res.bot.repoUrl || '');
        setEditBranch(res.bot.branch || 'main');
        setEditStartCmd(res.bot.startCommand || '');
        setEditBuildCmd(res.bot.buildCommand || '');
        setEditPort(res.bot.port || 8080);
        setEditAutoRestart(res.bot.autoRestart !== false);

        const defaultFile = res.bot.runtime === 'python' ? 'main.py' : 'index.js';
        loadWorkspaceFile(defaultFile);
      }
    } catch (err: any) {
      setError(err.message || 'Could not load bot details.');
    } finally {
      setLoading(false);
    }
  };

  const loadWorkspaceFile = async (filePath: string) => {
    if (!id) return;
    try {
      const res = await apiRequest(
        `/api/bots/${id}/files/content?path=${encodeURIComponent(filePath)}`
      );
      setSelectedFile(filePath);
      setFileContent(res.content);
    } catch {
      // ignore if file doesn't exist yet
    }
  };

  useEffect(() => {
    fetchBotDetails(true);
    const interval = setInterval(() => fetchBotDetails(false), 3500);
    return () => clearInterval(interval);
  }, [id]);

  useEffect(() => {
    if (location.pathname.endsWith('/logs')) setActiveTab('logs');
    else if (location.pathname.endsWith('/settings')) setActiveTab('settings');
  }, [location.pathname]);

  const handleStartBot = async () => {
    if (!id) return;
    setError(null);
    try {
      await apiRequest(`/api/bots/${id}/start`, { method: 'POST' });
      setNotice('Bot process started.');
      await fetchBotDetails(false);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleGitPull = async () => {
    if (!id) return;
    setError(null);
    try {
      const res = await apiRequest<{ success: boolean; output: string }>(`/api/bots/${id}/pull`, {
        method: 'POST',
      });
      setNotice(`Git Pull complete: ${res.output}`);
      await fetchBotDetails(false);
    } catch (err: any) {
      setError(err.message || 'Git pull failed.');
    }
  };

  const executeConfirmedAction = async () => {
    if (!id || !confirmAction) return;
    const action = confirmAction;
    setConfirmAction(null);
    setError(null);

    try {
      if (action === 'stop') {
        await apiRequest(`/api/bots/${id}/stop`, { method: 'POST' });
        setNotice('Bot process stopped.');
      } else if (action === 'restart') {
        await apiRequest(`/api/bots/${id}/restart`, { method: 'POST' });
        setNotice('Bot process restarted.');
      } else if (action === 'redeploy') {
        await apiRequest(`/api/bots/${id}/redeploy`, { method: 'POST' });
        setNotice('Redeployment pipeline started.');
        setActiveTab('logs');
      } else if (action === 'delete') {
        await apiRequest(`/api/bots/${id}`, { method: 'DELETE' });
        await deleteBotDocumentFromFirestore(id).catch(() => {});
        navigate('/bots');
        return;
      } else if (action === 'disconnect_wa') {
        await apiRequest(`/api/bots/${id}/whatsapp`, {
          method: 'POST',
          body: JSON.stringify({ action: 'disconnect' }),
        });
        setNotice('WhatsApp session disconnected.');
      }
      await fetchBotDetails(false);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleWhatsAppAction = async (
    action: 'generate' | 'reconnect' | 'confirm_connected',
    method?: 'pairing_code' | 'qr_code',
    phone?: string
  ) => {
    if (!id) return;
    setError(null);
    try {
      const res = await apiRequest(`/api/bots/${id}/whatsapp`, {
        method: 'POST',
        body: JSON.stringify({ action, method, phone }),
      });
      setBot(res.bot);
      setNotice('WhatsApp authentication request dispatched to bot runtime.');
      setTimeout(() => fetchBotDetails(false), 1200);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSaveFile = async () => {
    if (!id || !selectedFile) return;
    setError(null);
    try {
      const res = await apiRequest(`/api/bots/${id}/files/content`, {
        method: 'PUT',
        body: JSON.stringify({ path: selectedFile, content: fileContent }),
      });
      setFiles(res.files || []);
      setNotice(`Saved "${selectedFile}" to bot workspace.`);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleBackupFileToDrive = async () => {
    if (!bot || !selectedFile) return;
    try {
      const driveName = `LYRICAL_${bot.name.replace(/\s+/g, '_')}_${selectedFile.replace(/\//g, '_')}`;
      await saveFileToGoogleDrive(driveName, fileContent);
      setNotice(`Backed up "${selectedFile}" to your Google Drive as "${driveName}".`);
    } catch (err: any) {
      if (err.message === 'NEEDS_GOOGLE_AUTH') {
        const g = await googleSignIn();
        if (!g) return;
        const driveName = `LYRICAL_${bot.name.replace(/\s+/g, '_')}_${selectedFile}`;
        await saveFileToGoogleDrive(driveName, fileContent);
        setNotice(`Backed up "${selectedFile}" to your Google Drive.`);
      } else {
        const friendly = formatAuthError(err);
        if (friendly) {
          setError(friendly);
        }
      }
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setError(null);
    try {
      await apiRequest(`/api/bots/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editName,
          description: editDesc,
          repoUrl: editRepo,
          branch: editBranch,
          startCommand: editStartCmd,
          buildCommand: editBuildCmd,
          port: editPort,
          autoRestart: editAutoRestart,
        }),
      });
      await apiRequest(`/api/bots/${id}/env`, {
        method: 'PUT',
        body: JSON.stringify({
          envVars: envVars.filter((x) => x.key.trim() !== ''),
        }),
      });
      setNotice('Bot configuration and environment variables saved.');
      await fetchBotDetails(false);
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading && !bot) {
    return <div className="p-12 text-center text-xs text-slate-400">Loading bot workspace...</div>;
  }

  if (!bot) {
    return (
      <div className="p-12 text-center space-y-4">
        <div className="text-base font-semibold text-rose-400">Bot not found or access denied</div>
        <Link to="/bots" className="text-xs text-cyan-400 hover:underline">
          ← Return to My Bots
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-5 border-b border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Link to="/bots" className="hover:text-cyan-400 flex items-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" />
              Bots
            </Link>
            <span>/</span>
            <span className="font-mono text-slate-300">{bot.id}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{bot.name}</h1>
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
              {bot.status === 'running' ? 'ONLINE' : bot.status.toUpperCase()}
            </span>
            {bot.autoRestart !== false && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-950/60 border border-emerald-800/60 text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Watchdog Active {bot.restartCount && bot.restartCount > 0 ? `(${bot.restartCount} recoveries)` : ''}
              </span>
            )}
          </div>
        </div>

        {/* Lifecycle Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {bot.status !== 'running' ? (
            <button
              type="button"
              onClick={handleStartBot}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-colors flex items-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" />
              Start
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmAction('stop')}
              className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 transition-colors flex items-center gap-1.5"
            >
              <Square className="w-3.5 h-3.5" />
              Stop
            </button>
          )}

          <button
            type="button"
            onClick={() => setConfirmAction('restart')}
            className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:border-cyan-500/40 flex items-center gap-1.5"
          >
            <RotateCw className="w-3.5 h-3.5" />
            Restart
          </button>

          {bot.repoUrl && (
            <button
              type="button"
              onClick={handleGitPull}
              className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-700 bg-slate-900 text-slate-200 hover:border-cyan-500/40 flex items-center gap-1.5"
            >
              <GitBranch className="w-3.5 h-3.5 text-cyan-400" />
              Git Pull
            </button>
          )}

          <button
            type="button"
            onClick={() => setConfirmAction('redeploy')}
            className="px-3.5 py-2 text-xs font-medium rounded-lg border border-cyan-500/40 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 flex items-center gap-1.5"
          >
            <Rocket className="w-3.5 h-3.5" />
            Redeploy
          </button>

          <button
            type="button"
            onClick={() => setConfirmAction('delete')}
            className="px-3.5 py-2 text-xs font-medium rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        </div>
      </div>

      {notice && (
        <div className="p-3 rounded-xl bg-cyan-950/60 border border-cyan-500/40 text-xs text-cyan-200 flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
            {notice}
          </span>
          <button onClick={() => setNotice(null)} className="text-cyan-400 hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200">
          {error}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex overflow-x-auto gap-1 p-1 bg-slate-900/90 border border-slate-800 rounded-xl">
        {[
          { id: 'overview', label: 'Overview & Telemetry' },
          { id: 'logs', label: 'Real-Time Terminal Logs' },
          { id: 'whatsapp', label: 'WhatsApp Connection' },
          { id: 'files', label: 'Bot Files & Source' },
          { id: 'deployments', label: 'Deployment History' },
          { id: 'settings', label: 'Settings & Env Vars' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-cyan-500 text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: OVERVIEW & TELEMETRY */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50">
              <div className="text-xs text-slate-400">Process Uptime & PID</div>
              <div className="text-xl font-bold font-mono tabular-nums text-emerald-400 mt-1.5">
                {formatUptime(bot.telemetry?.uptimeSeconds || 0)}
              </div>
              <div className="text-xs font-mono text-slate-500 mt-1">
                OS PID: {bot.telemetry?.pid ?? 'Stopped'}
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50">
              <div className="text-xs text-slate-400">CPU & Memory (RSS)</div>
              <div className="text-xl font-bold font-mono tabular-nums text-cyan-400 mt-1.5">
                {bot.telemetry?.cpuPercent ?? 0}% · {bot.telemetry?.ramMb ?? 0} MB
              </div>
              <div className="text-xs font-mono text-slate-500 mt-1">
                Workspace Disk: {bot.telemetry?.storageMb ?? 0} MB
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50">
              <div className="text-xs text-slate-400">Process I/O Traffic</div>
              <div className="text-xl font-bold font-mono tabular-nums text-blue-400 mt-1.5">
                {formatBytes((bot.telemetry?.txBytes || 0) + (bot.telemetry?.rxBytes || 0))}
              </div>
              <div className="text-xs font-mono text-slate-500 mt-1">
                TX: {formatBytes(bot.telemetry?.txBytes || 0)} · RX:{' '}
                {formatBytes(bot.telemetry?.rxBytes || 0)}
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/50">
              <div className="text-xs text-slate-400">WhatsApp Session</div>
              <div className="text-base font-bold font-mono text-white mt-1.5 truncate">
                {bot.whatsappState}
              </div>
              <div className="text-xs text-slate-500 mt-1">
                Method: {bot.whatsappAuthMethod === 'pairing_code' ? 'Pairing Code' : 'QR Code'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-3">
              <h3 className="text-sm font-semibold text-white">Instance Specification</h3>
              <div className="space-y-2 text-slate-300 font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-500">Container ID:</span>
                  <span>{bot.containerId || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Runtime:</span>
                  <span>{bot.runtime.toUpperCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Start Command:</span>
                  <span>{bot.startCommand}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Port:</span>
                  <span>{bot.port}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Deployed At:</span>
                  <span>{new Date(bot.createdAt).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Last Restart:</span>
                  <span>
                    {bot.lastRestartAt ? new Date(bot.lastRestartAt).toLocaleString() : 'Never'}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-5 rounded-xl border border-slate-800 bg-slate-900/50 space-y-3">
              <h3 className="text-sm font-semibold text-white">Server Node Information</h3>
              <div className="space-y-2 text-slate-300 font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-500">Server Node:</span>
                  <span>{serverInfo?.name || 'LYRICAL-CORE-01'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Region:</span>
                  <span>{bot.region}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Host Address:</span>
                  <span>{serverInfo?.host || '127.0.0.1'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Repository:</span>
                  <span className="truncate max-w-[200px]">
                    {bot.repoUrl || 'Local / Google Drive Workspace'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <TerminalLogViewer
            botId={bot.id}
            botName={bot.name}
            isRunning={bot.status === 'running'}
          />
        </div>
      )}

      {/* TAB 2: REAL-TIME LOGS */}
      {activeTab === 'logs' && (
        <TerminalLogViewer
          botId={bot.id}
          botName={bot.name}
          isRunning={bot.status === 'running'}
          fullHeight
        />
      )}

      {/* TAB 3: WHATSAPP CONNECTION */}
      {activeTab === 'whatsapp' && (
        <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-lg font-bold text-white">WhatsApp Multi-Device Session</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Current Connection State:{' '}
                <span className="font-mono font-bold text-cyan-400">{bot.whatsappState}</span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleWhatsAppAction('generate', 'pairing_code', bot.whatsappPhone)}
                className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 flex items-center gap-1.5"
              >
                <Smartphone className="w-3.5 h-3.5" />
                Request Pairing Code
              </button>

              <button
                type="button"
                onClick={() => handleWhatsAppAction('generate', 'qr_code')}
                className="px-3.5 py-2 text-xs font-semibold rounded-lg border border-cyan-500/40 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 flex items-center gap-1.5"
              >
                <QrCode className="w-3.5 h-3.5" />
                Generate QR Code
              </button>

              <button
                type="button"
                onClick={() => handleWhatsAppAction('confirm_connected')}
                className="px-3.5 py-2 text-xs font-medium rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
              >
                Verify Connected
              </button>

              <button
                type="button"
                onClick={() => setConfirmAction('disconnect_wa')}
                className="px-3.5 py-2 text-xs font-medium rounded-lg border border-rose-500/40 text-rose-300 hover:bg-rose-500/15"
              >
                Disconnect Session
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
            <div className="p-6 rounded-xl border border-slate-800 bg-slate-950/80 space-y-4">
              <h3 className="text-sm font-semibold text-white">8-Character Pairing Code</h3>
              <p className="text-xs text-slate-400">
                Open WhatsApp on your phone → Linked Devices → Link with phone number instead, and enter the code emitted by the bot runtime:
              </p>
              <div className="py-6 px-4 rounded-xl border border-cyan-500/30 bg-slate-900 text-center">
                <span className="font-mono text-2xl sm:text-3xl font-bold tracking-widest text-cyan-400">
                  {bot.whatsappPairingCode || 'AWAITING-CODE'}
                </span>
              </div>
            </div>

            <div className="p-6 rounded-xl border border-slate-800 bg-slate-950/80 flex flex-col items-center justify-center space-y-4">
              <h3 className="text-sm font-semibold text-white">WhatsApp QR Authentication</h3>
              {bot.whatsappQr ? (
                <div className="p-4 bg-white rounded-xl">
                  <QRCodeSVG value={bot.whatsappQr} size={180} />
                </div>
              ) : (
                <div className="h-44 w-44 rounded-xl border border-dashed border-slate-700 flex items-center justify-center text-xs text-slate-500 text-center p-4">
                  Click "Generate QR Code" to request a live QR payload from the running bot process
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: BOT FILES & SOURCE */}
      {activeTab === 'files' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Workspace Files</h3>
              <button
                type="button"
                onClick={() => setDriveOpen(true)}
                className="px-2.5 py-1 text-xs font-medium rounded-lg border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/15 flex items-center gap-1"
              >
                <FolderCloud className="w-3.5 h-3.5" />
                Drive Import
              </button>
            </div>

            <div className="divide-y divide-slate-800 border border-slate-800 rounded-lg overflow-hidden">
              {files.length === 0 ? (
                <div className="p-4 text-xs text-slate-500">No files in workspace.</div>
              ) : (
                files
                  .filter((f) => !f.isDirectory)
                  .map((file) => (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => loadWorkspaceFile(file.path)}
                      className={`w-full px-3.5 py-2.5 text-left text-xs font-mono flex items-center justify-between transition-colors ${
                        selectedFile === file.path
                          ? 'bg-cyan-500/15 text-cyan-300'
                          : 'bg-slate-950/60 text-slate-300 hover:bg-slate-900'
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <FileCode className="w-3.5 h-3.5 shrink-0 text-cyan-400" />
                        {file.path}
                      </span>
                      <span className="text-[11px] text-slate-500">{formatBytes(file.size)}</span>
                    </button>
                  ))
              )}
            </div>
          </div>

          <div className="lg:col-span-2 p-5 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4 flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-mono text-cyan-400">{selectedFile}</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleBackupFileToDrive}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 text-slate-200 hover:border-cyan-500/40 flex items-center gap-1.5"
                >
                  <FolderCloud className="w-3.5 h-3.5 text-cyan-400" />
                  Save to Google Drive
                </button>
                <button
                  type="button"
                  onClick={handleSaveFile}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  Save File
                </button>
              </div>
            </div>

            <textarea
              rows={18}
              value={fileContent}
              onChange={(e) => setFileContent(e.target.value)}
              className="w-full flex-1 p-4 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg text-slate-100 focus:outline-none focus:border-cyan-500"
            />
          </div>
        </div>
      )}

      {/* TAB 5: DEPLOYMENT HISTORY */}
      {activeTab === 'deployments' && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                <th className="py-3 px-4">Deployment ID</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Commit</th>
                <th className="py-3 px-4">Started</th>
                <th className="py-3 px-4 text-right">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 text-xs font-mono">
              {deployments.map((d) => (
                <tr key={d.id}>
                  <td className="py-3.5 px-4 text-slate-200">{d.id}</td>
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
                  </td>
                  <td className="py-3.5 px-4 text-slate-400">{d.commitHash || 'Workspace'}</td>
                  <td className="py-3.5 px-4 text-slate-400">
                    {new Date(d.startTime).toLocaleString()}
                  </td>
                  <td className="py-3.5 px-4 text-right tabular-nums text-slate-300">
                    {d.durationMs !== null ? `${(d.durationMs / 1000).toFixed(1)}s` : 'In progress'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB 6: SETTINGS & ENVIRONMENT VARIABLES (MASKED BY DEFAULT) */}
      {activeTab === 'settings' && (
        <form onSubmit={handleSaveSettings} className="space-y-6">
          <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4">
            <h3 className="text-base font-semibold text-white">Bot Configuration & Source</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Bot Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Port</label>
                <input
                  type="number"
                  value={editPort}
                  onChange={(e) => setEditPort(Number(e.target.value))}
                  className="w-full px-3.5 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg text-white"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-slate-300">
                    GitHub Repository URL
                  </label>
                  <button
                    type="button"
                    onClick={handleLoadGithubRepos}
                    className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1"
                  >
                    <GitBranch className="w-3 h-3" />
                    Select from GitHub OAuth
                  </button>
                </div>
                <input
                  type="text"
                  value={editRepo}
                  onChange={(e) => setEditRepo(e.target.value)}
                  placeholder="https://github.com/..."
                  className="w-full px-3.5 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg text-white"
                />
                {showGithubList && githubRepos.length > 0 && (
                  <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 divide-y divide-slate-800/80">
                    {githubRepos.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => {
                          setEditRepo(r.clone_url.replace(/\.git$/, ''));
                          setEditBranch(r.default_branch || 'main');
                          setShowGithubList(false);
                        }}
                        className="w-full px-3 py-2 text-left text-xs font-mono text-slate-300 hover:bg-slate-900 flex items-center justify-between"
                      >
                        <span className="truncate">{r.full_name}</span>
                        <span className="text-[10px] text-cyan-400">{r.default_branch}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Branch</label>
                <input
                  type="text"
                  value={editBranch}
                  onChange={(e) => setEditBranch(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Start Command
                </label>
                <input
                  type="text"
                  value={editStartCmd}
                  onChange={(e) => setEditStartCmd(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Build Command
                </label>
                <input
                  type="text"
                  value={editBuildCmd}
                  onChange={(e) => setEditBuildCmd(e.target.value)}
                  placeholder="npm install"
                  className="w-full px-3.5 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg text-white"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-white flex items-center gap-2">
                  <RotateCw className="w-3.5 h-3.5 text-cyan-400" />
                  Auto-Restart & Anti-Sleep Watchdog (24/7 Monitoring)
                </span>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Continuously monitors bot process liveness every 15s. Automatically recovers and restarts the bot if it sleeps, crashes, or disconnects.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer ml-4">
                <input
                  type="checkbox"
                  checked={editAutoRestart}
                  onChange={(e) => setEditAutoRestart(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-10 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500" />
              </label>
            </div>
          </div>

          <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-white">Environment Variables</h3>
                <p className="text-xs text-slate-400">
                  Values are masked by default for security. Restart bot to apply changes.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEnvVars([...envVars, { key: '', value: '', visible: true }])}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-700 text-cyan-400 hover:bg-slate-800 flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Variable
              </button>
            </div>

            <div className="space-y-2">
              {envVars.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={item.key}
                    onChange={(e) => {
                      const next = [...envVars];
                      next[idx].key = e.target.value;
                      setEnvVars(next);
                    }}
                    placeholder="KEY"
                    className="w-2/5 px-3 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg text-white"
                  />
                  <div className="relative flex-1">
                    <input
                      type={item.visible ? 'text' : 'password'}
                      value={item.value}
                      onChange={(e) => {
                        const next = [...envVars];
                        next[idx].value = e.target.value;
                        setEnvVars(next);
                      }}
                      placeholder="VALUE"
                      className="w-full pl-3 pr-9 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg text-white"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const next = [...envVars];
                        next[idx].visible = !next[idx].visible;
                        setEnvVars(next);
                      }}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      {item.visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEnvVars(envVars.filter((_, i) => i !== idx))}
                    className="p-2 text-slate-500 hover:text-rose-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                className="px-5 py-2.5 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                Save Configuration & Env Vars
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Confirmation Dialog for Destructive Actions */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h3 className="text-base font-semibold text-white capitalize">
                Confirm {confirmAction.replace('_', ' ')}?
              </h3>
            </div>
            <p className="text-sm text-slate-300">
              {confirmAction === 'delete'
                ? `This will permanently delete bot "${bot.name}", terminate its OS process, and erase its workspace files.`
                : confirmAction === 'stop'
                ? `This will send SIGTERM to stop "${bot.name}". Active WhatsApp messages will pause until started again.`
                : confirmAction === 'disconnect_wa'
                ? `This will unlink the current WhatsApp session for "${bot.name}".`
                : `Are you sure you want to ${confirmAction} "${bot.name}"?`}
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeConfirmedAction}
                className={`px-4 py-2 text-xs font-medium rounded-lg text-white ${
                  confirmAction === 'delete'
                    ? 'bg-rose-600 hover:bg-rose-500'
                    : 'bg-cyan-600 hover:bg-cyan-500'
                }`}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      <GoogleDriveModal
        isOpen={driveOpen}
        onClose={() => setDriveOpen(false)}
        onSelectFileContent={(fileName, content) => {
          setSelectedFile(fileName);
          setFileContent(content);
        }}
      />
    </div>
  );
};
