import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from './firebase';

export interface RelationshipNotificationPreference {
  storeId: string;
  enabled: boolean;
  updatedAt: string;
}

const STORAGE_PREFIX = 'kyrub_relationship_notification_preferences_';
const EVENT_NAME = 'kyrub:relationship-notification-preference-changed';

const storageKey = (userId: string): string => `${STORAGE_PREFIX}${userId.trim()}`;

export const getRelationshipNotificationPreferencesCollectionPath = (userId: string): string =>
  `users/${userId.trim()}/relationshipNotificationPreferences`;

const readAll = (userId: string): Record<string, RelationshipNotificationPreference> => {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, RelationshipNotificationPreference> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([storeId, value]) => {
      if (!value || typeof value !== 'object') return;
      const record = value as Partial<RelationshipNotificationPreference>;
      result[storeId] = {
        storeId,
        enabled: record.enabled !== false,
        updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : '',
      };
    });
    return result;
  } catch {
    return {};
  }
};

const persistLocal = (
  userId: string,
  preferences: Record<string, RelationshipNotificationPreference>
): void => {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(preferences));
  } catch {
    // Cloud synchronization remains authoritative when local storage is unavailable.
  }
};

const announceChange = (storeId = '', enabled = true): void => {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, {
    detail: { storeId, enabled },
  }));
};

export const isRelationshipNotificationEnabled = (
  storeId: string,
  userId = auth.currentUser?.uid ?? ''
): boolean => {
  const normalizedUserId = userId.trim();
  const normalizedStoreId = storeId.trim();
  if (!normalizedUserId || !normalizedStoreId) return true;
  return readAll(normalizedUserId)[normalizedStoreId]?.enabled !== false;
};

export const setRelationshipNotificationEnabled = async (
  storeId: string,
  enabled: boolean,
  userId = auth.currentUser?.uid ?? ''
): Promise<void> => {
  const normalizedUserId = userId.trim();
  const normalizedStoreId = storeId.trim();
  if (!normalizedUserId || !normalizedStoreId || normalizedStoreId.includes('/')) return;
  if (auth.currentUser?.uid !== normalizedUserId) {
    throw new Error('Preferência só pode ser alterada pelo próprio usuário.');
  }

  const updatedAt = new Date().toISOString();
  const current = readAll(normalizedUserId);
  current[normalizedStoreId] = {
    storeId: normalizedStoreId,
    enabled,
    updatedAt,
  };
  persistLocal(normalizedUserId, current);
  announceChange(normalizedStoreId, enabled);

  await setDoc(
    doc(
      db,
      getRelationshipNotificationPreferencesCollectionPath(normalizedUserId),
      normalizedStoreId
    ),
    {
      storeId: normalizedStoreId,
      enabled,
      updatedAt,
      recordedAt: serverTimestamp(),
      schemaVersion: 1,
    },
    { merge: true }
  );
};

export const subscribeToRelationshipNotificationPreferences = (
  listener: () => void
): (() => void) => {
  let unsubscribeCloud: Unsubscribe | null = null;
  let activeUserId = '';

  const localHandler = () => listener();
  window.addEventListener(EVENT_NAME, localHandler);
  window.addEventListener('storage', localHandler);

  const connectCloud = (userId: string): void => {
    unsubscribeCloud?.();
    unsubscribeCloud = null;
    activeUserId = userId.trim();
    if (!activeUserId) {
      listener();
      return;
    }

    unsubscribeCloud = onSnapshot(
      collection(db, getRelationshipNotificationPreferencesCollectionPath(activeUserId)),
      snapshot => {
        const next = readAll(activeUserId);
        snapshot.docs.forEach(item => {
          const data = item.data() as Record<string, unknown>;
          const storeId = typeof data.storeId === 'string' ? data.storeId.trim() : item.id;
          if (!storeId) return;
          next[storeId] = {
            storeId,
            enabled: data.enabled !== false,
            updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
          };
        });
        persistLocal(activeUserId, next);
        announceChange();
        listener();
      },
      error => {
        console.warn('Preferências de relacionamento na nuvem indisponíveis.', error);
        listener();
      }
    );
  };

  const unsubscribeAuth = onAuthStateChanged(auth, user => connectCloud(user?.uid ?? ''));
  connectCloud(auth.currentUser?.uid ?? '');

  return () => {
    unsubscribeAuth();
    unsubscribeCloud?.();
    window.removeEventListener(EVENT_NAME, localHandler);
    window.removeEventListener('storage', localHandler);
  };
};
