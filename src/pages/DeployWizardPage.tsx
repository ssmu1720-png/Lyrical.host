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
  Globe,
  Star,
  LogOut,
  Code,
  Sparkles,
  Layers,
} from 'lucide-react';
import { apiRequest, Bot, Deployment } from '../lib/api';
import {
  syncBotDocumentToFirestore,
  githubSignIn,
  listUserGithubRepos,
  getGithubAccessToken,
  getConnectedGithubUser,
  checkGithubStatus,
  disconnectGithub,
  GithubRepoItem,
} from '../lib/workspaceAuth';
import { BOT_CATALOG, WEBSITE_CATALOG, CatalogBotItem } from '../lib/botCatalog';
import { TerminalLogViewer } from '../components/TerminalLogViewer';
import { GoogleDriveModal } from '../components/GoogleDriveModal';
import { GithubConnectModal } from '../components/GithubConnectModal';

export const DeployWizardPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const preselectedBotId = searchParams.get('bot');

  const [activeCatalogTab, setActiveCatalogTab] = useState<'bots' | 'websites'>('bots');

  const [selectedBot, setSelectedBot] = useState<CatalogBotItem | null>(() => {
    if (!preselectedBotId) return null;
    return (
      BOT_CATALOG.find((b) => b.id === preselectedBotId) ||
      WEBSITE_CATALOG.find((b) => b.id === preselectedBotId) ||
      null
    );
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
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [selectedLangFilter, setSelectedLangFilter] = useState('ALL');
  const [importedBanner, setImportedBanner] = useState<{
    repoName: string;
    branch: string;
    isPrivate: boolean;
  } | null>(null);

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

  // Initial mount: load connected GitHub status & repos
  useEffect(() => {
    checkGithubStatus().then(async (status) => {
      if (status.connected && status.user) {
        setGithubConnectedUser(status.user);
        try {
          const repos = await listUserGithubRepos();
          setGithubRepos(repos);
        } catch {}
      }
    });

    if (searchParams.get('connect') === 'github') {
      setShowGithubPicker(true);
    }
  }, []);

  const handleCustomRepoUrlChange = (url: string) => {
    setCustomRepoUrl(url);
    const isCustom =
      !selectedBot ||
      selectedBot.id === 'custom-github-bot' ||
      selectedBot.id === 'custom-git-website';
    if (
      isCustom &&
      (!botInstanceName ||
        botInstanceName === 'Custom GitHub Bot' ||
        botInstanceName === 'Custom Git Repository Website')
    ) {
      const match = url.trim().match(/\/([^/]+?)(?:\.git|\/)?$/);
      if (match && match[1]) {
        const cleanName = match[1]
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());
        setBotInstanceName(cleanName);
      }
    }
  };

  useEffect(() => {
    if (selectedBot) {
      if (selectedBot.id === 'custom-github-bot' || selectedBot.id === 'custom-git-website') {
        if (
          !botInstanceName ||
          botInstanceName === 'Custom GitHub Bot' ||
          botInstanceName === 'Custom Git Repository Website'
        ) {
          setBotInstanceName('');
        }
      } else {
        setBotInstanceName(selectedBot.name);
      }
      if (selectedBot.repoUrl) {
        setCustomRepoUrl(selectedBot.repoUrl);
      }
      setBranch(selectedBot.branch || 'main');
      setStartCommand(
        selectedBot.startCommand ||
          (selectedBot.category === 'website' ? 'node server.js' : 'npm start')
      );
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
      if (!authRes) return;
      setGithubConnectedUser({ login: authRes.githubUsername });
      const repos = await listUserGithubRepos();
      setGithubRepos(repos);
      setShowGithubPicker(true);
    } catch (err: any) {
      if (err?.code === 'OAUTH_NOT_CONFIGURED') {
        setConnectModalOpen(true);
      } else {
        setGithubError(err.message || 'Could not connect GitHub repositories.');
      }
    } finally {
      setGithubLoading(false);
    }
  };

  const handleRefreshGithubRepos = async () => {
    if (!githubConnectedUser && !getGithubAccessToken()) {
      setConnectModalOpen(true);
      return;
    }
    setGithubLoading(true);
    setGithubError(null);
    try {
      const repos = await listUserGithubRepos();
      setGithubRepos(repos);
      setShowGithubPicker(true);
    } catch {
      setConnectModalOpen(true);
    } finally {
      setGithubLoading(false);
    }
  };

  const handleSelectGithubRepo = (
    repo: GithubRepoItem,
    targetCategory: 'bot' | 'website' = 'bot'
  ) => {
    const isWeb =
      targetCategory === 'website' ||
      (!repo.name.toLowerCase().includes('bot') &&
        (repo.language === 'HTML' ||
          repo.language === 'CSS' ||
          repo.language === 'Vue' ||
          repo.language === 'PHP'));

    if (isWeb) {
      const customWebsiteTemplate =
        WEBSITE_CATALOG.find((w) => w.id === 'custom-git-website') || WEBSITE_CATALOG[0];
      setSelectedBot({
        ...customWebsiteTemplate,
        name: repo.name,
        author: repo.full_name.split('/')[0] || 'GitHub',
        description: repo.description || `Website deployed from GitHub repository ${repo.full_name}`,
        repoUrl: repo.clone_url.replace(/\.git$/, ''),
        branch: repo.default_branch || 'main',
        startCommand: repo.language === 'Python' ? 'python app.py' : 'node server.js',
        buildCommand:
          repo.language === 'Python' ? 'pip install -r requirements.txt' : 'npm install',
      });
      setSearchParams({ bot: 'custom-git-website' });
      setActiveCatalogTab('websites');
    } else {
      const customBotTemplate =
        BOT_CATALOG.find((b) => b.id === 'custom-github-bot') || BOT_CATALOG[0];
      setSelectedBot({
        ...customBotTemplate,
        name: repo.name,
        author: repo.full_name.split('/')[0] || 'GitHub',
        description: repo.description || `Deployed from GitHub repository ${repo.full_name}`,
        repoUrl: repo.clone_url.replace(/\.git$/, ''),
        branch: repo.default_branch || 'main',
        startCommand: 'npm start',
        buildCommand: 'npm install',
      });
      setSearchParams({ bot: 'custom-github-bot' });
      setActiveCatalogTab('bots');
    }

    setBotInstanceName(repo.name);
    setCustomRepoUrl(repo.clone_url.replace(/\.git$/, ''));
    setBranch(repo.default_branch || 'main');
    setImportedBanner({
      repoName: repo.full_name,
      branch: repo.default_branch || 'main',
      isPrivate: repo.private,
    });
    setShowGithubPicker(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDisconnect = async () => {
    await disconnectGithub();
    setGithubConnectedUser(null);
    setGithubRepos([]);
    setShowGithubPicker(false);
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

    const isWebsite = selectedBot.category === 'website';

    if (!isWebsite && !ownerNumber.trim()) {
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
      const envPayload = isWebsite
        ? [
            { key: 'NODE_ENV', value: 'production' },
            ...(ghToken ? [{ key: 'GITHUB_TOKEN', value: ghToken }] : []),
          ]
        : [
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
      const isPython = selectedBot.id === 'python-flask-website' || targetRepo.toLowerCase().includes('python');

      const res = await apiRequest<{ bot: Bot; deployment: Deployment }>('/api/bots/deploy', {
        method: 'POST',
        body: JSON.stringify({
          name: (botInstanceName || selectedBot.name).trim(),
          description: selectedBot.description,
          category: isWebsite ? 'website' : 'whatsapp_bot',
          runtime: isPython ? 'python' : 'nodejs',
          repoUrl: targetRepo,
          branch: branch || 'main',
          startCommand: startCommand || (isWebsite ? 'node server.js' : 'npm start'),
          buildCommand: buildCommand || (isWebsite ? 'npm install' : 'npm install'),
          port: dynamicSafePort,
          region: 'eu-west-2 (London)',
          whatsappAuthMethod: 'pairing_code',
          whatsappPhone: isWebsite ? '' : ownerNumber.replace(/[^0-9]/g, ''),
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
                <span>Instance: {deployedBot.name}</span>
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

            <div className="flex items-center gap-2">
              <a
                href={`/live/${deployedBot.id}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-500 text-slate-950 hover:bg-emerald-400 transition-colors inline-flex items-center gap-1.5 shadow-sm"
              >
                <Globe className="w-3.5 h-3.5" />
                Open Live Website ↗
              </a>
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-cyan-950/40 border border-cyan-500/30 text-xs text-cyan-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-cyan-400 shrink-0" />
              <span>Live Website Proxy URL: <code className="px-2 py-0.5 rounded bg-slate-900 text-white font-mono">{window.location.origin}/live/{deployedBot.id}/</code></span>
            </div>
            <button
              type="button"
              onClick={() => handleCopySessionUrl(`${window.location.origin}/live/${deployedBot.id}/`)}
              className="px-2.5 py-1 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-white text-xs inline-flex items-center gap-1"
            >
              {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              Copy URL
            </button>
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
            Back to Selection
          </button>

          <div className="flex items-center gap-2">
            {githubConnectedUser && (
              <button
                type="button"
                onClick={handleDisconnect}
                className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-rose-400 text-xs transition-colors"
                title="Disconnect GitHub Account"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={handleRefreshGithubRepos}
              disabled={githubLoading}
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-[#24292F] hover:bg-[#2c3239] border border-slate-700 text-xs font-semibold text-white transition-colors"
            >
              <GitBranch className="w-3.5 h-3.5 text-cyan-400" />
              {githubConnectedUser
                ? `GitHub: @${githubConnectedUser.login} (${githubRepos.length} Repos)`
                : githubLoading
                ? 'Connecting GitHub...'
                : 'Connect GitHub'}
            </button>
          </div>
        </div>

        {/* Imported Repository Status Banner */}
        {importedBanner && (
          <div className="p-3.5 rounded-xl bg-gradient-to-r from-emerald-950/70 to-slate-900 border border-emerald-500/40 text-xs text-emerald-300 flex items-center justify-between gap-3 shadow-sm animate-in fade-in">
            <div className="flex items-center gap-2 min-w-0">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="truncate">
                Imported from GitHub: <strong className="text-white font-mono">{importedBanner.repoName}</strong> (Branch: {importedBanner.branch})
                {importedBanner.isPrivate && (
                  <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-mono">
                    Private
                  </span>
                )}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setImportedBanner(null)}
              className="text-[11px] text-slate-400 hover:text-white px-2 py-0.5 rounded border border-slate-800 shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

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
                Select a GitHub Repository to Import ({githubRepos.length} available)
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRefreshGithubRepos}
                  className="p-1.5 rounded-lg border border-slate-800 text-slate-400 hover:text-white text-xs"
                  title="Refresh Repositories"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${githubLoading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setShowGithubPicker(false)}
                  className="text-xs text-slate-400 hover:text-white px-2 py-0.5 rounded border border-slate-800"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={repoSearch}
                onChange={(e) => setRepoSearch(e.target.value)}
                placeholder="Filter repositories by name or description..."
                className="w-full pl-8 pr-3 py-2 text-xs bg-[#070b14] border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>

            {/* Language Filter Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[11px]">
              {['ALL', 'TypeScript', 'JavaScript', 'Python', 'Other'].map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setSelectedLangFilter(lang)}
                  className={`px-2.5 py-0.5 rounded-full transition-colors whitespace-nowrap ${
                    selectedLangFilter === lang
                      ? 'bg-cyan-500 text-slate-950 font-bold'
                      : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {lang}
                </button>
              ))}
            </div>

            <div className="max-h-64 overflow-y-auto divide-y divide-slate-800/80 border border-slate-800 rounded-lg">
              {filteredGithubRepos.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">
                  No matching repositories found.
                </div>
              ) : (
                filteredGithubRepos.map((repo) => (
                  <div
                    key={repo.id}
                    className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-900/70 transition-colors"
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
                        {repo.language && (
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                            {repo.language}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate mt-0.5">
                        Branch: {repo.default_branch} · {repo.description || 'No description provided'}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleSelectGithubRepo(repo, 'bot')}
                        className="px-2.5 py-1 rounded-lg bg-blue-600/90 hover:bg-blue-600 text-white text-[11px] font-semibold"
                        title="Import as WhatsApp Bot"
                      >
                        Deploy Bot
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSelectGithubRepo(repo, 'website')}
                        className="px-2.5 py-1 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-[11px] font-bold"
                        title="Import as Website or Web App"
                      >
                        Deploy Website
                      </button>
                    </div>
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

        {/* Need a Session ID Card (Only for WhatsApp Bots) */}
        {selectedBot.category !== 'website' && (
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
        )}

        {/* Website Overview Banner (For Websites) */}
        {selectedBot.category === 'website' && (
          <div className="p-4 rounded-xl bg-cyan-950/30 border border-cyan-500/30 flex items-center gap-3">
            <Globe className="w-5 h-5 text-cyan-400 shrink-0" />
            <div className="text-xs text-slate-300">
              <strong className="text-white">Web Application Hosting:</strong> Your website will be built, assigned an isolated port, and given an instant reverse proxy URL (<code>/live/:id/</code>) with full HTTP and asset support.
            </div>
          </div>
        )}

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
                <span className="text-rose-400">*</span> {selectedBot.category === 'website' ? 'Website Configuration' : 'Required Configuration'}
              </div>
              <span className="text-[11px] font-medium text-rose-400">Required</span>
            </div>

            {/* Instance Name */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-white flex items-center gap-1.5">
                  <span>
                    {selectedBot.id === 'custom-github-bot' || selectedBot.id === 'custom-git-website'
                      ? 'Custom Repository / Project Name'
                      : selectedBot.category === 'website'
                      ? 'Website / Service Name'
                      : 'Bot Instance Name'}
                  </span>
                  <span className="text-rose-400">*</span>
                </label>
                {(selectedBot.id === 'custom-github-bot' || selectedBot.id === 'custom-git-website') && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                    Custom Name Allowed
                  </span>
                )}
              </div>
              <input
                type="text"
                required
                value={botInstanceName}
                onChange={(e) => setBotInstanceName(e.target.value)}
                placeholder={
                  selectedBot.id === 'custom-github-bot' || selectedBot.id === 'custom-git-website'
                    ? 'e.g. My Custom Website or Alpha Bot'
                    : selectedBot.name
                }
                className="w-full px-3.5 py-2.5 text-xs bg-[#070b14] border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Customize how your project appears on your dashboard, terminal logs, and assigned domain URL.
              </p>
            </div>

            {/* Git Repository URL */}
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
                required={!customRepoUrl && !selectedBot.repoUrl && initialFiles.length === 0}
                value={customRepoUrl}
                onChange={(e) => handleCustomRepoUrlChange(e.target.value)}
                placeholder="https://github.com/username/my-website"
                className="w-full px-3.5 py-2.5 text-xs font-mono bg-[#070b14] border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Repository URL to clone ({branch} branch)
              </p>
            </div>

            {/* Git Branch & Commands for Websites */}
            {selectedBot.category === 'website' ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-white mb-1.5">
                      Git Branch
                    </label>
                    <input
                      type="text"
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      placeholder="main"
                      className="w-full px-3.5 py-2.5 text-xs font-mono bg-[#070b14] border border-slate-800 rounded-lg text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-white mb-1.5">
                      Start Command
                    </label>
                    <input
                      type="text"
                      value={startCommand}
                      onChange={(e) => setStartCommand(e.target.value)}
                      placeholder="node server.js or npx serve -s dist -l $PORT"
                      className="w-full px-3.5 py-2.5 text-xs font-mono bg-[#070b14] border border-slate-800 rounded-lg text-white"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-bold text-white">
                      Build Command (Optional)
                    </label>
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <button
                        type="button"
                        onClick={() => setBuildCommand('npm install && npm run build')}
                        className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:text-white"
                      >
                        Vite / React Build
                      </button>
                      <button
                        type="button"
                        onClick={() => setBuildCommand('npm install')}
                        className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:text-white"
                      >
                        Node.js Install
                      </button>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={buildCommand}
                    onChange={(e) => setBuildCommand(e.target.value)}
                    placeholder="npm install && npm run build"
                    className="w-full px-3.5 py-2.5 text-xs font-mono bg-[#070b14] border border-slate-800 rounded-lg text-white"
                  />
                </div>
              </>
            ) : (
              <>
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
              </>
            )}

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

          {/* Domain & URL Information Card */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-[#0d1526] to-[#070b14] border border-cyan-500/30 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold text-white">
                <Globe className="w-4 h-4 text-cyan-400" />
                <span>What Domain Will Be Used?</span>
              </div>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                Live Gateway & Reverse Proxy
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                <div className="text-[11px] text-slate-400 font-medium">1. Cloud Gateway Preview Domain (Immediate Access):</div>
                <div className="font-mono text-cyan-300 text-[11px] break-all select-all flex items-center justify-between gap-2">
                  <span>{window.location.origin}/live/&lt;assigned-id&gt;/</span>
                  <span className="text-[10px] text-emerald-400 font-sans font-medium">Active Immediately</span>
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                <div className="text-[11px] text-slate-400 font-medium">2. Production Wildcard Subdomain:</div>
                <div className="font-mono text-emerald-300 text-[11px] break-all select-all flex items-center justify-between gap-2">
                  <span>https://{(botInstanceName || selectedBot.name || 'your-repo').toLowerCase().replace(/[^a-z0-9]/g, '-')}.lyrical.cloud/</span>
                  <span className="text-[10px] text-slate-500 font-sans">Platform Domain</span>
                </div>
              </div>

              <div className="text-[11px] text-slate-400 leading-relaxed pt-1">
                Your application will receive an isolated internal port and direct HTTP proxying with automatic SSL encryption. Custom domains can also be pointed via CNAME at any time.
              </div>
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
              {submitting
                ? 'Deploying Container...'
                : `Deploy ${botInstanceName || selectedBot.name} Now (Free)`}
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

        {/* GitHub OAuth Connect Bar & Custom Repo Action */}
        <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
          {githubConnectedUser ? (
            <div className="inline-flex items-center gap-2 p-1.5 pl-3 rounded-xl bg-[#070b14] border border-cyan-500/40 text-xs">
              {githubConnectedUser.avatar_url ? (
                <img
                  src={githubConnectedUser.avatar_url}
                  alt={githubConnectedUser.login}
                  className="w-6 h-6 rounded-full border border-slate-700"
                />
              ) : (
                <GitBranch className="w-4 h-4 text-cyan-400" />
              )}
              <span className="font-semibold text-white">@{githubConnectedUser.login}</span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-mono">
                {githubRepos.length} Repos
              </span>

              <button
                type="button"
                onClick={() => setShowGithubPicker(!showGithubPicker)}
                className="ml-1 px-3 py-1.5 rounded-lg bg-cyan-500 text-slate-950 font-bold hover:bg-cyan-400 text-xs transition-colors"
              >
                {showGithubPicker ? 'Close Browser' : 'Browse & Import Repos'}
              </button>

              <button
                type="button"
                onClick={handleDisconnect}
                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 text-xs"
                title="Disconnect GitHub"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConnectModalOpen(true)}
              disabled={githubLoading}
              className="px-4 py-2.5 rounded-xl bg-[#24292F] hover:bg-[#2c3239] border border-slate-700 text-xs font-semibold text-white inline-flex items-center gap-2 shadow-md hover:border-cyan-500/50 transition-all"
            >
              <GitBranch className="w-4 h-4 text-cyan-400" />
              <span>Connect GitHub Account to Import Projects</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              const customItem = WEBSITE_CATALOG.find((w) => w.id === 'custom-git-website') || {
                id: 'custom-git-website',
                rank: 99,
                name: 'My Custom Project',
                author: 'Your Repository',
                description: 'Custom Git repository deployment with custom naming and live reverse proxying.',
                repoUrl: '',
                branch: 'main',
                startCommand: 'npm start',
                buildCommand: 'npm install',
                sessionEnvKey: '',
                sessionGeneratorUrl: '',
                image: '',
                deploymentsCount: 0,
                category: 'website',
              };
              setSelectedBot(customItem);
              setBotInstanceName('');
              setCustomRepoUrl('');
              setSearchParams({ bot: 'custom-git-website' });
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="px-4 py-2.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-xs font-semibold text-cyan-300 inline-flex items-center gap-2 transition-colors"
          >
            <Globe className="w-4 h-4 text-cyan-400" />
            <span>Deploy Custom Git URL (Name It Yourself)</span>
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
        <div className="p-5 rounded-2xl bg-[#0d1526] border border-cyan-500/40 space-y-4 shadow-xl animate-in fade-in duration-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <GitBranch className="w-4 h-4 text-cyan-400" />
                <span>Your GitHub Repositories ({githubRepos.length})</span>
                {githubConnectedUser && (
                  <span className="text-xs text-slate-400 font-normal">
                    (@{githubConnectedUser.login})
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Click <strong>Deploy Bot</strong> or <strong>Deploy Website</strong> on any repository to import and name your custom project.
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
                Close
              </button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={repoSearch}
                onChange={(e) => setRepoSearch(e.target.value)}
                placeholder="Search your repositories by name, language, or description..."
                className="w-full pl-9 pr-4 py-2 text-xs bg-[#070b14] border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>

            {/* Language filter tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              {['ALL', 'TypeScript', 'JavaScript', 'Python', 'Other'].map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setSelectedLangFilter(lang)}
                  className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap text-xs ${
                    selectedLangFilter === lang
                      ? 'bg-cyan-500 text-slate-950 font-bold'
                      : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {lang}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1">
            {filteredGithubRepos.length === 0 ? (
              <div className="col-span-full p-8 text-center text-xs text-slate-400 bg-[#070b14] rounded-xl border border-slate-800">
                <GitBranch className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p>No repositories match your current search.</p>
              </div>
            ) : (
              filteredGithubRepos.map((repo) => (
                <div
                  key={repo.id}
                  className="p-3.5 rounded-xl bg-[#070b14] border border-slate-800 hover:border-cyan-500/40 flex flex-col justify-between gap-3 transition-colors group"
                >
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-white truncate font-mono">
                        {repo.full_name}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {repo.private ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[10px] font-mono">
                            <Lock className="w-2.5 h-2.5" /> Private
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] font-mono">
                            Public
                          </span>
                        )}
                        {repo.language && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 text-[10px] font-mono">
                            {repo.language}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-400 line-clamp-2 mt-1 leading-relaxed">
                      {repo.description || 'GitHub project repository'}
                    </div>

                    <div className="flex items-center gap-3 text-[10px] font-mono text-slate-500 mt-2">
                      <span>Branch: {repo.default_branch}</span>
                      <span>·</span>
                      <span>★ {repo.stargazers_count || 0}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-800/80">
                    <button
                      type="button"
                      onClick={() => handleSelectGithubRepo(repo, 'bot')}
                      className="flex-1 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <span>Deploy Bot</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectGithubRepo(repo, 'website')}
                      className="flex-1 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Globe className="w-3 h-3" />
                      <span>Deploy Website</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Category Tab Switcher: WhatsApp Bots vs Websites & Web Services */}
      <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-800 pb-3">
        <button
          type="button"
          onClick={() => setActiveCatalogTab('bots')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
            activeCatalogTab === 'bots'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
              : 'bg-[#0d1526] border border-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          <span>🤖</span>
          <span>WhatsApp Bots ({BOT_CATALOG.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveCatalogTab('websites')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
            activeCatalogTab === 'websites'
              ? 'bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-500/20 font-bold'
              : 'bg-[#0d1526] border border-slate-800 text-slate-400 hover:text-white'
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>Websites & Web Apps ({WEBSITE_CATALOG.length})</span>
        </button>
      </div>

      {/* Available Catalog Section */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            {activeCatalogTab === 'websites' ? (
              <>
                <Globe className="w-5 h-5 text-cyan-400" />
                <span>Websites & Web Application Presets</span>
              </>
            ) : (
              <span>Available WhatsApp Bots</span>
            )}
          </h2>
          <p className="text-xs text-slate-400">
            {activeCatalogTab === 'websites'
              ? 'Deploy full-stack Node.js, React/Vite, HTML5 static sites, or Python Flask/FastAPI web apps with instant live preview.'
              : `${BOT_CATALOG.length} multi-device WhatsApp bots ready for instant free deployment.`}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {(activeCatalogTab === 'websites' ? WEBSITE_CATALOG : BOT_CATALOG).map((item) => (
            <div
              key={item.id}
              className="rounded-2xl bg-[#0d1526] border border-slate-800/90 overflow-hidden flex flex-col justify-between hover:border-blue-500/50 transition-all group"
            >
              <div>
                {/* Artwork Container */}
                <div className="relative aspect-[4/3] w-full bg-slate-950 overflow-hidden">
                  <img
                    src={item.image}
                    alt={item.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0d1526] via-transparent to-black/40" />

                  {/* Top Left Rank & Top Right Deploy Count */}
                  <div className="absolute top-3 left-3 right-3 flex items-center justify-between text-xs font-mono font-bold">
                    <span className="px-2 py-0.5 rounded bg-amber-500 text-slate-950">
                      #{item.rank}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-950/80 text-slate-200 tabular-nums">
                      {item.deploymentsCount}
                    </span>
                  </div>

                  {/* Featured Ribbon */}
                  {item.featuredLabel && (
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 py-1 text-center text-[10px] font-extrabold tracking-wider text-white uppercase">
                      {item.featuredLabel}
                    </div>
                  )}
                </div>

                {/* Card Body */}
                <div className="p-4 space-y-2">
                  <h3 className="text-base font-bold text-white">{item.name}</h3>
                  <div className="text-xs text-slate-400 flex items-center gap-1.5">
                    <UserIcon className="w-3.5 h-3.5 text-slate-500" />
                    <span>{item.author}</span>
                  </div>
                  <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed pt-1">
                    {item.description}
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
                  onClick={() => handleSelectBot(item)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                    item.category === 'website'
                      ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold'
                      : 'bg-blue-600 hover:bg-blue-500 text-white'
                  }`}
                >
                  <span>{item.category === 'website' ? 'Deploy Website' : 'Deploy Bot'}</span>
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
