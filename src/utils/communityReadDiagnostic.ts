import { getApps } from 'firebase/app';
import { doc as liteDoc, getDoc as getLiteDoc } from 'firebase/firestore/lite';
import {
  collection, doc, getDocFromCache, getDocFromServer, getDocsFromServer,
  query, where,
} from 'firebase/firestore';
import { auth, db, liteDb } from './firebase';
import { getPublicCommunityFromServer } from './communityCloud';
import { probeCommunityGoogleRest } from './communityRestReadProbe';

export interface PublicCommunityReadProbe {
  directServer: string;
  ownerMatchesSession: string;
  canonicalMapper: string;
  publicQuery: string;
  ownerQuery: string;
  cache: string;
  runtimeProject: string;
  authFirestoreApp: string;
  database: string;
  databaseProject: string;
  firestoreHost: string;
  initializedApps: string;
  googleRestDocument: string;
  firestoreLiteDocument: string;
  sdkSnapshotSource: string;
  sdkPendingWrites: string;
  querySnapshotSource: string;
  queryPendingWrites: string;
}

/**
 * Explicit, user-triggered, read-only troubleshooting.
 * No data is written, logged, uploaded or shared with the server.
 * No UID, token, document body or personal information enters the result.
 */
const ERROR_CODES = new Set([
  'permission-denied', 'unauthenticated', 'unavailable', 'failed-precondition',
  'deadline-exceeded', 'not-found', 'resource-exhausted', 'cancelled',
]);

export const describeCommunityReadError = (error: unknown): string => {
  if (error && typeof error === 'object' && 'code' in error &&
      typeof error.code === 'string' && ERROR_CODES.has(error.code)) {
    return error.code;
  }
  return 'erro-desconhecido';
};

const failure = (error: unknown): string => 'ERRO: ' + describeCommunityReadError(error);

const withDeadline = <T>(operation: Promise<T>): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((_resolve, reject) => {
    timeout = setTimeout(() => reject({ code: 'deadline-exceeded' }), 8_000);
  });
  return Promise.race([operation, deadline]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
};

