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
let cachedGithubToken: string | null = null;
let cachedGithubUser: { login: string; avatar_url?: string; html_url?: string } | null = null;

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
}

export const getGithubAccessToken = (): string | null => cachedGithubToken;
export const getConnectedGithubUser = () => cachedGithubUser;

export const disconnectGithub = () => {
  cachedGithubToken = null;
  cachedGithubUser = null;
};

export const githubSignIn = async (): Promise<{
  user: FirebaseUser;
  githubAccessToken: string;
  githubUsername: string;
  email: string;
} | null> => {
  try {
    isSigningIn = true;
    let result;
    if (auth.currentUser) {
      try {
        result = await linkWithPopup(auth.currentUser, githubProvider);
      } catch (linkErr: any) {
        // If already linked or credential-already-in-use, sign in directly with popup
        if (
          linkErr?.code === 'auth/provider-already-linked' ||
          linkErr?.code === 'auth/credential-already-in-use' ||
          linkErr?.code === 'auth/email-already-in-use'
        ) {
          result = await signInWithPopup(auth, githubProvider);
        } else {
          throw linkErr;
        }
      }
    } else {
      result = await signInWithPopup(auth, githubProvider);
    }

    const credential = GithubAuthProvider.credentialFromResult(result);
    const token = credential?.accessToken;
    if (!token) {
      throw new Error('Failed to obtain GitHub OAuth access token from Firebase Authentication.');
    }

    cachedGithubToken = token;

    // Fetch GitHub profile details using the OAuth token
    let ghLogin = result.user.displayName || 'github-user';
    let ghEmail = result.user.email || '';
    try {
      const ghRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      });
      if (ghRes.ok) {
        const profile = await ghRes.json();
        ghLogin = profile.login || ghLogin;
        cachedGithubUser = {
          login: profile.login,
          avatar_url: profile.avatar_url,
          html_url: profile.html_url,
        };
        if (!ghEmail && profile.email) {
          ghEmail = profile.email;
        }
      }
    } catch {
      // ignore profile fetch error
    }

    if (!ghEmail) {
      ghEmail = `${ghLogin.toLowerCase()}@users.noreply.github.com`;
    }

    await syncUserProfileToFirestore(result.user, ghLogin);

    return {
      user: result.user,
      githubAccessToken: token,
      githubUsername: ghLogin,
      email: ghEmail,
    };
  } catch (error: any) {
    if (
      error?.code === 'auth/popup-closed-by-user' ||
      error?.code === 'auth/cancelled-popup-request'
    ) {
      return null;
    }
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export async function listUserGithubRepos(): Promise<GithubRepoItem[]> {
  if (!cachedGithubToken) {
    throw new Error('NEEDS_GITHUB_AUTH');
  }
  const res = await fetch(
    'https://api.github.com/user/repos?sort=updated&per_page=50&affiliation=owner,collaborator',
    {
      headers: {
        Authorization: `Bearer ${cachedGithubToken}`,
        Accept: 'application/vnd.github+json',
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
  return await res.json();
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
