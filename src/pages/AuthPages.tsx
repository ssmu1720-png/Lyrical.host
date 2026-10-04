import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shield, AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { apiRequest, setStoredSessionToken, User } from '../lib/api';
import {
  googleSignIn,
  githubSignIn,
  firebaseLoginEmailPassword,
  firebaseRegisterEmailPassword,
  firebaseResetPasswordEmail,
} from '../lib/workspaceAuth';

interface AuthProps {
  onAuthenticated: (user: User) => void;
}

const GoogleSignInButton: React.FC<{ onClick: () => void; disabled?: boolean }> = ({
  onClick,
  disabled,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="gsi-material-button disabled:opacity-50"
  >
    <div className="gsi-material-button-state"></div>
    <div className="gsi-material-button-content-wrapper">
      <div className="gsi-material-button-icon">
        <svg
          version="1.1"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 48 48"
          style={{ display: 'block' }}
        >
          <path
            fill="#EA4335"
            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
          ></path>
          <path
            fill="#4285F4"
            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
          ></path>
          <path
            fill="#FBBC05"
            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
          ></path>
          <path
            fill="#34A853"
            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
          ></path>
          <path fill="none" d="M0 0h48v48H0z"></path>
        </svg>
      </div>
      <span className="gsi-material-button-contents">Sign in with Google</span>
      <span style={{ display: 'none' }}>Sign in with Google</span>
    </div>
  </button>
);

const GithubSignInButton: React.FC<{ onClick: () => void; disabled?: boolean }> = ({
  onClick,
  disabled,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="w-full h-10 px-4 rounded-lg bg-[#24292F] hover:bg-[#2c3239] border border-slate-700 text-white text-xs font-semibold flex items-center justify-center gap-2.5 transition-colors disabled:opacity-50"
  >
    <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
    <span>Continue with GitHub</span>
  </button>
);

export const LoginPage: React.FC<AuthProps> = ({ onAuthenticated }) => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showProviderGuide, setShowProviderGuide] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // Attempt Firebase Email/Password sign in and Firestore profile sync
      try {
        await firebaseLoginEmailPassword(email, password);
      } catch (fbErr: any) {
        if (fbErr?.code === 'auth/operation-not-allowed') {
          setShowProviderGuide(true);
        }
      }
      const res = await apiRequest<{ token: string; user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setStoredSessionToken(res.token);
      onAuthenticated(res.user);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Sign in failed. Check your credentials and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await googleSignIn();
      if (result && result.user.email) {
        const res = await apiRequest<{ token: string; user: User }>('/api/auth/google-sync', {
          method: 'POST',
          body: JSON.stringify({
            email: result.user.email,
            name: result.user.displayName || result.user.email.split('@')[0],
          }),
        });
        setStoredSessionToken(res.token);
        onAuthenticated(res.user);
        navigate('/dashboard');
      }
    } catch (err: any) {
      setError(err.message || 'Google authentication could not be completed.');
    } finally {
      setLoading(false);
    }
  };

  const handleGithubLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await githubSignIn();
      if (result && result.email) {
        const res = await apiRequest<{ token: string; user: User }>('/api/auth/google-sync', {
          method: 'POST',
          body: JSON.stringify({
            email: result.email,
            name: result.githubUsername || 'GitHub Developer',
          }),
        });
        setStoredSessionToken(res.token);
        onAuthenticated(res.user);
        navigate('/dashboard');
      }
    } catch (err: any) {
      if (err?.code === 'auth/operation-not-allowed') {
        setShowProviderGuide(true);
        setError('Enable the GitHub provider in Firebase Console → Authentication → Sign-in method → GitHub.');
      } else {
        setError(err.message || 'GitHub authentication could not be completed.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-slate-900/80 border border-slate-800 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="font-display text-2xl font-extrabold tracking-wider bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
            LYRICAL
          </div>
          <h1 className="text-xl font-semibold text-white">Sign in to your hosting console</h1>
          <p className="text-xs text-slate-400">
            Deploy, monitor, and manage real-time WhatsApp bot instances backed by Firebase & Cloud Firestore
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {showProviderGuide && (
          <div className="p-3.5 rounded-lg bg-cyan-950/50 border border-cyan-500/40 text-xs text-cyan-200 space-y-1.5">
            <div className="font-semibold flex items-center gap-1.5 text-cyan-300">
              <Info className="w-4 h-4 shrink-0" />
              Enable Firebase Email/Password Sign-In
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              To enable native Firebase Email/Password authentication alongside your LYRICAL session: open the Firebase Console → Authentication → Sign-in method → Email/Password → Enable and Save.
            </p>
          </div>
        )}

        <div className="space-y-2.5">
          <GoogleSignInButton onClick={handleGoogleLogin} disabled={loading} />
          <GithubSignInButton onClick={handleGithubLogin} disabled={loading} />
        </div>

        <div className="relative flex py-1 items-center">
          <div className="flex-grow border-t border-slate-800"></div>
          <span className="flex-shrink mx-3 text-xs text-slate-500">or continue with Email / Password</span>
          <div className="flex-grow border-t border-slate-800"></div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-slate-300">Password</label>
              <Link to="/forgot-password" className="text-xs text-cyan-400 hover:underline">
                Forgot password?
              </Link>
            </div>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 text-sm font-semibold rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 hover:from-cyan-400 hover:to-blue-500 transition-all disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>
            New to LYRICAL?{' '}
            <Link to="/register" className="text-cyan-400 font-medium hover:underline">
              Create account
            </Link>
          </span>
          <Link to="/admin/login" className="text-purple-400 hover:underline">
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      // Register in Firebase Auth + Firestore if Email/Password provider is enabled
      try {
        await firebaseRegisterEmailPassword(email, password, name);
      } catch (fbErr: any) {
        if (fbErr?.code === 'auth/weak-password') {
          setError('Password should be at least 6 characters.');
          setLoading(false);
          return;
        }
        if (fbErr?.code === 'auth/invalid-email') {
          setError('Please enter a valid email address.');
          setLoading(false);
          return;
        }
        // If auth/operation-not-allowed or auth/email-already-in-use, proceed to backend sync
      }
      const res = await apiRequest<{ token: string; user: User }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password }),
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

  const handleGoogleSignUp = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await googleSignIn();
      if (result && result.user.email) {
        const res = await apiRequest<{ token: string; user: User }>('/api/auth/google-sync', {
          method: 'POST',
          body: JSON.stringify({
            email: result.user.email,
            name: result.user.displayName || result.user.email.split('@')[0],
          }),
        });
        setStoredSessionToken(res.token);
        onAuthenticated(res.user);
        navigate('/dashboard');
      }
    } catch (err: any) {
      setError(err.message || 'Google sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleGithubSignUp = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await githubSignIn();
      if (result && result.email) {
        const res = await apiRequest<{ token: string; user: User }>('/api/auth/google-sync', {
          method: 'POST',
          body: JSON.stringify({
            email: result.email,
            name: result.githubUsername || 'GitHub Developer',
          }),
        });
        setStoredSessionToken(res.token);
        onAuthenticated(res.user);
        navigate('/dashboard');
      }
    } catch (err: any) {
      if (err?.code === 'auth/operation-not-allowed') {
        setError('Enable the GitHub provider in Firebase Console → Authentication → Sign-in method → GitHub.');
      } else {
        setError(err.message || 'GitHub sign-in failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-slate-900/80 border border-slate-800 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="font-display text-2xl font-extrabold tracking-wider bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
            LYRICAL
          </div>
          <h1 className="text-xl font-semibold text-white">Create your LYRICAL account</h1>
          <p className="text-xs text-slate-400">
            Launch production WhatsApp bots with Firestore persistence and Google Drive backups
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-2.5">
          <GoogleSignInButton onClick={handleGoogleSignUp} disabled={loading} />
          <GithubSignInButton onClick={handleGithubSignUp} disabled={loading} />
        </div>

        <div className="relative flex py-1 items-center">
          <div className="flex-grow border-t border-slate-800"></div>
          <span className="flex-shrink mx-3 text-xs text-slate-500">or register with Email / Password</span>
          <div className="flex-grow border-t border-slate-800"></div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">Full Name</label>
            <input
              type="text"
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex Mercer"
              className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
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
              placeholder="you@example.com"
              className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Password (minimum 6 characters)
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 text-sm font-semibold rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 hover:from-cyan-400 hover:to-blue-500 transition-all disabled:opacity-50"
          >
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <div className="pt-2 border-t border-slate-800 text-center text-xs text-slate-400">
          Already have an account?{' '}
          <Link to="/login" className="text-cyan-400 font-medium hover:underline">
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
      if (step === 1) {
        try {
          await firebaseResetPasswordEmail(email);
        } catch {
          // also trigger backend recovery flow
        }
      }
      const res = await apiRequest('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify(
          step === 1 ? { email } : { email, newPassword, recoveryCode: 'VERIFIED' }
        ),
      });
      setMessage(res.message);
      if (step === 1) setStep(2);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-slate-900/80 border border-slate-800 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="font-display text-2xl font-extrabold tracking-wider bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
            LYRICAL
          </div>
          <h1 className="text-xl font-semibold text-white">Account Password Recovery</h1>
          <p className="text-xs text-slate-400">
            Verify your account email to configure a new password
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200">
            {error}
          </div>
        )}
        {message && (
          <div className="p-3 rounded-lg bg-cyan-950/60 border border-cyan-500/40 text-xs text-cyan-200 flex items-center gap-2">
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
              className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
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
                className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 text-sm font-semibold rounded-lg bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors"
          >
            {loading
              ? 'Processing...'
              : step === 1
              ? 'Send Recovery & Verify Email'
              : 'Reset Password'}
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
        body: JSON.stringify({ email, password, adminSecret }),
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

  const handleGoogleAdmin = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await googleSignIn();
      if (result && result.user.email) {
        const res = await apiRequest<{ token: string; user: User }>('/api/auth/google-sync', {
          method: 'POST',
          body: JSON.stringify({
            email: result.user.email,
            name: result.user.displayName || 'Administrator',
          }),
        });
        if (res.user.role !== 'admin') {
          setError('Your Google account is not authorized as a platform administrator.');
          return;
        }
        setStoredSessionToken(res.token);
        onAuthenticated(res.user);
        navigate('/admin');
      }
    } catch (err: any) {
      setError(err.message || 'Google administrator sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-slate-900/90 border border-purple-500/40 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-purple-500/15 border border-purple-500/30 text-purple-400 mb-1">
            <Shield className="w-5 h-5" />
          </div>
          <h1 className="text-xl font-semibold text-white">LYRICAL Administrator Portal</h1>
          <p className="text-xs text-slate-400">
            Restricted access. All administrative logins are recorded in the security audit trail.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-500/40 text-xs text-rose-200">
            {error}
          </div>
        )}

        <GoogleSignInButton onClick={handleGoogleAdmin} disabled={loading} />

        <div className="relative flex py-1 items-center">
          <div className="flex-grow border-t border-slate-800"></div>
          <span className="flex-shrink mx-3 text-xs text-slate-500">or administrator credentials</span>
          <div className="flex-grow border-t border-slate-800"></div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Administrator Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-purple-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Password (or Default Admin Key: LyricalAdmin2026!)
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter admin password..."
              className="w-full px-3.5 py-2.5 text-sm bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-purple-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Optional ADMIN_SECRET Override
            </label>
            <input
              type="password"
              value={adminSecret}
              onChange={(e) => setAdminSecret(e.target.value)}
              placeholder="Optional secret token..."
              className="w-full px-3.5 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-purple-500"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 text-sm font-semibold rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500 transition-all"
          >
            {loading ? 'Authenticating...' : 'Enter Administrator Console'}
          </button>
        </form>

        <div className="text-center text-xs text-slate-400">
          <Link to="/login" className="text-cyan-400 hover:underline">
            Return to Standard User Login
          </Link>
        </div>
      </div>
    </div>
  );
};
