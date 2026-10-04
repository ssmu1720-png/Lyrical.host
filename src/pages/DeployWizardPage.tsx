import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Rocket,
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Copy,
  Check,
  CheckCircle2,
  AlertCircle,
  User as UserIcon,
  Server,
  GitBranch,
  Lock,
  Search,
  RefreshCw,
  Cloud as FolderCloud,
} from 'lucide-react';
import { apiRequest, Bot, Deployment } from '../lib/api';
import {
  syncBotDocumentToFirestore,
  githubSignIn,
  listUserGithubRepos,
  getGithubAccessToken,
  getConnectedGithubUser,
  GithubRepoItem,
} from '../lib/workspaceAuth';
import { BOT_CATALOG, CatalogBotItem } from '../lib/botCatalog';
import { TerminalLogViewer } from '../components/TerminalLogViewer';
import { GoogleDriveModal } from '../components/GoogleDriveModal';

export const DeployWizardPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const preselectedBotId = searchParams.get('bot');

  const [selectedBot, setSelectedBot] = useState<CatalogBotItem | null>(() => {
    if (!preselectedBotId) return null;
    return BOT_CATALOG.find((b) => b.id === preselectedBotId) || null;
  });

  // Configuration form fields matching the screenshot layout
  const [sessionId, setSessionId] = useState('');
  const [deviceMode, setDeviceMode] = useState('Android');
  const [ownerNumber, setOwnerNumber] = useState('');
  const [botInstanceName, setBotInstanceName] = useState('');
  const [customRepoUrl, setCustomRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [prefix, setPrefix] = useState('.');
  const [copiedUrl, setCopiedUrl] = useState(false);

  // GitHub OAuth & Repository Browser State
  const [githubConnectedUser, setGithubConnectedUser] = useState<{
    login: string;
    avatar_url?: string;
  } | null>(() => getConnectedGithubUser());
  const [githubRepos, setGithubRepos] = useState<GithubRepoItem[]>([]);
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [repoSearch, setRepoSearch] = useState('');
  const [showGithubPicker, setShowGithubPicker] = useState(false);

  // Advanced / Google Drive source files
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [startCommand, setStartCommand] = useState('npm start');
  const [buildCommand, setBuildCommand] = useState('npm install');
  const [initialFiles, setInitialFiles] = useState<{ path: string; content: string }[]>([]);
  const [driveModalOpen, setDriveModalOpen] = useState(false);

  // Deployment Execution state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deployedBot, setDeployedBot] = useState<Bot | null>(null);
  const [activeDeployment, setActiveDeployment] = useState<Deployment | null>(null);

  useEffect(() => {
    if (selectedBot) {
      setBotInstanceName(selectedBot.name);
      if (selectedBot.repoUrl) {
        setCustomRepoUrl(selectedBot.repoUrl);
      }
      setBranch(selectedBot.branch || 'main');
      setStartCommand(selectedBot.startCommand || 'npm start');
      setBuildCommand(selectedBot.buildCommand || 'npm install');
    }
  }, [selectedBot]);

  // Poll live deployment status once deployed
  useEffect(() => {
    if (!activeDeployment) return;
    const poll = setInterval(async () => {
      try {
        const res = await apiRequest<{ deployment: Deployment; bot: Bot }>(
          `/api/deployments/${activeDeployment.id}`
        );
        setActiveDeployment(res.deployment);
        if (res.bot) setDeployedBot(res.bot);
      } catch {
        // ignore poll error
      }
    }, 1500);
    return () => clearInterval(poll);
  }, [activeDeployment?.id]);

  const handleConnectGithub = async () => {
    setGithubLoading(true);
    setGithubError(null);
    try {
      const authRes = await githubSignIn();
      setGithubConnectedUser({ login: authRes.githubUsername });
      const repos = await listUserGithubRepos();
      setGithubRepos(repos);
      setShowGithubPicker(true);
    } catch (err: any) {
      if (err?.code === 'auth/operation-not-allowed') {
        setGithubError(
          'To connect GitHub via Firebase Auth: enable the GitHub provider in Firebase Console → Authentication → Sign-in method → GitHub.'
        );
      } else {
        setGithubError(err.message || 'Could not connect GitHub repositories.');
      }
    } finally {
      setGithubLoading(false);
    }
  };

  const handleRefreshGithubRepos = async () => {
    if (!getGithubAccessToken()) {
      await handleConnectGithub();
      return;
    }
    setGithubLoading(true);
    setGithubError(null);
    try {
      const repos = await listUserGithubRepos();
      setGithubRepos(repos);
      setShowGithubPicker(true);
    } catch {
      await handleConnectGithub();
    } finally {
      setGithubLoading(false);
    }
  };

  const handleSelectGithubRepo = (repo: GithubRepoItem) => {
    const customBotTemplate =
      BOT_CATALOG.find((b) => b.id === 'custom-github-bot') || BOT_CATALOG[0];
    if (!selectedBot) {
      setSelectedBot({
        ...customBotTemplate,
        name: repo.name,
        author: repo.full_name.split('/')[0] || 'GitHub',
        description: repo.description || `Deployed from GitHub repository ${repo.full_name}`,
        repoUrl: repo.clone_url.replace(/\.git$/, ''),
        branch: repo.default_branch || 'main',
      });
      setSearchParams({ bot: 'custom-github-bot' });
    }
    setBotInstanceName(repo.name);
    setCustomRepoUrl(repo.clone_url.replace(/\.git$/, ''));
    setBranch(repo.default_branch || 'main');
    setShowGithubPicker(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectBot = (bot: CatalogBotItem) => {
    setSelectedBot(bot);
    setSearchParams({ bot: bot.id });
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBackToSelection = () => {
    setSelectedBot(null);
    setDeployedBot(null);
    setActiveDeployment(null);
    setSearchParams({});
    setError(null);
  };

  const handleCopySessionUrl = (url: string) => {
    navigator.clipboard.writeText(url || window.location.origin);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBot) return;

    if (!ownerNumber.trim()) {
      setError('Please enter your WhatsApp OWNER_NUMBER (e.g. 254712345678).');
      return;
    }

    const targetRepo =
      selectedBot.id === 'custom-github-bot' || customRepoUrl.trim()
        ? customRepoUrl.trim() || selectedBot.repoUrl
        : selectedBot.repoUrl;

    if (!targetRepo && initialFiles.length === 0) {
      setError('Please provide a valid GitHub Repository URL or connect your GitHub account.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const ghToken = getGithubAccessToken();
      const envPayload = [
        { key: 'SESSION_ID', value: sessionId.trim() },
        { key: 'SESSION', value: sessionId.trim() },
        { key: 'DEVICE_MODE', value: deviceMode.trim() || 'Android' },
        { key: 'OWNER_NUMBER', value: ownerNumber.replace(/[^0-9]/g, '') },
        { key: 'PREFIX', value: prefix.trim() || '.' },
        { key: 'MODE', value: 'public' },
        ...(ghToken ? [{ key: 'GITHUB_TOKEN', value: ghToken }] : []),
      ];

      // Assign a dynamic safe port in 4100-4899 range to prevent EADDRINUSE on 8080
      const dynamicSafePort = 4100 + Math.floor(Math.random() * 750);

      const res = await apiRequest<{ bot: Bot; deployment: Deployment }>('/api/bots/deploy', {
        method: 'POST',
        body: JSON.stringify({
          name: (botInstanceName || selectedBot.name).trim(),
          description: selectedBot.description,
          runtime: 'nodejs',
          repoUrl: targetRepo,
          branch: branch || 'main',
          startCommand: startCommand || 'npm start',
          buildCommand: buildCommand || 'npm install',
          port: dynamicSafePort,
          region: 'eu-west-2 (London)',
          whatsappAuthMethod: 'pairing_code',
          whatsappPhone: ownerNumber.replace(/[^0-9]/g, ''),
          envVars: envPayload,
          initialFiles,
        }),
      });

      setDeployedBot(res.bot);
      setActiveDeployment(res.deployment);
      syncBotDocumentToFirestore(res.bot).catch(() => {});
    } catch (err: any) {
      setError(err.message || 'Deployment failed. Check your configuration and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredGithubRepos = githubRepos.filter(
    (r) =>
      r.full_name.toLowerCase().includes(repoSearch.toLowerCase()) ||
      (r.description || '').toLowerCase().includes(repoSearch.toLowerCase())
  );

  // VIEW 3: LIVE DEPLOYMENT PROGRESS & TERMINAL STREAM
  if (deployedBot && activeDeployment) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handleBackToSelection}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-medium text-slate-300 hover:text-white"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Bot Selection
          </button>

          <button
            type="button"
            onClick={() => navigate(`/bots/${deployedBot.id}`)}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-500 transition-colors"
          >
            Open Bot Control Panel →
          </button>
        </div>

        <div className="p-6 rounded-xl border border-slate-800 bg-[#0d1526] space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <CheckCircle2
                  className={`w-5 h-5 ${
                    activeDeployment.status === 'success'
                      ? 'text-emerald-400'
                      : activeDeployment.status === 'failed'
                      ? 'text-rose-400'
                      : 'text-cyan-400 animate-spin'
                  }`}
                />
                <h2 className="text-lg font-bold text-white">
                  Deployment Status: {activeDeployment.status.toUpperCase()}
                </h2>
              </div>
              <div className="text-xs font-mono text-slate-400 mt-1 flex flex-wrap items-center gap-2">
                <span>Bot: {deployedBot.name}</span>
                <span>·</span>
                <span>ID: {deployedBot.id}</span>
                <span>·</span>
                <span>Container Port: {deployedBot.port}</span>
                {deployedBot.pid && (
                  <>
                    <span>·</span>
                    <span className="text-emerald-400">OS PID: {deployedBot.pid}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {activeDeployment.errorMessage && (
            <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200 font-mono">
              {activeDeployment.errorMessage}
            </div>
          )}
        </div>

        <TerminalLogViewer
          botId={deployedBot.id}
          botName={deployedBot.name}
          isRunning={deployedBot.status === 'running'}
          fullHeight
        />
      </div>
    );
  }

  // VIEW 2: SELECTED BOT CONFIGURATION PAGE (Matches Screenshot 1, 100% Free Hosting)
  if (selectedBot) {
    return (
      <div className="max-w-2xl mx-auto space-y-5">
        {/* Top Back Navigation */}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleBackToSelection}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#0d1526] border border-slate-800 text-xs font-medium text-slate-300 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Bot Selection
          </button>

          <button
            type="button"
            onClick={handleRefreshGithubRepos}
            disabled={githubLoading}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[#24292F] hover:bg-[#2c3239] border border-slate-700 text-xs font-semibold text-white transition-colors"
          >
            <GitBranch className="w-3.5 h-3.5 text-cyan-400" />
            {githubConnectedUser
              ? `GitHub: @${githubConnectedUser.login} (Browse Repos)`
              : githubLoading
              ? 'Connecting GitHub...'
              : 'Connect GitHub Repo'}
          </button>
        </div>

        {githubError && (
          <div className="p-3.5 rounded-xl bg-amber-950/60 border border-amber-500/40 text-xs text-amber-200 flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{githubError}</span>
          </div>
        )}

        {/* Connected GitHub Repository Picker Drawer */}
        {showGithubPicker && (
          <div className="p-4 rounded-xl bg-[#0d1526] border border-cyan-500/40 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-white flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-cyan-400" />
                Select a GitHub Repository ({githubRepos.length} available)
              </div>
              <button
                type="button"
                onClick={() => setShowGithubPicker(false)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={repoSearch}
                onChange={(e) => setRepoSearch(e.target.value)}
                placeholder="Filter your GitHub repositories..."
                className="w-full pl-8 pr-3 py-2 text-xs bg-[#070b14] border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="max-h-56 overflow-y-auto divide-y divide-slate-800/80 border border-slate-800 rounded-lg">
              {filteredGithubRepos.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">
                  No matching repositories found in your GitHub account.
                </div>
              ) : (
                filteredGithubRepos.map((repo) => (
                  <div
                    key={repo.id}
                    className="p-3 flex items-center justify-between gap-3 hover:bg-slate-900/70 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white truncate">
                          {repo.full_name}
                        </span>
                        {repo.private && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[10px] font-mono">
                            <Lock className="w-2.5 h-2.5" /> Private
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate mt-0.5">
                        Branch: {repo.default_branch} · {repo.description || 'No description'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSelectGithubRepo(repo)}
                      className="px-3 py-1.5 rounded-lg bg-cyan-500 text-slate-950 text-xs font-semibold hover:bg-cyan-400 shrink-0"
                    >
                      Use Repo
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Selected Bot Summary Banner */}
        <div className="p-4 rounded-xl bg-[#0d1526] border border-slate-800/90 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <img
              src={selectedBot.image}
              alt={selectedBot.name}
              referrerPolicy="no-referrer"
              className="w-12 h-12 rounded-lg object-cover border border-slate-700 shrink-0"
            />
            <div className="min-w-0">
              <h1 className="text-base font-bold text-white truncate">{selectedBot.name}</h1>
              <p className="text-xs text-slate-400 truncate">by {selectedBot.author}</p>
            </div>
          </div>

          <div className="text-right shrink-0">
            <div className="text-sm font-bold text-emerald-400 font-mono">FREE HOSTING</div>
            <div className="text-[11px] text-slate-400">Unlimited Runtime · 0.00 KSH</div>
          </div>
        </div>

        {/* Need a Session ID Card */}
        <div className="p-4 rounded-xl bg-[#0d1526] border border-slate-800/90 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <ExternalLink className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white">Need a Session ID?</div>
              <div className="text-[11px] text-slate-400">
                Get your WhatsApp Session ID or leave blank to use direct Phone Pairing Code
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            {selectedBot.sessionGeneratorUrl && (
              <a
                href={selectedBot.sessionGeneratorUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Get Session ID
              </a>
            )}
            <button
              type="button"
              onClick={() => handleCopySessionUrl(selectedBot.sessionGeneratorUrl)}
              className="p-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-white transition-colors"
              title="Copy Session URL"
            >
              {copiedUrl ? (
                <Check className="w-4 h-4 text-emerald-400" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200 flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Required Configuration Card */}
        <form onSubmit={handleDeploy} className="space-y-5">
          <div className="p-5 rounded-xl bg-[#0d1526] border border-slate-800/90 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <span className="text-rose-400">*</span> Required Configuration
              </div>
              <span className="text-[11px] font-medium text-rose-400">Required</span>
            </div>

            {(selectedBot.id === 'custom-github-bot' || showAdvanced) && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-bold text-white">
                    GITHUB_REPO_URL <span className="text-rose-400">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={handleRefreshGithubRepos}
                    className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1"
                  >
                    <GitBranch className="w-3 h-3" />
                    {githubConnectedUser ? 'Choose from my GitHub repos' : 'Connect GitHub OAuth'}
                  </button>
                </div>
                <input
                  type="url"
                  required={selectedBot.id === 'custom-github-bot'}
                  value={customRepoUrl}
                  onChange={(e) => setCustomRepoUrl(e.target.value)}
                  placeholder="https://github.com/username/whatsapp-bot"
                  className="w-full px-3.5 py-2.5 text-xs font-mono bg-[#070b14] border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Repository URL to clone ({branch} branch)
                </p>
              </div>
            )}

            {/* SESSION */}
            <div>
              <label className="block text-xs font-bold text-white mb-1.5">
                SESSION <span className="text-rose-400">*</span>
              </label>
              <textarea
                rows={3}
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                placeholder="Paste your session ID here (or leave blank to generate a live 8-digit Pairing Code after deploy)"
                className="w-full px-3.5 py-2.5 text-xs font-mono bg-[#070b14] border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Add your session ID here, or leave empty to pair directly via phone number
              </p>
            </div>

            {/* DEVICE_MODE */}
            <div>
              <label className="block text-xs font-bold text-white mb-1.5">
                DEVICE_MODE <span className="text-rose-400">*</span>
              </label>
              <select
                value={deviceMode}
                onChange={(e) => setDeviceMode(e.target.value)}
                className="w-full px-3.5 py-2.5 text-xs font-mono bg-[#070b14] border border-slate-800 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                <option value="Android">Android</option>
                <option value="iPhone">iPhone</option>
                <option value="Web">Web / Desktop</option>
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                Device mode: iPhone (plain text) or Android (full features with buttons)
              </p>
            </div>

            {/* OWNER_NUMBER */}
            <div>
              <label className="block text-xs font-bold text-white mb-1.5">
                OWNER_NUMBER <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                value={ownerNumber}
                onChange={(e) => setOwnerNumber(e.target.value)}
                placeholder="254712345678"
                className="w-full px-3.5 py-2.5 text-xs font-mono bg-[#070b14] border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Put any phone numbers you want to be bot owner without + or spaces. Ex: 254712345678
              </p>
            </div>

            {/* Optional Advanced Toggle */}
            <div className="pt-2 border-t border-slate-800/80">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-xs text-cyan-400 hover:underline font-medium"
              >
                {showAdvanced
                  ? 'Hide Advanced Settings (Instance Name, Repo Override, Google Drive)'
                  : 'Show Advanced Settings (Instance Name, Repo Override, Google Drive)'}
              </button>

              {showAdvanced && (
                <div className="mt-4 space-y-4 pt-3 border-t border-slate-800/60">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Bot Instance Name
                      </label>
                      <input
                        type="text"
                        value={botInstanceName}
                        onChange={(e) => setBotInstanceName(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-[#070b14] border border-slate-800 rounded-lg text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">
                        Command Prefix
                      </label>
                      <input
                        type="text"
                        value={prefix}
                        onChange={(e) => setPrefix(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono bg-[#070b14] border border-slate-800 rounded-lg text-white"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-3 rounded-lg bg-[#070b14] border border-slate-800">
                    <span className="text-xs text-slate-300">
                      Import custom config or scripts from Google Drive
                    </span>
                    <button
                      type="button"
                      onClick={() => setDriveModalOpen(true)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/25 flex items-center gap-1.5"
                    >
                      <FolderCloud className="w-3.5 h-3.5" />
                      Browse Drive
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Free Hosting Summary Box */}
          <div className="p-5 rounded-xl bg-[#0d1526] border border-slate-800/90 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-white">LYRICAL Cloud Hosting Access</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Instant container deployment · Automatic Port Isolation · Real-time logs
                </div>
              </div>
              <div className="text-right font-mono">
                <div className="text-sm font-bold text-emerald-400">FREE</div>
                <div className="text-[11px] text-slate-500">0.00 KSH</div>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 px-5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
            >
              <Rocket className="w-4 h-4" />
              {submitting ? 'Deploying Bot Container...' : `Deploy ${selectedBot.name} Now (Free)`}
            </button>
          </div>
        </form>

        <GoogleDriveModal
          isOpen={driveModalOpen}
          onClose={() => setDriveModalOpen(false)}
          onSelectFileContent={(fileName, content) => {
            setInitialFiles((prev) => [
              ...prev.filter((f) => f.path !== fileName),
              { path: fileName, content },
            ]);
          }}
        />
      </div>
    );
  }

  // VIEW 1: AVAILABLE BOTS CATALOG GRID + GITHUB OAUTH REPOSITORY CONNECTOR
  return (
    <div className="space-y-8">
      {/* Top Feature Banner */}
      <div className="p-6 rounded-2xl bg-[#0d1526] border border-slate-800/90 text-center space-y-4">
        <h1 className="text-xl sm:text-2xl font-bold text-white">
          LYRICAL Quantum WhatsApp Bot Hosting
        </h1>
        <p className="text-xs sm:text-sm text-slate-400 max-w-xl mx-auto">
          Select a pre-configured multi-device WhatsApp bot below or connect your GitHub account via Firebase Authentication for instant deployment.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-emerald-400 font-medium">
          <span>✓ Instant Deployment</span>
          <span className="text-slate-600">·</span>
          <span>✓ Auto Port Isolation</span>
          <span className="text-slate-600">·</span>
          <span>✓ 100% Free Hosting</span>
        </div>

        {/* GitHub OAuth Connect Bar */}
        <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={handleRefreshGithubRepos}
            disabled={githubLoading}
            className="px-4 py-2 rounded-xl bg-[#24292F] hover:bg-[#2c3239] border border-slate-700 text-xs font-semibold text-white inline-flex items-center gap-2 transition-colors"
          >
            <GitBranch className="w-4 h-4 text-cyan-400" />
            {githubConnectedUser
              ? `Connected to GitHub (@${githubConnectedUser.login}) — Browse My Repositories`
              : githubLoading
              ? 'Connecting to GitHub via Firebase...'
              : 'Connect GitHub Account to Deploy Your Repositories'}
          </button>
        </div>
      </div>

      {githubError && (
        <div className="p-4 rounded-xl bg-amber-950/60 border border-amber-500/40 text-xs text-amber-200 flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{githubError}</span>
        </div>
      )}

      {/* Connected GitHub Repositories Browser Drawer */}
      {showGithubPicker && (
        <div className="p-5 rounded-2xl bg-[#0d1526] border border-cyan-500/40 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-cyan-400" />
                Your Connected GitHub Repositories ({githubRepos.length})
              </h3>
              <p className="text-xs text-slate-400">
                Select any repository below to configure and deploy it directly to a LYRICAL container
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRefreshGithubRepos}
                className="p-2 rounded-lg border border-slate-800 text-slate-300 hover:text-white"
                title="Refresh Repositories"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${githubLoading ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => setShowGithubPicker(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-800 text-xs text-slate-400 hover:text-white"
              >
                Hide
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={repoSearch}
              onChange={(e) => setRepoSearch(e.target.value)}
              placeholder="Search your repositories by name or description..."
              className="w-full pl-9 pr-4 py-2 text-xs bg-[#070b14] border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
            {filteredGithubRepos.map((repo) => (
              <div
                key={repo.id}
                className="p-3.5 rounded-xl bg-[#070b14] border border-slate-800 hover:border-cyan-500/40 flex items-center justify-between gap-3 transition-colors"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white truncate">{repo.full_name}</span>
                    {repo.private && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[10px] font-mono">
                        Private
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 truncate mt-0.5">
                    {repo.description || 'WhatsApp Bot Repository'} · Branch: {repo.default_branch}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleSelectGithubRepo(repo)}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shrink-0"
                >
                  Deploy Repo
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Available Bots Section */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-white">Available Bots</h2>
          <p className="text-xs text-slate-400">
            {BOT_CATALOG.length} bots ready for instant free deployment
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {BOT_CATALOG.map((bot) => (
            <div
              key={bot.id}
              className="rounded-2xl bg-[#0d1526] border border-slate-800/90 overflow-hidden flex flex-col justify-between hover:border-blue-500/50 transition-all group"
            >
              <div>
                {/* Artwork Container */}
                <div className="relative aspect-[4/3] w-full bg-slate-950 overflow-hidden">
                  <img
                    src={bot.image}
                    alt={bot.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0d1526] via-transparent to-black/40" />

                  {/* Top Left Rank & Top Right Deploy Count */}
                  <div className="absolute top-3 left-3 right-3 flex items-center justify-between text-xs font-mono font-bold">
                    <span className="px-2 py-0.5 rounded bg-amber-500 text-slate-950">
                      #{bot.rank}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-950/80 text-slate-200 tabular-nums">
                      {bot.deploymentsCount}
                    </span>
                  </div>

                  {/* Featured Ribbon */}
                  {bot.featuredLabel && (
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 py-1 text-center text-[10px] font-extrabold tracking-wider text-white uppercase">
                      {bot.featuredLabel}
                    </div>
                  )}
                </div>

                {/* Card Body */}
                <div className="p-4 space-y-2">
                  <h3 className="text-base font-bold text-white">{bot.name}</h3>
                  <div className="text-xs text-slate-400 flex items-center gap-1.5">
                    <UserIcon className="w-3.5 h-3.5 text-slate-500" />
                    <span>{bot.author}</span>
                  </div>
                  <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed pt-1">
                    {bot.description}
                  </p>
                </div>
              </div>

              {/* Card Footer: Free Badge + Deploy Button */}
              <div className="px-4 py-3.5 border-t border-slate-800/80 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-emerald-400">
                  <Server className="w-3.5 h-3.5" />
                  <span>FREE</span>
                  <span className="text-[10px] font-normal text-slate-400">0.00 KSH</span>
                </div>

                <button
                  type="button"
                  onClick={() => handleSelectBot(bot)}
                  className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                >
                  <span>Deploy</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
