import fs from 'fs';
import path from 'path';
import { DatabaseSchema } from './db.ts';

interface FirebaseConfig {
  projectId: string;
  firestoreDatabaseId: string;
  apiKey: string;
}

let firebaseConfig: FirebaseConfig = {
  projectId: 'gen-lang-client-0483014059',
  firestoreDatabaseId: 'ai-studio-lyrical-b9890ed5-f09d-48dc-95a3-2608f6cbc797',
  apiKey: 'AIzaSyDdttyySf0aXkZGSkSX8V_na0Z9uH-pbps',
};

// Try loading from firebase-applet-config.json if present
try {
  const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(cfgPath)) {
    const raw = fs.readFileSync(cfgPath, 'utf-8');
    const parsed = JSON.parse(raw);
    firebaseConfig = {
      projectId: parsed.projectId || firebaseConfig.projectId,
      firestoreDatabaseId: parsed.firestoreDatabaseId || firebaseConfig.firestoreDatabaseId,
      apiKey: parsed.apiKey || firebaseConfig.apiKey,
    };
  }
} catch {
  // fallback to defaults
}

const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;

class CloudFirestoreSync {
  private lastSyncTime: string | null = null;
  private lastSyncError: string | null = null;
  private isSyncing = false;

  public getStatus() {
    return {
      connected: this.lastSyncError === null && this.lastSyncTime !== null,
      lastSyncTime: this.lastSyncTime,
      lastSyncError: this.lastSyncError,
      databaseId: firebaseConfig.firestoreDatabaseId,
      projectId: firebaseConfig.projectId,
    };
  }

  /**
   * Loads persisted database state from Cloud Firestore
   */
  public async loadFromFirestore(): Promise<DatabaseSchema | null> {
    const url = `${FIRESTORE_BASE_URL}/platformState/current?key=${firebaseConfig.apiKey}`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404) {
          console.log('[FIRESTORE-SYNC] No prior remote database state found in Cloud Firestore.');
          return null;
        }
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 150)}`);
      }

      const doc = await res.json();
      const payloadString = doc?.fields?.payload?.stringValue;
      if (!payloadString) {
        return null;
      }

      const parsed: DatabaseSchema = JSON.parse(payloadString);
      this.lastSyncTime = new Date().toISOString();
      this.lastSyncError = null;
      console.log(
        `[FIRESTORE-SYNC] Successfully restored database from Cloud Firestore (${parsed.users?.length || 0} users, ${parsed.bots?.length || 0} bots, ${parsed.emails?.length || 0} emails).`
      );
      return parsed;
    } catch (err: any) {
      console.warn(`[FIRESTORE-SYNC] Could not restore from Cloud Firestore: ${err.message}`);
      this.lastSyncError = err.message;
      return null;
    }
  }

  /**
   * Persists database state to Cloud Firestore
   */
  public async saveToFirestore(data: DatabaseSchema): Promise<boolean> {
    if (this.isSyncing) return false;
    this.isSyncing = true;

    try {
      const now = new Date().toISOString();
      const serialized = JSON.stringify(data);

      const body = {
        fields: {
          payload: { stringValue: serialized },
          lastSavedAt: { stringValue: now },
          usersCount: { integerValue: String(data.users?.length || 0) },
          botsCount: { integerValue: String(data.bots?.length || 0) },
          deploymentsCount: { integerValue: String(data.deployments?.length || 0) },
          emailsCount: { integerValue: String(data.emails?.length || 0) },
        },
      };

      const url = `${FIRESTORE_BASE_URL}/platformState/current?key=${firebaseConfig.apiKey}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 150)}`);
      }

      this.lastSyncTime = now;
      this.lastSyncError = null;
      return true;
    } catch (err: any) {
      console.error(`[FIRESTORE-SYNC] Failed to save state to Cloud Firestore: ${err.message}`);
      this.lastSyncError = err.message;
      return false;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Saves a historical cloud snapshot
   */
  public async saveHistoricalSnapshot(data: DatabaseSchema): Promise<boolean> {
    try {
      const now = new Date().toISOString();
      const snapshotId = `snap_${Date.now()}`;
      const serialized = JSON.stringify(data);

      const body = {
        fields: {
          payload: { stringValue: serialized },
          createdAt: { stringValue: now },
          usersCount: { integerValue: String(data.users?.length || 0) },
          botsCount: { integerValue: String(data.bots?.length || 0) },
        },
      };

      const url = `${FIRESTORE_BASE_URL}/cloudBackups/${snapshotId}?key=${firebaseConfig.apiKey}`;
      await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return true;
    } catch {
      return false;
    }
  }
}

export const cloudFirestoreSync = new CloudFirestoreSync();
