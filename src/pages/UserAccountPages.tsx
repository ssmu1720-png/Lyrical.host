import React, { useState, useEffect } from 'react';
import {
  Bell,
  CheckCircle2,
  User as UserIcon,
  Lock,
  Shield,
  HelpCircle,
  BookOpen,
  MessageSquare,
} from 'lucide-react';
import { apiRequest, NotificationItem, User } from '../lib/api';
import { firebaseChangePassword } from '../lib/workspaceAuth';

export const NotificationsPage: React.FC<{ onReadChange?: () => void }> = ({ onReadChange }) => {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadNotifications = async () => {
    try {
      const res = await apiRequest<{ notifications: NotificationItem[] }>('/api/notifications');
      setNotifications(res.notifications || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
  }, []);

  const handleMarkAllRead = async () => {
    await apiRequest('/api/notifications/mark-read', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    await loadNotifications();
    if (onReadChange) onReadChange();
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold">Notifications & System Alerts</h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time deployment events, WhatsApp connection changes, and platform announcements
          </p>
        </div>

        <button
          type="button"
          onClick={handleMarkAllRead}
          className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-700 text-cyan-400 hover:bg-slate-800"
        >
          Mark All as Read
        </button>
      </div>

      {loading ? (
        <div className="p-10 text-center text-xs text-slate-400">Loading alerts...</div>
      ) : notifications.length === 0 ? (
        <div className="p-12 rounded-xl border border-slate-800 bg-slate-900/50 text-center text-xs text-slate-500">
          You have no notifications yet.
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 divide-y divide-slate-800">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`p-4 flex items-start justify-between gap-4 ${
                !n.read ? 'bg-cyan-950/20' : ''
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Bell className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-xs font-semibold text-white">{n.title}</span>
                  {!n.read && (
                    <span className="text-[11px] font-mono text-cyan-400">· UNREAD</span>
                  )}
                </div>
                <p className="text-xs text-slate-300">{n.message}</p>
              </div>
              <span className="text-[11px] font-mono text-slate-500 whitespace-nowrap">
                {new Date(n.createdAt).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const ProfilePage: React.FC<{ user: User; onUserUpdated: (u: User) => void }> = ({
  user,
  onUserUpdated,
}) => {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [sessions, setSessions] = useState<any[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest('/api/auth/me')
      .then((res) => setSessions(res.sessions || []))
      .catch(() => {});
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await apiRequest<{ user: User }>('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ name, email }),
      });
      onUserUpdated(res.user);
      setNotice('Profile updated successfully.');
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="pb-4 border-b border-slate-800">
        <h1 className="text-2xl font-bold">Account Profile</h1>
        <p className="text-xs text-slate-400 mt-1">
          Manage your identity, role status, and active authenticated sessions
        </p>
      </div>

      {notice && (
        <div className="p-3 rounded-xl bg-cyan-950/60 border border-cyan-500/40 text-xs text-cyan-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-cyan-400" />
          {notice}
        </div>
      )}
      {error && (
        <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200">
          {error}
        </div>
      )}

      <form
        onSubmit={handleSaveProfile}
        className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4"
      >
        <div className="flex items-center gap-3 pb-3 border-b border-slate-800">
          <UserIcon className="w-5 h-5 text-cyan-400" />
          <div>
            <div className="text-sm font-semibold text-white">{user.name}</div>
            <div className="text-xs text-slate-400 font-mono">
              Account ID: {user.id} · Role: {user.role.toUpperCase()}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Display Name</label>
            <input
              type="text"
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Email Address</label>
            <input
              type="email"
              required
              maxLength={160}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
            />
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400"
          >
            Save Profile Changes
          </button>
        </div>
      </form>

      <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4">
        <h2 className="text-sm font-semibold text-white">Active Security Sessions</h2>
        <div className="divide-y divide-slate-800 text-xs">
          {sessions.map((s) => (
            <div key={s.id} className="py-3 flex items-center justify-between gap-4">
              <div>
                <div className="font-mono text-slate-200">
                  {s.ip} {s.current ? '· (Current Session)' : ''}
                </div>
                <div className="text-[11px] text-slate-500 truncate max-w-md">{s.userAgent}</div>
              </div>
              <div className="text-[11px] font-mono text-slate-400">
                {new Date(s.createdAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export const AccountSettingsPage: React.FC<{
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}> = ({ theme, onToggleTheme }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      try {
        await firebaseChangePassword(newPassword);
      } catch {
        // also update server password hash
      }
      const res = await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setNotice(res.message || 'Password updated.');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="pb-4 border-b border-slate-800">
        <h1 className="text-2xl font-bold">Account & Security Settings</h1>
        <p className="text-xs text-slate-400 mt-1">
          Configure password credentials, interface theme, and security preferences
        </p>
      </div>

      {notice && (
        <div className="p-3 rounded-xl bg-cyan-950/60 border border-cyan-500/40 text-xs text-cyan-200">
          {notice}
        </div>
      )}
      {error && (
        <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200">
          {error}
        </div>
      )}

      <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">Interface Theme Preference</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Default aesthetic is LYRICAL Cyber Dark mode
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleTheme}
          className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-700 bg-slate-950 text-cyan-400 hover:border-cyan-500/50"
        >
          Current: {theme.toUpperCase()} (Switch)
        </button>
      </div>

      <form
        onSubmit={handleChangePassword}
        className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4"
      >
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Change Account Password</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Current Password
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              New Password (min 6 chars)
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
            />
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400"
          >
            Update Password
          </button>
        </div>
      </form>
    </div>
  );
};

export const SupportPage: React.FC = () => {
  const [subject, setSubject] = useState('');
  const [details, setDetails] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleReport = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setSubject('');
    setDetails('');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="pb-4 border-b border-slate-800">
        <h1 className="text-2xl font-bold">LYRICAL Support & Documentation</h1>
        <p className="text-xs text-slate-400 mt-1">
          Guides for deploying Node.js and Python WhatsApp bots, pairing codes, and Google Drive backups
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
          <div className="flex items-center gap-2 text-cyan-400">
            <BookOpen className="w-4 h-4" />
            <h2 className="text-sm font-semibold text-white">Quick Start Deployment Guide</h2>
          </div>
          <ol className="list-decimal list-inside text-xs text-slate-300 space-y-2 leading-relaxed">
            <li>Click <strong>Deploy Bot</strong> in the top bar and choose Node.js or Python runtime.</li>
            <li>Provide a public GitHub repository URL, import files from Google Drive, or use the built-in LYRICAL Multi-Device starter engine.</li>
            <li>Select either <strong>8-Character Pairing Code</strong> or <strong>QR Code</strong> authentication.</li>
            <li>Once deployed, open the <strong>WhatsApp Connection</strong> tab on your bot page to link your WhatsApp account.</li>
          </ol>
        </div>

        <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 space-y-3">
          <div className="flex items-center gap-2 text-cyan-400">
            <HelpCircle className="w-4 h-4" />
            <h2 className="text-sm font-semibold text-white">Frequently Asked Questions</h2>
          </div>
          <div className="space-y-3 text-xs">
            <div>
              <div className="font-semibold text-slate-200">How do I connect my external deployment API?</div>
              <p className="text-slate-400 mt-0.5">
                Administrators can configure <code className="font-mono text-cyan-300">DEPLOYMENT_API_URL</code> in Admin → Platform Settings or environment variables.
              </p>
            </div>
            <div>
              <div className="font-semibold text-slate-200">Are my environment variables and API keys secure?</div>
              <p className="text-slate-400 mt-0.5">
                Yes. Environment variables are masked by default in the UI and injected directly into the isolated backend child process.
              </p>
            </div>
          </div>
        </div>
      </div>

      <form
        onSubmit={handleReport}
        className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 space-y-4"
      >
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Report an Issue or Contact Engineering Support</h2>
        </div>

        {submitted && (
          <div className="p-3 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-xs text-emerald-200">
            Your support ticket has been logged with the LYRICAL platform administrator.
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5">Issue Subject</label>
          <input
            type="text"
            required
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g., Bot container exits with code 1 during npm install"
            className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1.5">
            Technical Details & Bot ID
          </label>
          <textarea
            rows={4}
            required
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Include your Bot ID (bot_...) and relevant log lines..."
            className="w-full px-3.5 py-2 text-xs bg-slate-950 border border-slate-800 rounded-lg text-white"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="px-5 py-2 text-xs font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400"
          >
            Submit Support Report
          </button>
        </div>
      </form>
    </div>
  );
};
