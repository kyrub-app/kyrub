/**
 * Kyrub Offline Conflict Resolution Sync Engine
 * Implements "Last-Write-Wins" (LWW) conflict strategy for offline local Dexie DB and cloud Firestore.
 */

export interface SyncRecord {
  id: string;
  name: string;
  price: number;
  stock: number;
  updatedAt: string; // ISO String timestamp used to assert LWW
  category: string;
}

export interface SyncConflict {
  id: string;
  localRecord: SyncRecord;
  remoteRecord: SyncRecord;
  resolvedRecord: SyncRecord;
  winner: 'local' | 'remote';
  reason: string;
}

/**
 * Resolves conflict between a local offline record (Dexie) and remote server record (Firestore).
 * Strictly implements the Last-Write-Wins (LWW) strategy using 'updatedAt'.
 */
export function resolveConflictLWW(local: SyncRecord, remote: SyncRecord): SyncConflict {
  const localTime = new Date(local.updatedAt).getTime();
  const remoteTime = new Date(remote.updatedAt).getTime();

  if (isNaN(localTime) || isNaN(remoteTime)) {
    // Fallback if timestamp parsing fails
    return {
      id: local.id,
      localRecord: local,
      remoteRecord: remote,
      resolvedRecord: remote,
      winner: 'remote',
      reason: 'Invalid timestamp. Fallback to Remote Record (Server Truth).'
    };
  }

  const isLocalWinner = localTime > remoteTime;
  const resolved = isLocalWinner ? local : remote;
  const timeDifferenceSec = Math.abs((localTime - remoteTime) / 1000).toFixed(1);

  return {
    id: local.id,
    localRecord: local,
    remoteRecord: remote,
    resolvedRecord: resolved,
    winner: isLocalWinner ? 'local' : 'remote',
    reason: isLocalWinner
      ? `Local edit (${local.updatedAt}) is newer than Server (${remote.updatedAt}) by ${timeDifferenceSec}s. Overwriting cloud.`
      : `Server edit (${remote.updatedAt}) is newer or equal to Local (${local.updatedAt}) by ${timeDifferenceSec}s. Overwriting local Dexie.`
  };
}

/**
 * Simulates a full sync batch between local database and remote server
 */
export async function syncOfflineBatch(
  localDb: SyncRecord[],
  remoteDb: SyncRecord[]
): Promise<{
  syncedRecords: SyncRecord[];
  conflicts: SyncConflict[];
  logs: string[];
}> {
  const syncedRecords: SyncRecord[] = [];
  const conflicts: SyncConflict[] = [];
  const logs: string[] = [];

  logs.push(`[SyncEngine] Iniciando ciclo de sincronização Offline às ${new Date().toLocaleTimeString()}`);
  logs.push(`[SyncEngine] Registros locais no Dexie: ${localDb.length} | Registros remotos no Firestore: ${remoteDb.length}`);

  // Map to speed up lookup
  const remoteMap = new Map(remoteDb.map(r => [r.id, r]));
  const localMap = new Map(localDb.map(l => [l.id, l]));

  // Process all local entries
  for (const local of localDb) {
    const remote = remoteMap.get(local.id);

    if (!remote) {
      // Record only exists locally (added while offline)
      logs.push(`[SyncEngine] ID: ${local.id} - Apenas local. Fazendo upload automático para a nuvem.`);
      syncedRecords.push(local);
    } else {
      // Conflict checking
      if (local.updatedAt !== remote.updatedAt) {
        // Timestamps differ, trigger LWW
        const conflict = resolveConflictLWW(local, remote);
        conflicts.push(conflict);
        syncedRecords.push(conflict.resolvedRecord);
        logs.push(`[SyncEngine] CONFLITO ENCONTRADO em ID: ${local.id}. Vencedor: ${conflict.winner.toUpperCase()} - ${conflict.reason}`);
      } else {
        // No conflict, matching state
        syncedRecords.push(remote);
      }
    }
  }

  // Find remote items not present locally (added on other devices)
  for (const remote of remoteDb) {
    if (!localMap.has(remote.id)) {
      logs.push(`[SyncEngine] ID: ${remote.id} - Novo registro na nuvem. Baixando para o Dexie local.`);
      syncedRecords.push(remote);
    }
  }

  logs.push(`[SyncEngine] Sincronização concluída com sucesso! ${conflicts.length} conflito(s) resolvido(s).`);
  return { syncedRecords, conflicts, logs };
}

