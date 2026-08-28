import { auth } from './firebase';

export interface RelationshipNotificationPreference {
  storeId: string;
  enabled: boolean;
  updatedAt: string;
}

const STORAGE_PREFIX = 'kyrub_relationship_notification_preferences_';
const EVENT_NAME = 'kyrub:relationship-notification-preference-changed';

const storageKey = (userId: string): string => `${STORAGE_PREFIX}${userId.trim()}`;

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

export const isRelationshipNotificationEnabled = (
  storeId: string,
  userId = auth.currentUser?.uid ?? ''
): boolean => {
  const normalizedUserId = userId.trim();
  const normalizedStoreId = storeId.trim();
  if (!normalizedUserId || !normalizedStoreId) return true;
  return readAll(normalizedUserId)[normalizedStoreId]?.enabled !== false;
};

export const setRelationshipNotificationEnabled = (
  storeId: string,
  enabled: boolean,
  userId = auth.currentUser?.uid ?? ''
): void => {
  const normalizedUserId = userId.trim();
  const normalizedStoreId = storeId.trim();
  if (!normalizedUserId || !normalizedStoreId) return;
  const current = readAll(normalizedUserId);
  current[normalizedStoreId] = {
    storeId: normalizedStoreId,
    enabled,
    updatedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(storageKey(normalizedUserId), JSON.stringify(current));
  } catch {
    // Preferences are best-effort until the owner-scoped cloud model is enabled.
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME, {
    detail: { storeId: normalizedStoreId, enabled },
  }));
};

export const subscribeToRelationshipNotificationPreferences = (
  listener: () => void
): (() => void) => {
  const handler = () => listener();
  window.addEventListener(EVENT_NAME, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(EVENT_NAME, handler);
    window.removeEventListener('storage', handler);
  };
};
