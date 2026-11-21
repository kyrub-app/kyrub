import {
  collection, doc, getDocFromCache, getDocFromServer, getDocsFromServer,
  query, where,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { getPublicCommunityFromServer } from './communityCloud';

export interface PublicCommunityReadProbe {
  directServer: string;
  ownerMatchesSession: string;
  canonicalMapper: string;
  publicQuery: string;
  ownerQuery: string;
  cache: string;
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
  };
  const user = auth.currentUser;
  if (!user || !/^[A-Za-z0-9_-]{1,128}$/.test(communityId)) {
    return { ...empty, directServer: user ? 'identificador inválido' : 'sem autenticação' };
  }

  const reference = doc(db, 'communities', communityId);
  const result = { ...empty };
  await Promise.all([
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
