import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Shield,
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  Mail,
  User as UserIcon,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { apiRequest, setStoredSessionToken, User } from '../lib/api';

interface AuthProps {
  onAuthenticated: (user: User) => void;
}

export const LoginPage: React.FC<AuthProps> = ({ onAuthenticated }) => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ token: string; user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      setStoredSessionToken(res.token);
      onAuthenticated(res.user);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Invalid email or password. Please verify your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4">
      {/* Background Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-md bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl backdrop-blur-xl">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-mono font-medium mb-1">
            <Sparkles className="w-3.5 h-3.5" />
            Direct Database Authentication
          </div>
          <div className="font-display text-2xl font-extrabold tracking-wider bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
            LYRICAL
          </div>
          <h1 className="text-xl font-bold text-white">Sign in to your console</h1>
          <p className="text-xs text-slate-400">
            Enter your registered email and password to access your WhatsApp bot hosting environment
          </p>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-slate-400" />
              Email Address
            </label>
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                Password
              </label>
              <Link to="/forgot-password" className="text-xs text-cyan-400 hover:underline">
                Forgot password?
              </Link>
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-3.5 pr-10 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-800 bg-slate-950 accent-cyan-500"
              />
              Remember me on this browser
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 text-sm font-semibold rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 hover:from-cyan-400 hover:to-blue-500 transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                Signing in...
              </span>
            ) : (
              <>
                <span>Sign In to Workspace</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="pt-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>
            Don't have an account?{' '}
            <Link to="/register" className="text-cyan-400 font-semibold hover:underline">
              Create account
            </Link>
          </span>
          <Link to="/admin/login" className="text-purple-400 hover:underline flex items-center gap-1">
            <Shield className="w-3 h-3" />
            Admin Portal
          </Link>
        </div>
      </div>
    </div>
  );
};

export const RegisterPage: React.FC<AuthProps> = ({ onAuthenticated }) => {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Real-time password strength calculation
  const getPasswordStrength = () => {
    if (!password) return { score: 0, label: '', color: 'bg-slate-700' };
    let score = 0;
    if (password.length >= 6) score += 1;
    if (password.length >= 8) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password) || /[A-Z]/.test(password)) score += 1;

    switch (score) {
      case 1:
        return { score: 1, label: 'Weak', color: 'bg-rose-500' };
      case 2:
        return { score: 2, label: 'Fair', color: 'bg-amber-500' };
      case 3:
        return { score: 3, label: 'Good', color: 'bg-cyan-500' };
      case 4:
        return { score: 4, label: 'Strong', color: 'bg-emerald-500' };
      default:
        return { score: 1, label: 'Weak', color: 'bg-rose-500' };
    }
  };

  const strength = getPasswordStrength();
  const passwordsMatch = confirmPassword.length > 0 && password === confirmPassword;
  const passwordsMismatch = confirmPassword.length > 0 && password !== confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Please provide a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match. Please ensure both fields are identical.');
      return;
    }

    setLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: User }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          email: cleanEmail,
          password,
        }),
      });
      setStoredSessionToken(res.token);
      onAuthenticated(res.user);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Registration could not be completed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4">
      {/* Background Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="relative w-full max-w-md bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl backdrop-blur-xl">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-mono font-medium mb-1">
            <Sparkles className="w-3.5 h-3.5" />
            Instant Real-Time Signup
          </div>
          <div className="font-display text-2xl font-extrabold tracking-wider bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
            LYRICAL
          </div>
          <h1 className="text-xl font-bold text-white">Create your account</h1>
          <p className="text-xs text-slate-400">
            Deploy and manage 24/7 WhatsApp multi-device bots with dedicated container storage
          </p>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
              <UserIcon className="w-3.5 h-3.5 text-slate-400" />
              Full Name
            </label>
            <input
              type="text"
              required
              autoFocus
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex Mercer"
              className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-slate-400" />
              Email Address
            </label>
            <input
              type="email"
              required
              maxLength={160}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Used to log in to your account. Each user must have a unique email.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                Password (minimum 6 characters)
              </label>
              {password.length > 0 && (
                <span className="text-[10px] font-mono text-slate-400">{strength.label}</span>
              )}
            </div>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Choose a strong password"
                className="w-full pl-3.5 pr-10 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Real-time strength bars */}
            {password.length > 0 && (
              <div className="flex items-center gap-1.5 mt-2">
                {[1, 2, 3, 4].map((level) => (
                  <div
                    key={level}
                    className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                      strength.score >= level ? strength.color : 'bg-slate-800'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-300 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                Confirm Password
              </label>
              {passwordsMatch && (
                <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Passwords match
                </span>
              )}
              {passwordsMismatch && (
                <span className="text-[11px] text-rose-400">Passwords do not match</span>
              )}
            </div>
            <input
              type={showPassword ? 'text' : 'password'}
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter your password"
              className={`w-full px-3.5 py-2.5 text-sm bg-slate-950 border rounded-xl text-white placeholder-slate-500 focus:outline-none transition-colors ${
                passwordsMismatch
                  ? 'border-rose-500 focus:border-rose-500'
                  : passwordsMatch
                  ? 'border-emerald-500/70 focus:border-emerald-500'
                  : 'border-slate-800 focus:border-cyan-500'
              }`}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 text-sm font-semibold rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 hover:from-cyan-400 hover:to-blue-500 transition-all shadow-lg shadow-cyan-500/20 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer pt-3"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                Creating account...
              </span>
            ) : (
              <>
                <span>Create Account & Continue</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="pt-4 border-t border-slate-800 text-center text-xs text-slate-400">
          Already have an account?{' '}
          <Link to="/login" className="text-cyan-400 font-semibold hover:underline">
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
};

export const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify(
          step === 1 ? { email } : { email, newPassword, recoveryCode: 'VERIFIED' }
        ),
      });
      setMessage(res.message);
      if (step === 1) setStep(2);
    } catch (err: any) {
      setError(err.message || 'Password reset could not be completed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl">
        <div className="text-center space-y-2">
          <div className="font-display text-2xl font-extrabold tracking-wider bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
            LYRICAL
          </div>
          <h1 className="text-xl font-bold text-white">Password Recovery</h1>
          <p className="text-xs text-slate-400">
            Enter your account email to configure a new password directly
          </p>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {message && (
          <div className="p-3.5 rounded-xl bg-cyan-950/60 border border-cyan-500/40 text-xs text-cyan-200 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>{message}</span>
          </div>
        )}

        <form onSubmit={handleRequestReset} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Account Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          {step === 2 && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                New Password (minimum 6 characters)
              </label>
              <input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 text-sm font-semibold rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 hover:from-cyan-400 hover:to-blue-500 transition-all disabled:opacity-50"
          >
            {loading ? 'Processing...' : step === 1 ? 'Verify Email' : 'Save New Password'}
          </button>
        </form>

        <div className="text-center text-xs text-slate-400">
          <Link to="/login" className="text-cyan-400 hover:underline">
            Return to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
};

export const AdminLoginPage: React.FC<AuthProps> = ({ onAuthenticated }) => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('ssmu1720@gmail.com');
  const [password, setPassword] = useState('');
  const [adminSecret, setAdminSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{ token: string; user: User }>('/api/auth/admin-login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim().toLowerCase(), password, adminSecret }),
      });
      setStoredSessionToken(res.token);
      onAuthenticated(res.user);
      navigate('/admin');
    } catch (err: any) {
      setError(err.message || 'Administrator authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-slate-900/90 border border-purple-500/40 rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl backdrop-blur-xl">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 text-purple-400 mb-1">
            <Shield className="w-5 h-5" />
          </div>
          <h1 className="text-xl font-bold text-white">Administrator Portal</h1>
          <p className="text-xs text-slate-400">
            System administration & infrastructure governance console
          </p>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5 text-slate-400" />
              Administrator Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-slate-400" />
              Password (or Initial Admin Key: LyricalAdmin2026!)
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter administrator password..."
              className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Optional ADMIN_SECRET Token
            </label>
            <input
              type="password"
              value={adminSecret}
              onChange={(e) => setAdminSecret(e.target.value)}
              placeholder="Optional master secret..."
              className="w-full px-3.5 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 text-sm font-semibold rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500 transition-all shadow-lg shadow-purple-500/20"
          >
            {loading ? 'Authenticating...' : 'Enter Administrator Console'}
          </button>
        </form>

        <div className="text-center text-xs text-slate-400">
          <Link to="/login" className="text-cyan-400 hover:underline">
            Return to User Sign In
          </Link>
        </div>
      </div>
    </div>
  );
};
