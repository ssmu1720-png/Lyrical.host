import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  GitBranch,
  Github,
  Search,
  RefreshCw,
  ExternalLink,
  Lock,
  Globe,
  Star,
  GitFork,
  Check,
  AlertCircle,
  KeyRound,
  User as UserIcon,
  Rocket,
  ArrowRight,
  LogOut,
  Sparkles,
} from 'lucide-react';
import {
  githubSignIn,
  connectGithubWithToken,
  fetchPublicGithubRepos,
  listUserGithubRepos,
  getGithubAccessToken,
  getConnectedGithubUser,
  disconnectGithub,
  GithubRepoItem,
} from '../lib/workspaceAuth';

export const GitImportPage: React.FC = () => {
  const navigate = useNavigate();

  // Connection states
  const [connectedUser, setConnectedUser] = useState(getConnectedGithubUser());
  const [tokenInput, setTokenInput] = useState('');
  const [publicUserInput, setPublicUserInput] = useState('');
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [showUserSearchModal, setShowUserSearchModal] = useState(false);

  // Repository list state
  const [repos, setRepos] = useState<GithubRepoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'public' | 'private' | 'sources'>('all');
  const [selectedLang, setSelectedLang] = useState<string>('all');

  // Direct Git URL state
  const [directGitUrl, setDirectGitUrl] = useState('');
  const [directProjectName, setDirectProjectName] = useState('');
  const [directBranch, setDirectBranch] = useState('main');
  const [directCategory, setDirectCategory] = useState<'website' | 'whatsapp_bot'>('website');

  // Load repositories if already connected
  const loadConnectedRepos = async () => {
    if (!getGithubAccessToken()) return;
    setLoading(true);
    setError(null);
    try {
      const userRepos = await listUserGithubRepos();
      setRepos(userRepos);
      setConnectedUser(getConnectedGithubUser());
    } catch (err: any) {
      if (err.message === 'NEEDS_GITHUB_AUTH') {
        disconnectGithub();
        setConnectedUser(null);
      } else {
        setError(err.message || 'Could not fetch your GitHub repositories.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (getGithubAccessToken()) {
      loadConnectedRepos();
    }
  }, []);

  // Handlers for connection
  const handleOAuthConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const authRes = await githubSignIn();
      if (!authRes) return;
      setConnectedUser({ login: authRes.githubUsername });
      setSuccessNotice(`Successfully connected to GitHub as @${authRes.githubUsername}`);
      const userRepos = await listUserGithubRepos();
      setRepos(userRepos);
    } catch (err: any) {
      if (err?.code === 'auth/operation-not-allowed') {
        setError(
          'GitHub OAuth is not active in Firebase Console. You can connect instantly using a Personal Access Token below (zero setup required!).'
        );
        setShowTokenModal(true);
      } else {
        setError(err.message || 'Failed to connect GitHub account.');
      }
    } finally {
      setConnecting(false);
    }
  };

  const handleTokenConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) return;
    setConnecting(true);
    setError(null);
    try {
      const profile = await connectGithubWithToken(tokenInput.trim());
      setConnectedUser(profile);
      setShowTokenModal(false);
      setTokenInput('');
      setSuccessNotice(`Connected to GitHub via Personal Access Token (@${profile.login})`);
      const userRepos = await listUserGithubRepos();
      setRepos(userRepos);
    } catch (err: any) {
      setError(err.message || 'Could not validate GitHub Token.');
    } finally {
      setConnecting(false);
    }
  };

  const handleFetchPublicUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const username = publicUserInput.trim().replace(/^@/, '');
    if (!username) return;
    setLoading(true);
    setError(null);
    try {
      const publicRepos = await fetchPublicGithubRepos(username);
      setRepos(publicRepos);
      setShowUserSearchModal(false);
      setSuccessNotice(`Loaded ${publicRepos.length} public repositories for @${username}`);
    } catch (err: any) {
      setError(err.message || `Could not find public repositories for @${username}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = () => {
    disconnectGithub();
    setConnectedUser(null);
    setRepos([]);
    setSuccessNotice('Disconnected GitHub account.');
  };

  // Direct Git URL auto-namer
  const handleDirectUrlChange = (url: string) => {
    setDirectGitUrl(url);
    if (!directProjectName) {
      const match = url.trim().match(/\/([^/]+?)(?:\.git|\/)?$/);
      if (match && match[1]) {
        const cleanName = match[1]
          .replace(/[-_]/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());
        setDirectProjectName(cleanName);
      }
    }
  };

  // Deploy an imported repository
  const handleDeployRepo = (repo: GithubRepoItem) => {
    const isBot =
      repo.name.toLowerCase().includes('bot') ||
      (repo.description && repo.description.toLowerCase().includes('bot')) ||
      (repo.description && repo.description.toLowerCase().includes('whatsapp'));

    const queryParams = new URLSearchParams({
      bot: isBot ? 'custom-github-bot' : 'custom-git-website',
      repoUrl: repo.clone_url.replace(/\.git$/, ''),
      name: repo.name,
      branch: repo.default_branch || 'main',
      category: isBot ? 'whatsapp_bot' : 'website',
    });

    navigate(`/deploy?${queryParams.toString()}`);
  };

  // Deploy custom Git URL
  const handleDeployDirect = (e: React.FormEvent) => {
    e.preventDefault();
    if (!directGitUrl.trim()) return;

    const queryParams = new URLSearchParams({
      bot: directCategory === 'website' ? 'custom-git-website' : 'custom-github-bot',
      repoUrl: directGitUrl.trim().replace(/\.git$/, ''),
      name: directProjectName.trim() || 'Custom Project',
      branch: directBranch.trim() || 'main',
      category: directCategory,
    });

    navigate(`/deploy?${queryParams.toString()}`);
  };

  // Distinct languages list
  const allLanguages = Array.from(
    new Set(repos.map((r) => r.language).filter(Boolean))
  ) as string[];

  // Filtered repositories
  const filteredRepos = repos.filter((r) => {
    const matchesSearch =
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.full_name.toLowerCase().includes(search.toLowerCase()) ||
      (r.description && r.description.toLowerCase().includes(search.toLowerCase()));

    const matchesType =
      filterType === 'all'
        ? true
        : filterType === 'public'
        ? !r.private
        : filterType === 'private'
        ? r.private
        : !r.name.includes('fork');

    const matchesLang = selectedLang === 'all' || r.language === selectedLang;

    return matchesSearch && matchesType && matchesLang;
  });

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
            <GitBranch className="w-6 h-6 text-cyan-400" />
            <span>GitHub & Git Project Importer</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Connect your GitHub account or Personal Access Token to browse and deploy repositories directly into cloud containers.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Link
            to="/deploy"
            className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white transition-colors"
          >
            ← Deploy Wizard
          </Link>
        </div>
      </div>

      {/* Notices */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}

      {successNotice && (
        <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-xs text-emerald-200 flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessNotice(null)}
            className="text-emerald-400 hover:underline text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Connection Status Card */}
      <div className="p-6 rounded-2xl bg-[#0d1526] border border-slate-800/90 shadow-xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            {connectedUser ? (
              <div className="relative">
                {connectedUser.avatar_url ? (
                  <img
                    src={connectedUser.avatar_url}
                    alt={connectedUser.login}
                    className="w-12 h-12 rounded-xl object-cover border border-cyan-500/40"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
                    <Github className="w-6 h-6" />
                  </div>
                )}
                <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-slate-950 flex items-center justify-center">
                  <Check className="w-2.5 h-2.5 text-slate-950 stroke-[3]" />
                </div>
              </div>
            ) : (
              <div className="w-12 h-12 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400">
                <Github className="w-6 h-6" />
              </div>
            )}

            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">
                  {connectedUser ? `@${connectedUser.login}` : 'GitHub Not Connected'}
                </h2>
                <span
                  className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full ${
                    connectedUser
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/40'
                      : 'bg-slate-900 text-slate-400 border border-slate-800'
                  }`}
                >
                  {connectedUser ? 'CONNECTED' : 'DISCONNECTED'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {connectedUser
                  ? `Access to ${repos.length} repositories · Live synchronization active`
                  : 'Connect your GitHub account or use a Personal Access Token to import private and public repos.'}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            {connectedUser ? (
              <>
                <button
                  type="button"
                  onClick={loadConnectedRepos}
                  disabled={loading}
                  className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-900 border border-slate-800 text-slate-200 hover:text-white hover:border-slate-700 transition-colors flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 transition-colors flex items-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Disconnect
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleOAuthConnect}
                  disabled={connecting}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-[#24292F] hover:bg-[#2c3239] border border-slate-700 text-white flex items-center gap-2 transition-colors shadow-sm"
                >
                  <Github className="w-4 h-4 text-white" />
                  {connecting ? 'Connecting...' : 'Sign in with GitHub'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowTokenModal(true)}
                  className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-300 flex items-center gap-1.5 transition-colors"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  Connect with Token (PAT)
                </button>
                <button
                  type="button"
                  onClick={() => setShowUserSearchModal(true)}
                  className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white transition-colors flex items-center gap-1.5"
                >
                  <Search className="w-3.5 h-3.5" />
                  Search User/Org
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Direct Git URL Import Section */}
      <div className="p-6 rounded-2xl bg-[#0d1526] border border-slate-800/90 space-y-4">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Rocket className="w-4 h-4 text-cyan-400" />
            <span>Direct Git Clone URL Import</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Clone and deploy any public or private repository from GitHub, GitLab, Bitbucket, or self-hosted Git servers.
          </p>
        </div>

        <form onSubmit={handleDeployDirect} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Git Repository URL <span className="text-rose-400">*</span>
              </label>
              <input
                type="url"
                required
                value={directGitUrl}
                onChange={(e) => handleDirectUrlChange(e.target.value)}
                placeholder="https://github.com/username/my-awesome-project"
                className="w-full px-3.5 py-2 text-xs font-mono bg-[#070b14] border border-slate-800 rounded-lg text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Project Name <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                value={directProjectName}
                onChange={(e) => setDirectProjectName(e.target.value)}
                placeholder="e.g. My Website"
                className="w-full px-3.5 py-2 text-xs bg-[#070b14] border border-slate-800 rounded-lg text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Git Branch</label>
              <input
                type="text"
                value={directBranch}
                onChange={(e) => setDirectBranch(e.target.value)}
                placeholder="main"
                className="w-full px-3.5 py-2 text-xs font-mono bg-[#070b14] border border-slate-800 rounded-lg text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Target Category</label>
              <select
                value={directCategory}
                onChange={(e) => setDirectCategory(e.target.value as any)}
                className="w-full px-3.5 py-2 text-xs bg-[#070b14] border border-slate-800 rounded-lg text-white focus:outline-none focus:border-cyan-500"
              >
                <option value="website">🌐 Website & Web App</option>
                <option value="whatsapp_bot">🤖 WhatsApp Bot</option>
              </select>
            </div>

            <div className="sm:col-span-2 flex items-center justify-end gap-2">
              <button
                type="submit"
                disabled={!directGitUrl.trim()}
                className="w-full sm:w-auto px-5 py-2 text-xs font-bold rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <span>Import & Configure Deployment</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Repositories Browser */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Github className="w-5 h-5 text-cyan-400" />
              <span>Available GitHub Repositories</span>
              {repos.length > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-400 font-mono">
                  {filteredRepos.length} of {repos.length}
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-400">
              Select any project to import and deploy it directly into a container process
            </p>
          </div>

          {/* Quick Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {(['all', 'public', 'private'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFilterType(t)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors capitalize ${
                  filterType === t
                    ? 'bg-cyan-500 text-slate-950 font-bold'
                    : 'bg-[#0d1526] border border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Search & Language Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2 relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search repositories by name, language, or description..."
              className="w-full pl-9 pr-4 py-2.5 text-xs bg-[#0d1526] border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <select
              value={selectedLang}
              onChange={(e) => setSelectedLang(e.target.value)}
              className="w-full px-3.5 py-2.5 text-xs bg-[#0d1526] border border-slate-800 rounded-xl text-white focus:outline-none focus:border-cyan-500"
            >
              <option value="all">All Languages</option>
              {allLanguages.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Repository Cards Grid */}
        {loading ? (
          <div className="p-16 text-center text-xs text-slate-400 bg-[#0d1526] border border-slate-800 rounded-2xl flex flex-col items-center justify-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
            <span>Loading repositories from GitHub...</span>
          </div>
        ) : filteredRepos.length === 0 ? (
          <div className="p-12 text-center bg-[#0d1526] border border-slate-800 rounded-2xl space-y-3">
            <Github className="w-10 h-10 text-slate-600 mx-auto" />
            <div className="text-sm font-semibold text-white">
              {repos.length === 0 ? 'No Repositories Loaded' : 'No Repositories Match Your Filters'}
            </div>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              {repos.length === 0
                ? 'Connect your GitHub account with OAuth or Personal Access Token, or search any public username to import projects.'
                : 'Try adjusting your search keywords or clearing active filters.'}
            </p>
            {repos.length === 0 && (
              <div className="pt-2 flex justify-center gap-3">
                <button
                  type="button"
                  onClick={handleOAuthConnect}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white"
                >
                  Connect GitHub
                </button>
                <button
                  type="button"
                  onClick={() => setShowTokenModal(true)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-900 border border-slate-700 text-slate-300 hover:text-white"
                >
                  Enter Token
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredRepos.map((repo) => (
              <div
                key={repo.id}
                className="p-4 rounded-xl bg-[#0d1526] border border-slate-800 hover:border-cyan-500/40 transition-all flex flex-col justify-between gap-3 group"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white group-hover:text-cyan-400 transition-colors truncate">
                          {repo.name}
                        </span>
                        {repo.private ? (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[10px] font-mono flex items-center gap-1 shrink-0">
                            <Lock className="w-2.5 h-2.5" />
                            Private
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px] font-mono shrink-0">
                            Public
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono truncate mt-0.5">
                        {repo.full_name} · Branch: {repo.default_branch}
                      </div>
                    </div>

                    <a
                      href={repo.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 rounded text-slate-500 hover:text-slate-200 shrink-0"
                      title="View on GitHub"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>

                  <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                    {repo.description || 'No description provided for this repository.'}
                  </p>

                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 pt-1 font-mono">
                    {repo.language && (
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-cyan-400" />
                        {repo.language}
                      </span>
                    )}
                    {repo.stargazers_count !== undefined && (
                      <span className="flex items-center gap-1">
                        <Star className="w-3 h-3 text-amber-400" />
                        {repo.stargazers_count}
                      </span>
                    )}
                    {repo.forks_count !== undefined && (
                      <span className="flex items-center gap-1">
                        <GitFork className="w-3 h-3 text-slate-500" />
                        {repo.forks_count}
                      </span>
                    )}
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  <div className="text-[11px] text-slate-500 font-mono">
                    Updated {new Date(repo.updated_at).toLocaleDateString()}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeployRepo(repo)}
                    className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors shadow-sm"
                  >
                    <span>Import & Deploy</span>
                    <Rocket className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal: Connect with Personal Access Token */}
      {showTokenModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0d1526] border border-cyan-500/40 rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-cyan-400" />
                Connect via GitHub Token (PAT)
              </h3>
              <button
                type="button"
                onClick={() => setShowTokenModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Create a GitHub Personal Access Token with <code>repo</code> scope to import private repositories and avoid API rate limits.
            </p>

            <form onSubmit={handleTokenConnect} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Personal Access Token (classic or fine-grained)
                </label>
                <input
                  type="password"
                  required
                  autoFocus
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  className="w-full px-3.5 py-2.5 text-xs font-mono bg-[#070b14] border border-slate-800 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                <a
                  href="https://github.com/settings/tokens/new?scopes=repo,read:user"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:underline inline-flex items-center gap-1"
                >
                  Generate token on GitHub ↗
                </a>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowTokenModal(false)}
                  className="px-4 py-2 text-xs rounded-lg border border-slate-800 text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={connecting || !tokenInput.trim()}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors disabled:opacity-50"
                >
                  {connecting ? 'Validating Token...' : 'Connect Token'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Search Any Public GitHub User / Org */}
      {showUserSearchModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0d1526] border border-slate-800 rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <UserIcon className="w-4 h-4 text-cyan-400" />
                Browse Public GitHub Repositories
              </h3>
              <button
                type="button"
                onClick={() => setShowUserSearchModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Enter any GitHub username or organization (e.g. <code>shadcn</code>, <code>whiskeysockets</code>, <code>vercel</code>) to browse and import their public repositories.
            </p>

            <form onSubmit={handleFetchPublicUser} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  GitHub Username or Organization
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={publicUserInput}
                  onChange={(e) => setPublicUserInput(e.target.value)}
                  placeholder="e.g. octocat or whiskeysockets"
                  className="w-full px-3.5 py-2.5 text-xs bg-[#070b14] border border-slate-800 rounded-lg text-white focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowUserSearchModal(false)}
                  className="px-4 py-2 text-xs rounded-lg border border-slate-800 text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !publicUserInput.trim()}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 transition-colors disabled:opacity-50"
                >
                  {loading ? 'Fetching Repositories...' : 'Load Repositories'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
