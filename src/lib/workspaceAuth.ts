import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  linkWithPopup,
  GoogleAuthProvider,
  GithubAuthProvider,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  updatePassword,
  updateProfile,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
];

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Validate connection to Firestore on boot (Mandatory skill requirement)
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Ensure UserProfile document exists in Firestore and adheres to firebase-blueprint.json
export async function syncUserProfileToFirestore(
  fbUser: FirebaseUser,
  displayName?: string
): Promise<void> {
  const userPath = `users/${fbUser.uid}`;
  const userRef = doc(db, 'users', fbUser.uid);
  try {
    const snap = await getDoc(userRef);
    const safeName = (
      displayName ||
      fbUser.displayName ||
      fbUser.email?.split('@')[0] ||
      'User'
    )
      .trim()
      .slice(0, 80);
    const safeEmail = (fbUser.email || 'user@lyrical.cloud').trim().slice(0, 160);
    const isAdminUser =
      safeEmail.toLowerCase() === 'ssmu1720@gmail.com' && fbUser.emailVerified;

    if (!snap.exists()) {
      await setDoc(userRef, {
        uid: fbUser.uid.slice(0, 128),
        email: safeEmail,
        name: safeName,
        role: isAdminUser ? 'admin' : 'user',
        suspended: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        name: safeName,
        email: safeEmail,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function syncBotDocumentToFirestore(bot: {
  id: string;
  name: string;
  description: string;
  runtime: 'nodejs' | 'python';
  repoUrl: string;
  branch: string;
  startCommand: string;
  port: number;
  region: string;
  status: 'running' | 'stopped' | 'deploying' | 'failed';
  whatsappAuthMethod: 'pairing_code' | 'qr_code';
  whatsappState:
    | 'CONNECTED'
    | 'CONNECTING'
    | 'DISCONNECTED'
    | 'AUTHENTICATION REQUIRED'
    | 'ERROR';
}): Promise<void> {
  if (!auth.currentUser) return;
  const botId = bot.id.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 64);
  const path = `bots/${botId}`;
  const botRef = doc(db, 'bots', botId);

  try {
    // Ensure user profile exists first (Global Consistency Invariant)
    await syncUserProfileToFirestore(auth.currentUser);
    const snap = await getDoc(botRef);
    if (!snap.exists()) {
      await setDoc(botRef, {
        id: botId,
        ownerId: auth.currentUser.uid.slice(0, 128),
        name: bot.name.trim().slice(0, 64),
        description: (bot.description || '').slice(0, 240),
        runtime: bot.runtime === 'python' ? 'python' : 'nodejs',
        repoUrl: (bot.repoUrl || '').slice(0, 300),
        branch: (bot.branch || 'main').slice(0, 64),
        startCommand: (bot.startCommand || 'node index.js').slice(0, 160),
        port: Math.min(65535, Math.max(1, Math.floor(Number(bot.port) || 8080))),
        region: (bot.region || 'eu-west-2 (London)').slice(0, 64),
        status: bot.status,
        whatsappAuthMethod: bot.whatsappAuthMethod,
        whatsappState: bot.whatsappState,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(botRef, {
        name: bot.name.trim().slice(0, 64),
        description: (bot.description || '').slice(0, 240),
        repoUrl: (bot.repoUrl || '').slice(0, 300),
        branch: (bot.branch || 'main').slice(0, 64),
        startCommand: (bot.startCommand || 'node index.js').slice(0, 160),
        port: Math.min(65535, Math.max(1, Math.floor(Number(bot.port) || 8080))),
        status: bot.status,
        whatsappAuthMethod: bot.whatsappAuthMethod,
        whatsappState: bot.whatsappState,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteBotDocumentFromFirestore(botId: string): Promise<void> {
  if (!auth.currentUser) return;
  const cleanId = botId.replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 64);
  const path = `bots/${cleanId}`;
  try {
    const snap = await getDoc(doc(db, 'bots', cleanId));
    if (snap.exists()) {
      await deleteDoc(doc(db, 'bots', cleanId));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function listUserBotsFromFirestore() {
  if (!auth.currentUser) return [];
  const path = 'bots';
  try {
    const q = query(collection(db, 'bots'), where('ownerId', '==', auth.currentUser.uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data());
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

// Firebase Email/Password Authentication Helpers
export async function firebaseRegisterEmailPassword(
  email: string,
  password: string,
  name: string
): Promise<FirebaseUser> {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await updateProfile(cred.user, { displayName: name.trim().slice(0, 80) });
  await syncUserProfileToFirestore(cred.user, name);
  return cred.user;
}

export async function firebaseLoginEmailPassword(
  email: string,
  password: string
): Promise<FirebaseUser> {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  await syncUserProfileToFirestore(cred.user);
  return cred.user;
}

export async function firebaseResetPasswordEmail(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

export async function firebaseChangePassword(newPassword: string): Promise<void> {
  if (auth.currentUser) {
    await updatePassword(auth.currentUser, newPassword);
  }
}

// Google Workspace OAuth Setup (In-Memory Access Token Only)
const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}

// GitHub OAuth Provider via Firebase Authentication
const githubProvider = new GithubAuthProvider();
githubProvider.addScope('repo');
githubProvider.addScope('read:user');
githubProvider.addScope('user:email');

let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedGithubToken: string | null = (() => {
  try {
    return localStorage.getItem('lyrical_github_token');
  } catch {
    return null;
  }
})();

let cachedGithubUser: { login: string; avatar_url?: string; html_url?: string } | null = (() => {
  try {
    const raw = localStorage.getItem('lyrical_github_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
})();

export interface GithubRepoItem {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  default_branch: string;
  private: boolean;
  description: string | null;
  updated_at: string;
  language: string | null;
  stargazers_count?: number;
  forks_count?: number;
  topics?: string[];
}

export const getGithubAccessToken = (): string | null => cachedGithubToken;
export const getConnectedGithubUser = () => cachedGithubUser;

export const disconnectGithub = async () => {
  cachedGithubToken = null;
  cachedGithubUser = null;
  try {
    localStorage.removeItem('lyrical_github_token');
    localStorage.removeItem('lyrical_github_user');
  } catch {}
  try {
    await fetch('/api/github/disconnect', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('lyrical_auth_token') || ''}`,
      },
    });
  } catch {}
};

export const checkGithubStatus = async (): Promise<{
  connected: boolean;
  oauthConfigured: boolean;
  callbackUrl?: string;
  user: { login: string; avatar_url?: string } | null;
}> => {
  try {
    const sessionToken = localStorage.getItem('lyrical_auth_token');
    if (!sessionToken) {
      return {
        connected: !!cachedGithubToken,
        oauthConfigured: false,
        user: cachedGithubUser,
      };
    }
    const res = await fetch('/api/github/status', {
      headers: { Authorization: `Bearer ${sessionToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.user) {
        cachedGithubUser = data.user;
        try {
          localStorage.setItem('lyrical_github_user', JSON.stringify(data.user));
        } catch {}
      }
      return data;
    }
  } catch {}

  return {
    connected: !!cachedGithubToken,
    oauthConfigured: false,
    user: cachedGithubUser,
  };
};

export const connectGithubWithToken = async (
  token: string
): Promise<{ login: string; avatar_url?: string; html_url?: string }> => {
  const cleanToken = token.trim();
  const sessionToken = localStorage.getItem('lyrical_auth_token');

  // Try server endpoint first to persist for this user account
  if (sessionToken) {
    const res = await fetch('/api/github/connect-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ token: cleanToken }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Invalid GitHub token. Please verify token permissions (needs "repo" and "read:user").');
    }

    const data = await res.json();
    cachedGithubToken = cleanToken;
    cachedGithubUser = {
      login: data.user.login,
      avatar_url: data.user.avatar_url,
      html_url: data.user.html_url,
    };
    try {
      localStorage.setItem('lyrical_github_token', cleanToken);
      localStorage.setItem('lyrical_github_user', JSON.stringify(cachedGithubUser));
    } catch {}
    return cachedGithubUser;
  }

  // Fallback direct check against GitHub API
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${cleanToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'LYRICAL-Cloud-Platform',
    },
  });
  if (!res.ok) {
    throw new Error('Invalid GitHub Personal Access Token. Please verify token permissions and expiration.');
  }
  const profile = await res.json();
  cachedGithubToken = cleanToken;
  cachedGithubUser = {
    login: profile.login,
    avatar_url: profile.avatar_url,
    html_url: profile.html_url,
  };
  try {
    localStorage.setItem('lyrical_github_token', cleanToken);
    localStorage.setItem('lyrical_github_user', JSON.stringify(cachedGithubUser));
  } catch {}
  return cachedGithubUser;
};

export const fetchPublicGithubRepos = async (
  username: string
): Promise<GithubRepoItem[]> => {
  const clean = username.trim().replace(/^@/, '');
  if (!clean) return [];

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
  };
  if (cachedGithubToken) {
    headers['Authorization'] = `Bearer ${cachedGithubToken}`;
  }

  // First try user repos
  let res = await fetch(
    `https://api.github.com/users/${encodeURIComponent(clean)}/repos?sort=updated&per_page=100`,
    { headers }
  );

  // If 404, try organization repos
  if (res.status === 404) {
    res = await fetch(
      `https://api.github.com/orgs/${encodeURIComponent(clean)}/repos?sort=updated&per_page=100`,
      { headers }
    );
  }

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`GitHub user or organization "@${clean}" was not found.`);
    }
    if (res.status === 403) {
      throw new Error('GitHub API rate limit exceeded. Connect with GitHub Token to raise rate limits.');
    }
    throw new Error(`Failed to fetch repositories for "@${clean}".`);
  }

  return await res.json();
};

/**
 * Initiates GitHub OAuth Popup Flow following OAuth Integration Guidelines (SKILL.md)
 */
export const githubOAuthSignIn = async (): Promise<{
  token: string;
  user: { login: string; avatar_url?: string; html_url?: string };
}> => {
  // 1. Fetch the OAuth URL from server
  const urlRes = await fetch('/api/auth/github/url');
  if (!urlRes.ok) {
    throw new Error('Failed to retrieve GitHub OAuth configuration.');
  }
  const urlData = await urlRes.json();
  if (!urlData.configured || !urlData.url) {
    const err: any = new Error(
      urlData.message ||
        'GitHub OAuth App credentials (CLIENT_ID) are not configured. Please use a GitHub Personal Access Token or configure OAuth credentials.'
    );
    err.code = 'OAUTH_NOT_CONFIGURED';
    err.redirectUri = urlData.redirectUri;
    throw err;
  }

  // 2. Open popup directly with provider authorization URL
  const popup = window.open(
    urlData.url,
    'github_oauth_popup',
    'width=600,height=720,menubar=no,toolbar=no,status=no'
  );

  if (!popup) {
    throw new Error('Sign-in popup was blocked by your browser. Please allow popups for this site and try again.');
  }

  // 3. Wait for postMessage event from popup callback
  return new Promise((resolve, reject) => {
    let resolved = false;

    const timer = setInterval(() => {
      if (popup.closed && !resolved) {
        clearInterval(timer);
        window.removeEventListener('message', messageListener);
        reject(new Error('GitHub authorization window was closed before completing.'));
      }
    }, 1000);

    const messageListener = async (event: MessageEvent) => {
      // Validate origin
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost') && origin !== window.location.origin) {
        return;
      }

      if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.provider === 'github') {
        resolved = true;
        clearInterval(timer);
        window.removeEventListener('message', messageListener);

        const token = event.data.token;
        const ghUser = event.data.user || { login: 'github-user' };

        cachedGithubToken = token;
        cachedGithubUser = ghUser;
        try {
          localStorage.setItem('lyrical_github_token', token);
          localStorage.setItem('lyrical_github_user', JSON.stringify(ghUser));
        } catch {}

        // Persist to user record on server
        const sessionToken = localStorage.getItem('lyrical_auth_token');
        if (sessionToken) {
          try {
            await fetch('/api/github/save-session-token', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${sessionToken}`,
              },
              body: JSON.stringify({ token, user: ghUser }),
            });
          } catch {}
        }

        resolve({ token, user: ghUser });
      }
    };

    window.addEventListener('message', messageListener);
  });
};

export const githubSignIn = async (): Promise<{
  user?: FirebaseUser;
  githubAccessToken: string;
  githubUsername: string;
  email: string;
} | null> => {
  // First attempt OAuth skill popup flow
  try {
    const oauthRes = await githubOAuthSignIn();
    return {
      githubAccessToken: oauthRes.token,
      githubUsername: oauthRes.user.login,
      email: `${oauthRes.user.login}@users.noreply.github.com`,
    };
  } catch (oauthErr: any) {
    if (oauthErr.code === 'OAUTH_NOT_CONFIGURED') {
      // Re-throw so UI can offer immediate PAT token input
      throw oauthErr;
    }
    // If user closed popup
    if (oauthErr.message?.includes('closed')) {
      return null;
    }
    throw oauthErr;
  }
};

export async function listUserGithubRepos(): Promise<GithubRepoItem[]> {
  const sessionToken = localStorage.getItem('lyrical_auth_token');

  // Try server endpoint first
  if (sessionToken) {
    try {
      const res = await fetch('/api/github/repos', {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
          Accept: 'application/vnd.github+json',
        },
      });
      if (res.ok) {
        const data = await res.json();
        return data.repos || [];
      }
    } catch {}
  }

  // Fallback to direct client API if cached token exists
  if (!cachedGithubToken) {
    throw new Error('NEEDS_GITHUB_AUTH');
  }

  const res = await fetch(
    'https://api.github.com/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator',
    {
      headers: {
        Authorization: `Bearer ${cachedGithubToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'LYRICAL-Cloud-Platform',
      },
    }
  );

  if (res.status === 401 || res.status === 403) {
    cachedGithubToken = null;
    throw new Error('NEEDS_GITHUB_AUTH');
  }
  if (!res.ok) {
    throw new Error('Failed to fetch repositories from GitHub.');
  }

  const repos = await res.json();
  return repos.map((r: any) => ({
    id: r.id,
    name: r.name,
    full_name: r.full_name,
    private: !!r.private,
    description: r.description,
    clone_url: r.clone_url,
    html_url: r.html_url,
    default_branch: r.default_branch || 'main',
    language: r.language || null,
    stargazers_count: r.stargazers_count || 0,
    updated_at: r.updated_at,
    fork: !!r.fork,
  }));
}

export const initAuth = (
  onAuthSuccess?: (user: FirebaseUser, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: FirebaseUser | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{
  user: FirebaseUser;
  accessToken: string;
} | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Firebase Auth');
    }
    cachedAccessToken = credential.accessToken;
    await syncUserProfileToFirestore(result.user);
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    if (
      error?.code === 'auth/popup-closed-by-user' ||
      error?.code === 'auth/cancelled-popup-request'
    ) {
      // User closed or dismissed the popup window voluntarily
      return null;
    }
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export function formatAuthError(error: any): string | null {
  if (!error) return null;
  const code = error?.code || '';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return null;
  }
  if (code === 'auth/popup-blocked') {
    return 'The sign-in popup was blocked by your browser. Please allow popups for this site and try again.';
  }
  if (code === 'auth/unauthorized-domain') {
    const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'your-domain.app';
    return `This domain is not authorized in Firebase. In Firebase Console → Authentication → Settings → Authorized domains, add: ${currentHost}`;
  }
  if (code === 'auth/operation-not-allowed') {
    return 'This authentication provider is not enabled in Firebase Console. Go to Firebase Console → Authentication → Sign-in method and enable it.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Network connection issue. Please check your internet connection and try again.';
  }
  return error.message || 'Authentication could not be completed.';
}

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const logoutGoogle = async () => {
  try {
    await auth.signOut();
  } catch {
    // ignore
  }
  cachedAccessToken = null;
};

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
}

export async function listGoogleDriveFiles(searchQuery = ''): Promise<DriveFileItem[]> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('NEEDS_GOOGLE_AUTH');
  }
  const qParts = ["trashed = false", "mimeType != 'application/vnd.google-apps.folder'"];
  if (searchQuery.trim()) {
    const escaped = searchQuery.trim().replace(/'/g, "\\'");
    qParts.push(`name contains '${escaped}'`);
  }
  const params = new URLSearchParams({
    pageSize: '25',
    fields: 'files(id, name, mimeType, size, modifiedTime)',
    q: qParts.join(' and '),
    orderBy: 'modifiedTime desc',
  });

  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401 || res.status === 403) {
    cachedAccessToken = null;
    throw new Error('NEEDS_GOOGLE_AUTH');
  }
  if (!res.ok) {
    throw new Error('Failed to fetch files from Google Drive.');
  }
  const data = await res.json();
  return data.files || [];
}

export async function downloadGoogleDriveFileText(fileId: string): Promise<string> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('NEEDS_GOOGLE_AUTH');
  }
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error('Unable to read file contents from Google Drive.');
  }
  return await res.text();
}

export async function saveFileToGoogleDrive(
  name: string,
  content: string,
  mimeType = 'text/plain'
): Promise<DriveFileItem> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('NEEDS_GOOGLE_AUTH');
  }

  const metadata = {
    name,
    mimeType,
  };

  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;

  const multipartRequestBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${mimeType}\r\n\r\n` +
    content +
    closeDelimiter;

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary="${boundary}"`,
      },
      body: multipartRequestBody,
    }
  );

  if (!res.ok) {
    throw new Error('Failed to upload file to Google Drive.');
  }
  return await res.json();
}

export async function deleteGoogleDriveFile(fileId: string): Promise<void> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('NEEDS_GOOGLE_AUTH');
  }
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error('Failed to delete file from Google Drive.');
  }
}