export const probePublicCommunityRead = async (communityId: string): Promise<PublicCommunityReadProbe> => {
  const empty: PublicCommunityReadProbe = {
    directServer: 'não executado',
    ownerMatchesSession: 'não verificado',
    canonicalMapper: 'não executado',
    publicQuery: 'não executada',
    ownerQuery: 'não executada',
    cache: 'não verificado',
    runtimeProject: 'não verificado',
    authFirestoreApp: 'não verificado',
    database: 'não verificado',
    databaseProject: 'não verificado',
    firestoreHost: 'não verificado',
    initializedApps: 'não verificado',
    googleRestDocument: 'não executado',
    firestoreLiteDocument: 'não executado',
    sdkSnapshotSource: 'não verificada',
    sdkPendingWrites: 'não verificado',
    querySnapshotSource: 'não verificada',
    queryPendingWrites: 'não verificado',
  };
  const user = auth.currentUser;
  if (!user || !/^[A-Za-z0-9_-]{1,128}$/.test(communityId)) {
    return { ...empty, directServer: user ? 'identificador inválido' : 'sem autenticação' };
  }

  const reference = doc(db, 'communities', communityId);
  const result = { ...empty };
  // Compare local Firebase identity with the canonical production project.
  // Only yes/no and non-identifying environment classifications are displayed;
  // never show project IDs, app identifiers, hostnames, user IDs or credentials.
  const expectedProject = 'kyrub-b8d0e';
  const authProjectId = auth.app.options.projectId;
  const dbProjectId = db.app.options.projectId;
  result.runtimeProject =
    authProjectId === expectedProject && dbProjectId === expectedProject
      ? 'projeto esperado' : 'projeto divergente';
  result.authFirestoreApp =
    auth.app.name === db.app.name && authProjectId === dbProjectId
      ? 'mesmo aplicativo' : 'aplicativos diferentes';
  result.initializedApps = getApps().length === 1 ? 'um' : 'mais de um';

  // Firebase's internal database settings are read-only and optional. If an
  // SDK update changes their shape, report unknown instead of guessing.
  const internal = db as unknown as {
    _databaseId?: { projectId?: string; database?: string };
    _settings?: { host?: string };
  };
  result.database = internal._databaseId?.database === '(default)'
    ? 'banco padrão' : typeof internal._databaseId?.database === 'string'
      ? 'banco alternativo' : 'não informado pelo SDK';
  result.databaseProject = typeof internal._databaseId?.projectId === 'string'
    ? internal._databaseId.projectId === expectedProject
      ? 'projeto esperado' : 'projeto divergente'
    : 'não informado pelo SDK';
  const currentHost = internal._settings?.host;
  result.firestoreHost = typeof currentHost === 'string'
    ? currentHost === 'firestore.googleapis.com'
      ? 'servidor padrão do Firebase' : 'servidor alternativo'
    : 'não informado pelo SDK';
  await Promise.all([
    (async () => {
      // Firestore Lite uses a direct REST read and no persistent local cache.
      // Uses the same FirebaseApp/Auth identity; no credentials are disclosed.
      try {
        const snapshot = await withDeadline(getLiteDoc(liteDoc(liteDb, 'communities', communityId)));
        result.firestoreLiteDocument = snapshot.exists()
          ? 'documento encontrado' : 'documento não encontrado';
      } catch (error) {
        result.firestoreLiteDocument = failure(error);
      }
    })(),
    (async () => {
      result.googleRestDocument = await probeCommunityGoogleRest(user, communityId);
    })(),
    (async () => {
      try {
        const snapshot = await withDeadline(getDocFromCache(reference));
        result.cache = snapshot.exists() ? 'documento presente' : 'documento ausente';
      } catch (error) {
        const code = describeCommunityReadError(error);
        result.cache = code === 'unavailable' ? 'sem documento em cache' : 'ERRO: ' + code;
      }
    })(),
    (async () => {
      try {
        const snapshot = await withDeadline(getDocFromServer(reference));
        result.sdkSnapshotSource = snapshot.metadata.fromCache ? 'cache' : 'servidor';
        result.sdkPendingWrites = snapshot.metadata.hasPendingWrites ? 'sim' : 'não';
        if (!snapshot.exists()) {
          result.directServer = 'documento não encontrado';
        } else {
          result.directServer = 'documento encontrado';
          result.ownerMatchesSession = snapshot.data().ownerId === user.uid ? 'sim' : 'não';
        }
      } catch (error) {
        result.directServer = failure(error);
      }
    })(),
    (async () => {
      try {
        const mapped = await withDeadline(getPublicCommunityFromServer(communityId));
        result.canonicalMapper = mapped ? 'documento reconhecido' : 'documento não reconhecido';
      } catch (error) {
        result.canonicalMapper = failure(error);
      }
    })(),
    (async () => {
      try {
        const publicSnapshot = await withDeadline(getDocsFromServer(query(
          collection(db, 'communities'),
          where('visibility', 'in', ['public', 'moderated']),
        )));
        result.querySnapshotSource = publicSnapshot.metadata.fromCache ? 'cache' : 'servidor';
        result.queryPendingWrites = publicSnapshot.metadata.hasPendingWrites ? 'sim' : 'não';
        result.publicQuery = publicSnapshot.docs.some(snapshot => snapshot.id === communityId)
          ? 'incluído (' + publicSnapshot.size + ' encontrados)'
          : 'ausente (' + publicSnapshot.size + ' encontrados)';
      } catch (error) {
        result.publicQuery = failure(error);
      }
    })(),
    (async () => {
      try {
        const ownedSnapshot = await withDeadline(getDocsFromServer(query(
          collection(db, 'communities'),
          where('ownerId', '==', user.uid),
        )));
        result.ownerQuery = ownedSnapshot.docs.some(snapshot => snapshot.id === communityId)
          ? 'incluído'
          : 'não incluído';
      } catch (error) {
        result.ownerQuery = failure(error);
      }
    })(),
  ]);

  return result;
};
