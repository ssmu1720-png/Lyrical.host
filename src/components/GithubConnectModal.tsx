import React, { useState } from 'react';
import {
  GitBranch,
  Lock,
  Key,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  X,
  Copy,
  Check,
  RotateCw,
  LogOut,
  Shield,
  HelpCircle,
} from 'lucide-react';
import {
  githubOAuthSignIn,
  connectGithubWithToken,
  disconnectGithub,
} from '../lib/workspaceAuth';

interface GithubConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected: (user: { login: string; avatar_url?: string; html_url?: string }) => void;
  connectedUser: { login: string; avatar_url?: string; html_url?: string } | null;
  onDisconnect?: () => void;
}

export const GithubConnectModal: React.FC<GithubConnectModalProps> = ({
  isOpen,
  onClose,
  onConnected,
  connectedUser,
  onDisconnect,
}) => {
  const [activeTab, setActiveTab] = useState<'oauth' | 'pat'>('oauth');
  const [patToken, setPatToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedCallback, setCopiedCallback] = useState(false);
  const [showDocs, setShowDocs] = useState(false);

  if (!isOpen) return null;

  const origin = window.location.origin;
  const callbackUrl = `${origin}/auth/github/callback`;

  const handleOAuthConnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await githubOAuthSignIn();
      onConnected(res.user);
      onClose();
    } catch (err: any) {
      if (err.code === 'OAUTH_NOT_CONFIGURED') {
        setError(
          'GitHub OAuth client ID is not configured on this container. You can connect immediately with a Personal Access Token below!'
        );
        setActiveTab('pat');
      } else {
        setError(err.message || 'Failed to connect via GitHub OAuth popup.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePatConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patToken.trim()) {
      setError('Please paste your GitHub Personal Access Token.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const user = await connectGithubWithToken(patToken.trim());
      onConnected(user);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to validate GitHub token.');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    try {
      await disconnectGithub();
      if (onDisconnect) onDisconnect();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const copyCallbackUrl = () => {
    navigator.clipboard.writeText(callbackUrl);
    setCopiedCallback(true);
    setTimeout(() => setCopiedCallback(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl bg-[#0d1526] border border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#24292F] border border-slate-700 flex items-center justify-center text-white">
              <GitBranch className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Connect GitHub Account</h2>
              <p className="text-xs text-slate-400">
                Import and deploy public and private repositories
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4">
          {connectedUser ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#070b14] border border-emerald-500/30 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  {connectedUser.avatar_url ? (
                    <img
                      src={connectedUser.avatar_url}
                      alt={connectedUser.login}
                      className="w-10 h-10 rounded-full border border-slate-700 shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-white font-bold shrink-0">
                      {connectedUser.login.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white truncate">
                        @{connectedUser.login}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        Connected
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">
                      Repositories are synced and ready to import.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleDisconnect}
                  disabled={loading}
                  className="px-3 py-1.5 rounded-lg border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Disconnect
                </button>
              </div>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
                >
                  Continue to Repository Browser
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Method Switcher Tabs */}
              <div className="grid grid-cols-2 p-1 rounded-xl bg-[#070b14] border border-slate-800 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('oauth');
                    setError(null);
                  }}
                  className={`py-2 rounded-lg transition-all flex items-center justify-center gap-2 ${
                    activeTab === 'oauth'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span>1-Click OAuth</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('pat');
                    setError(null);
                  }}
                  className={`py-2 rounded-lg transition-all flex items-center justify-center gap-2 ${
                    activeTab === 'pat'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Key className="w-3.5 h-3.5" />
                  <span>Personal Token (PAT)</span>
                </button>
              </div>

              {error && (
                <div className="p-3.5 rounded-xl bg-amber-950/60 border border-amber-500/40 text-xs text-amber-200 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="leading-relaxed">{error}</div>
                </div>
              )}

              {activeTab === 'oauth' ? (
                <div className="space-y-4 pt-1">
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Authorize LYRICAL to securely read your public and private repositories directly from GitHub via popup authentication.
                  </p>

                  <button
                    type="button"
                    onClick={handleOAuthConnect}
                    disabled={loading}
                    className="w-full py-3 px-4 rounded-xl bg-[#24292F] hover:bg-[#2c3239] border border-slate-700 text-white text-sm font-semibold flex items-center justify-center gap-2.5 transition-all shadow-md disabled:opacity-50"
                  >
                    {loading ? (
                      <RotateCw className="w-4 h-4 animate-spin text-cyan-400" />
                    ) : (
                      <GitBranch className="w-4 h-4 text-cyan-400" />
                    )}
                    <span>{loading ? 'Opening GitHub Authorization...' : 'Authorize with GitHub (1-Click)'}</span>
                  </button>

                  <div className="pt-2 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={() => setShowDocs(!showDocs)}
                      className="text-[11px] text-slate-400 hover:text-cyan-400 flex items-center gap-1 transition-colors"
                    >
                      <HelpCircle className="w-3 h-3" />
                      <span>{showDocs ? 'Hide OAuth App Settings' : 'Configuring a custom GitHub OAuth App?'}</span>
                    </button>

                    {showDocs && (
                      <div className="mt-2.5 p-3 rounded-xl bg-[#070b14] border border-slate-800 text-[11px] text-slate-400 space-y-2">
                        <p>
                          In your GitHub OAuth App settings (
                          <a
                            href="https://github.com/settings/developers"
                            target="_blank"
                            rel="noreferrer"
                            className="text-cyan-400 hover:underline"
                          >
                            github.com/settings/developers
                          </a>
                          ), set the Authorization callback URL to:
                        </p>
                        <div className="flex items-center justify-between gap-2 p-2 rounded bg-slate-950 font-mono text-cyan-300 text-[10px] break-all border border-slate-800">
                          <span>{callbackUrl}</span>
                          <button
                            type="button"
                            onClick={copyCallbackUrl}
                            className="text-slate-400 hover:text-white shrink-0"
                            title="Copy Callback URL"
                          >
                            {copiedCallback ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <form onSubmit={handlePatConnect} className="space-y-4 pt-1">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-white">
                        GitHub Personal Access Token
                      </label>
                      <a
                        href="https://github.com/settings/tokens/new?scopes=repo,read:user&description=LYRICAL-Cloud-Platform"
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1"
                      >
                        Generate Token <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    </div>
                    <input
                      type="password"
                      value={patToken}
                      onChange={(e) => setPatToken(e.target.value)}
                      placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      className="w-full px-3.5 py-2.5 text-xs font-mono bg-[#070b14] border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                    />
                    <p className="text-[11px] text-slate-500">
                      Classic token or fine-grained token with <code className="text-cyan-400">repo</code> and <code className="text-cyan-400">read:user</code> scopes.
                    </p>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !patToken.trim()}
                    className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  >
                    {loading ? (
                      <RotateCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    <span>{loading ? 'Verifying Token...' : 'Connect GitHub Token & Import Repos'}</span>
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
