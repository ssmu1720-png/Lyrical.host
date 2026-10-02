import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Bot as BotIcon,
  Rocket,
  Bell,
  User as UserIcon,
  Settings,
  HelpCircle,
  Shield,
  LogOut,
  Sun,
  Moon,
  Users,
  Server,
  FileText,
  Activity,
} from 'lucide-react';
import { User } from '../lib/api';

interface AppLayoutProps {
  user: User;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onLogout: () => void;
  unreadNotifications: number;
  announcementBanner?: string;
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  user,
  theme,
  onToggleTheme,
  onLogout,
  unreadNotifications,
  announcementBanner,
  children,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const isAdminRoute = location.pathname.startsWith('/admin');

  const userNavItems = [
    { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/bots', label: 'My Bots', icon: BotIcon },
    { path: '/deploy', label: 'Deploy Bot', icon: Rocket },
    { path: '/notifications', label: 'Notifications', icon: Bell, badge: unreadNotifications },
    { path: '/profile', label: 'Profile', icon: UserIcon },
    { path: '/settings', label: 'Settings', icon: Settings },
    { path: '/support', label: 'Support', icon: HelpCircle },
  ];

  const adminNavItems = [
    { path: '/admin', label: 'Overview', icon: LayoutDashboard },
    { path: '/admin/users', label: 'Users', icon: Users },
    { path: '/admin/bots', label: 'All Bots', icon: BotIcon },
    { path: '/admin/deployments', label: 'Deployments', icon: Rocket },
    { path: '/admin/servers', label: 'Servers', icon: Server },
    { path: '/admin/logs', label: 'System Logs', icon: FileText },
    { path: '/admin/audit-logs', label: 'Audit Trail', icon: Activity },
    { path: '/admin/settings', label: 'Platform Settings', icon: Settings },
  ];

  const activeNav = isAdminRoute && user.role === 'admin' ? adminNavItems : userNavItems;

  return (
    <div
      className={`min-h-screen flex flex-col transition-colors ${
        theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-50 text-slate-900'
      }`}
    >
      {/* Top Navigation Bar (Strict 3-Zone Contract) */}
      <header
        className={`sticky top-0 z-40 h-14 px-4 sm:px-6 flex items-center justify-between border-b backdrop-blur-md ${
          theme === 'dark'
            ? 'bg-slate-950/90 border-slate-800/80'
            : 'bg-white/90 border-slate-200'
        }`}
      >
        {/* Zone 1: Single text element wordmark */}
        <Link
          to="/dashboard"
          className="font-display text-lg font-extrabold tracking-wider bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent whitespace-nowrap shrink-0"
        >
          LYRICAL
        </Link>

        {/* Zone 2: 4-5 Clean Text Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
          <Link
            to="/dashboard"
            className={`transition-colors whitespace-nowrap ${
              location.pathname === '/dashboard'
                ? 'text-cyan-400 underline underline-offset-8'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            Dashboard
          </Link>
          <Link
            to="/bots"
            className={`transition-colors whitespace-nowrap ${
              location.pathname.startsWith('/bots')
                ? 'text-cyan-400 underline underline-offset-8'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            Bots
          </Link>
          <Link
            to="/deploy"
            className={`transition-colors whitespace-nowrap ${
              location.pathname === '/deploy'
                ? 'text-cyan-400 underline underline-offset-8'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            Deploy
          </Link>
          <Link
            to="/support"
            className={`transition-colors whitespace-nowrap ${
              location.pathname === '/support'
                ? 'text-cyan-400 underline underline-offset-8'
                : 'text-slate-400 hover:text-slate-100'
            }`}
          >
            Support
          </Link>
          {user.role === 'admin' && (
            <Link
              to="/admin"
              className={`transition-colors whitespace-nowrap ${
                location.pathname.startsWith('/admin')
                  ? 'text-purple-400 underline underline-offset-8'
                  : 'text-slate-400 hover:text-purple-300'
              }`}
            >
              Admin
            </Link>
          )}
        </nav>

        {/* Zone 3: 1-2 Primary Actions */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onToggleTheme}
            className={`p-2 rounded-lg border transition-colors ${
              theme === 'dark'
                ? 'border-slate-800 text-slate-300 hover:border-cyan-500/40'
                : 'border-slate-200 text-slate-700 hover:bg-slate-100'
            }`}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={() => navigate('/deploy')}
            className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 hover:from-cyan-400 hover:to-blue-500 transition-all shadow-sm whitespace-nowrap shrink-0"
          >
            Deploy Bot
          </button>
        </div>
      </header>

      {announcementBanner && (
        <div className="bg-cyan-950/70 border-b border-cyan-500/30 px-4 py-2 text-center text-xs text-cyan-200">
          {announcementBanner}
        </div>
      )}

      {/* Workspace Body: Sidebar + Main Viewport */}
      <div className="flex-1 flex">
        <aside
          className={`hidden lg:flex w-64 shrink-0 flex-col justify-between border-r p-4 ${
            theme === 'dark'
              ? 'bg-slate-950/60 border-slate-800/80'
              : 'bg-white border-slate-200'
          }`}
        >
          <div className="space-y-1">
            {user.role === 'admin' && (
              <div className="mb-4 flex p-1 rounded-lg bg-slate-900 border border-slate-800">
                <button
                  type="button"
                  onClick={() => navigate('/dashboard')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    !isAdminRoute
                      ? 'bg-cyan-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  User Console
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/admin')}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    isAdminRoute
                      ? 'bg-purple-500 text-white font-semibold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Admin Panel
                </button>
              </div>
            )}

            {activeNav.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.path === '/admin'
                  ? location.pathname === '/admin'
                  : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? theme === 'dark'
                        ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                        : 'bg-cyan-50 text-cyan-800 border border-cyan-200'
                      : theme === 'dark'
                      ? 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/70'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 shrink-0" />
                    {item.label}
                  </span>
                  {'badge' in item && typeof item.badge === 'number' && item.badge > 0 ? (
                    <span className="text-[11px] font-mono font-semibold text-cyan-400 tabular-nums">
                      {item.badge}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>

          <div
            className={`pt-4 border-t space-y-3 ${
              theme === 'dark' ? 'border-slate-800' : 'border-slate-200'
            }`}
          >
            <div className="px-2">
              <div className="text-xs font-semibold truncate">{user.name}</div>
              <div className="text-[11px] text-slate-400 truncate">
                {user.email} · {user.role === 'admin' ? 'Administrator' : 'Member'}
              </div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-rose-400 hover:bg-rose-950/30 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 min-w-0 pb-20 lg:pb-10 px-4 sm:px-6 lg:px-8 py-6 max-w-[1400px] mx-auto w-full">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation (<= 15% viewport height, touch friendly >= 44px) */}
      <nav
        className={`lg:hidden fixed bottom-0 left-0 right-0 z-40 h-14 border-t flex items-center justify-around px-2 backdrop-blur-md ${
          theme === 'dark'
            ? 'bg-slate-950/95 border-slate-800'
            : 'bg-white/95 border-slate-200'
        }`}
      >
        <Link
          to="/dashboard"
          className={`flex flex-col items-center justify-center min-h-[44px] px-2 text-[11px] font-medium ${
            location.pathname === '/dashboard' ? 'text-cyan-400' : 'text-slate-400'
          }`}
        >
          <LayoutDashboard className="w-4 h-4 mb-0.5" />
          Home
        </Link>
        <Link
          to="/bots"
          className={`flex flex-col items-center justify-center min-h-[44px] px-2 text-[11px] font-medium ${
            location.pathname.startsWith('/bots') ? 'text-cyan-400' : 'text-slate-400'
          }`}
        >
          <BotIcon className="w-4 h-4 mb-0.5" />
          Bots
        </Link>
        <Link
          to="/deploy"
          className={`flex flex-col items-center justify-center min-h-[44px] px-2 text-[11px] font-medium ${
            location.pathname === '/deploy' ? 'text-cyan-400' : 'text-slate-400'
          }`}
        >
          <Rocket className="w-4 h-4 mb-0.5" />
          Deploy
        </Link>
        <Link
          to="/notifications"
          className={`flex flex-col items-center justify-center min-h-[44px] px-2 text-[11px] font-medium ${
            location.pathname === '/notifications' ? 'text-cyan-400' : 'text-slate-400'
          }`}
        >
          <Bell className="w-4 h-4 mb-0.5" />
          Alerts {unreadNotifications > 0 ? `(${unreadNotifications})` : ''}
        </Link>
        {user.role === 'admin' ? (
          <Link
            to="/admin"
            className={`flex flex-col items-center justify-center min-h-[44px] px-2 text-[11px] font-medium ${
              location.pathname.startsWith('/admin') ? 'text-purple-400' : 'text-slate-400'
            }`}
          >
            <Shield className="w-4 h-4 mb-0.5" />
            Admin
          </Link>
        ) : (
          <Link
            to="/settings"
            className={`flex flex-col items-center justify-center min-h-[44px] px-2 text-[11px] font-medium ${
              location.pathname === '/settings' ? 'text-cyan-400' : 'text-slate-400'
            }`}
          >
            <Settings className="w-4 h-4 mb-0.5" />
            Settings
          </Link>
        )}
      </nav>
    </div>
  );
};