import { doc, getDoc, setDoc, collection, onSnapshot } from 'firebase/firestore';
import { db, auth } from './firebase';
import { classifyFirestoreFailure } from './firestoreFailure';

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
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

/**
 * Saves a document to Firestore using the LWW strategy if it exists, otherwise creates it.
 * Works background dual-write seamlessly.
 */
export async function saveDocLWW(colPath: string, docId: string, localData: any): Promise<{ winner: 'local' | 'remote'; resolvedData: any }> {
  try {
    const docRef = doc(db, colPath, docId);
    const docSnap = await getDoc(docRef).catch(err => {
      handleFirestoreError(err, OperationType.GET, `${colPath}/${docId}`);
    });
    if (docSnap && docSnap.exists()) {
      const remoteData = docSnap.data();
      if (remoteData && remoteData.updatedAt && localData.updatedAt) {
        const remoteTime = new Date(remoteData.updatedAt).getTime();
        const localTime = new Date(localData.updatedAt).getTime();
        if (remoteTime > localTime) {
          return { winner: 'remote', resolvedData: { ...remoteData, id: docSnap.id } };
        }
      }
    }
    // If local is newer or remote does not exist, write local to Firestore
    const dataToWrite = { ...localData };
    // Remove functions or undefined values if any
    Object.keys(dataToWrite).forEach(key => {
      if (dataToWrite[key] === undefined) {
        delete dataToWrite[key];
      }
    });
    await setDoc(docRef, { ...dataToWrite, updatedAt: dataToWrite.updatedAt || new Date().toISOString() }).catch(err => {
      handleFirestoreError(err, OperationType.WRITE, `${colPath}/${docId}`);
    });
    return { winner: 'local', resolvedData: localData };
  } catch (e) {
    console.error(`Error in saveDocLWW for path ${colPath}/${docId}:`, e);
    // If it's already an error containing our JSON, just rethrow it
    if (e instanceof Error && e.message.startsWith('{"error":')) {
      throw e;
    }
    handleFirestoreError(e, OperationType.WRITE, `${colPath}/${docId}`);
  }
}

/**
 * Real-time collection snapshot listener
 */
const toSafeCollectionPath = (collectionPath: string): string =>
  collectionPath
    .split('/')
    .map((segment, index) => index % 2 === 1 ? '{document}' : segment)
    .join('/');

export function listenCollection(colPath: string, callback: (docs: any[]) => void) {
  const safePath = toSafeCollectionPath(colPath);

  try {
    return onSnapshot(collection(db, colPath), (snapshot) => {
      const list: any[] = [];
      snapshot.forEach((doc) => {
        list.push({ ...doc.data(), id: doc.id });
      });
      callback(list);
    }, (error) => {
      const navigatorOnline =
        typeof navigator === 'undefined'
          ? true
          : navigator.onLine;
      const failure = classifyFirestoreFailure(error, navigatorOnline);

      console.warn('Firestore collection listener failed', {
        path: safePath,
        kind: failure.kind,
        code: failure.code
      });
    });
  } catch (error) {
    const navigatorOnline =
      typeof navigator === 'undefined'
        ? true
        : navigator.onLine;
    const failure = classifyFirestoreFailure(error, navigatorOnline);

    console.warn('Firestore collection listener setup failed', {
      path: safePath,
      kind: failure.kind,
      code: failure.code
    });

    return () => {};
  }
}
