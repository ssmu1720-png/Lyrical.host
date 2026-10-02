import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { ShieldAlert, Clock } from 'lucide-react';
import { apiRequest, getStoredSessionToken, setStoredSessionToken, User } from './lib/api';
import { initAuth, logoutGoogle } from './lib/workspaceAuth';
import { AppLayout } from './components/AppLayout';
import {
  LoginPage,
  RegisterPage,
  ForgotPasswordPage,
  AdminLoginPage,
} from './pages/AuthPages';
import { DashboardPage, BotsListPage } from './pages/DashboardAndBots';
import { DeployWizardPage } from './pages/DeployWizardPage';
import { BotDetailPage } from './pages/BotDetailPage';
import {
  NotificationsPage,
  ProfilePage,
  AccountSettingsPage,
  SupportPage,
} from './pages/UserAccountPages';
import {
  AdminOverviewPage,
  AdminUsersPage,
  AdminUserDetailPage,
  AdminBotsPage,
  AdminDeploymentsPage,
  AdminServersPage,
  AdminLogsAndAuditPage,
  AdminSettingsPage,
  AdminEmailsPage,
} from './pages/AdminPages';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [systemStatus, setSystemStatus] = useState<{
    maintenanceMode: boolean;
    maintenanceMessage: string;
    maintenanceReturnTime: string;
    announcementBanner: string;
  }>({
    maintenanceMode: false,
    maintenanceMessage: '',
    maintenanceReturnTime: '',
    announcementBanner: '',
  });

  const refreshSystemStatus = async () => {
    try {
      const health = await apiRequest('/api/health');
      setSystemStatus({
        maintenanceMode: Boolean(health.maintenanceMode),
        maintenanceMessage: health.maintenanceMessage || '',
        maintenanceReturnTime: health.maintenanceReturnTime || '',
        announcementBanner: health.announcementBanner || '',
      });
    } catch {
      // ignore
    }
  };

  const refreshSession = async () => {
    await refreshSystemStatus();
    const token = getStoredSessionToken();
    if (!token) {
      setInitializing(false);
      return;
    }
    try {
      const res = await apiRequest('/api/auth/me');
      setUser(res.user);
      const notifRes = await apiRequest('/api/notifications');
      const unread = (notifRes.notifications || []).filter((n: any) => !n.read).length;
      setUnreadNotifications(unread);
    } catch (err: any) {
      if (err.maintenanceMode) {
        setSystemStatus((prev) => ({
          ...prev,
          maintenanceMode: true,
          maintenanceMessage: err.message,
          maintenanceReturnTime: err.maintenanceReturnTime || prev.maintenanceReturnTime,
        }));
      } else {
        setStoredSessionToken(null);
        setUser(null);
      }
    } finally {
      setInitializing(false);
    }
  };

  useEffect(() => {
    initAuth();
    refreshSession();
  }, []);

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    await logoutGoogle();
    setStoredSessionToken(null);
    setUser(null);
  };

  if (initializing) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="font-display text-2xl font-extrabold tracking-wider bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
            LYRICAL
          </div>
          <div className="text-xs font-mono text-slate-400">
            Initializing WhatsApp Bot Hosting Platform...
          </div>
        </div>
      </div>
    );
  }

  // Global Maintenance Screen for Non-Admin Users
  const isBlockedByMaintenance =
    systemStatus.maintenanceMode && (!user || user.role !== 'admin');

  return (
    <BrowserRouter>
      <Routes>
        {/* Public Auth Routes */}
        <Route
          path="/login"
          element={
            user ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <LoginPage onAuthenticated={(u) => setUser(u)} />
            )
          }
        />
        <Route
          path="/register"
          element={
            user ? (
              <Navigate to="/dashboard" replace />
            ) : (
              <RegisterPage onAuthenticated={(u) => setUser(u)} />
            )
          }
        />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route
          path="/admin/login"
          element={<AdminLoginPage onAuthenticated={(u) => setUser(u)} />}
        />

        {/* Protected User & Admin Routes */}
        <Route
          path="/*"
          element={
            isBlockedByMaintenance ? (
              <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
                <div className="max-w-lg w-full bg-slate-900 border border-amber-500/40 rounded-xl p-8 text-center space-y-5">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-amber-500/15 text-amber-400">
                    <ShieldAlert className="w-6 h-6" />
                  </div>
                  <div className="font-display text-xl font-extrabold tracking-wider text-white">
                    LYRICAL MAINTENANCE MODE
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    {systemStatus.maintenanceMessage ||
                      'LYRICAL is currently undergoing scheduled infrastructure maintenance.'}
                  </p>
                  {systemStatus.maintenanceReturnTime && (
                    <div className="inline-flex items-center gap-2 text-xs font-mono text-amber-300 bg-slate-950 px-4 py-2 rounded-lg border border-slate-800">
                      <Clock className="w-3.5 h-3.5" />
                      Estimated Return: {systemStatus.maintenanceReturnTime}
                    </div>
                  )}
                  <div className="pt-4 border-t border-slate-800 flex items-center justify-center gap-4 text-xs">
                    <Link to="/admin/login" className="text-purple-400 hover:underline">
                      Administrator Portal Sign-In →
                    </Link>
                    {user && (
                      <button
                        type="button"
                        onClick={handleLogout}
                        className="text-slate-400 hover:text-white"
                      >
                        Sign Out
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : !user ? (
              <Navigate to="/login" replace />
            ) : (
              <AppLayout
                user={user}
                theme={theme}
                onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                onLogout={handleLogout}
                unreadNotifications={unreadNotifications}
                announcementBanner={systemStatus.announcementBanner}
              >
                <Routes>
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/bots" element={<BotsListPage />} />
                  <Route path="/bots/:id" element={<BotDetailPage />} />
                  <Route path="/bots/:id/logs" element={<BotDetailPage />} />
                  <Route path="/bots/:id/settings" element={<BotDetailPage />} />
                  <Route path="/deploy" element={<DeployWizardPage />} />
                  <Route
                    path="/notifications"
                    element={
                      <NotificationsPage onReadChange={() => setUnreadNotifications(0)} />
                    }
                  />
                  <Route
                    path="/profile"
                    element={<ProfilePage user={user} onUserUpdated={setUser} />}
                  />
                  <Route
                    path="/settings"
                    element={
                      <AccountSettingsPage
                        theme={theme}
                        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                      />
                    }
                  />
                  <Route path="/support" element={<SupportPage />} />

                  {/* Protected Admin Routes */}
                  <Route
                    path="/admin"
                    element={
                      user.role === 'admin' ? (
                        <AdminOverviewPage />
                      ) : (
                        <Navigate to="/dashboard" replace />
                      )
                    }
                  />
                  <Route
                    path="/admin/users"
                    element={
                      user.role === 'admin' ? (
                        <AdminUsersPage />
                      ) : (
                        <Navigate to="/dashboard" replace />
                      )
                    }
                  />
                  <Route
                    path="/admin/emails"
                    element={
                      user.role === 'admin' ? (
                        <AdminEmailsPage />
                      ) : (
                        <Navigate to="/dashboard" replace />
                      )
                    }
                  />
                  <Route
                    path="/admin/users/:id"
                    element={
                      user.role === 'admin' ? (
                        <AdminUserDetailPage />
                      ) : (
                        <Navigate to="/dashboard" replace />
                      )
                    }
                  />
                  <Route
                    path="/admin/bots"
                    element={
                      user.role === 'admin' ? (
                        <AdminBotsPage />
                      ) : (
                        <Navigate to="/dashboard" replace />
                      )
                    }
                  />
                  <Route
                    path="/admin/deployments"
                    element={
                      user.role === 'admin' ? (
                        <AdminDeploymentsPage />
                      ) : (
                        <Navigate to="/dashboard" replace />
                      )
                    }
                  />
                  <Route
                    path="/admin/servers"
                    element={
                      user.role === 'admin' ? (
                        <AdminServersPage />
                      ) : (
                        <Navigate to="/dashboard" replace />
                      )
                    }
                  />
                  <Route
                    path="/admin/logs"
                    element={
                      user.role === 'admin' ? (
                        <AdminLogsAndAuditPage mode="logs" />
                      ) : (
                        <Navigate to="/dashboard" replace />
                      )
                    }
                  />
                  <Route
                    path="/admin/audit-logs"
                    element={
                      user.role === 'admin' ? (
                        <AdminLogsAndAuditPage mode="audit" />
                      ) : (
                        <Navigate to="/dashboard" replace />
                      )
                    }
                  />
                  <Route
                    path="/admin/settings"
                    element={
                      user.role === 'admin' ? (
                        <AdminSettingsPage onSettingsUpdated={refreshSystemStatus} />
                      ) : (
                        <Navigate to="/dashboard" replace />
                      )
                    }
                  />

                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
              </AppLayout>
            )
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
