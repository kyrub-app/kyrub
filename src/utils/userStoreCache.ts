import type { Store } from '../types';

export interface UserStoreCacheEntry {
  version: 1;
  pendingSync: boolean;
  store: Store;
}

export interface UserStoreCacheStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const getUserStoreCacheKey = (uid: string): string =>
  `kyrub_user_store_${uid}`;

const isStoreStatus = (value: unknown): value is Store['status'] =>
  value === 'open' || value === 'delayed' || value === 'closed';

const isStorePlan = (value: unknown): value is Store['plan'] =>
  value === 'free' || value === 'business';

const normalizeStore = (
  candidate: Partial<Store>,
  uid: string,
  ownerEmail: string
): Store => ({
  id: uid,
  name: typeof candidate.name === 'string' ? candidate.name : '',
  slug: typeof candidate.slug === 'string' ? candidate.slug : '',
  description:
    typeof candidate.description === 'string' ? candidate.description : '',
  logo: typeof candidate.logo === 'string' ? candidate.logo : '',
  banner: typeof candidate.banner === 'string' ? candidate.banner : '',
  primaryColor:
    typeof candidate.primaryColor === 'string' ? candidate.primaryColor : '',
  plan: isStorePlan(candidate.plan) ? candidate.plan : 'free',
  ownerEmail,
  address: typeof candidate.address === 'string' ? candidate.address : '',
  contact: typeof candidate.contact === 'string' ? candidate.contact : '',
  keywords: Array.isArray(candidate.keywords)
    ? candidate.keywords.filter(
        (keyword): keyword is string => typeof keyword === 'string'
      )
    : [],
  offerImages: Array.isArray(candidate.offerImages)
    ? candidate.offerImages.filter(
        (image): image is string => typeof image === 'string'
      )
    : [],
  status: isStoreStatus(candidate.status) ? candidate.status : 'closed',
  lat:
    typeof candidate.lat === 'number' && Number.isFinite(candidate.lat)
      ? candidate.lat
      : undefined,
  lng:
    typeof candidate.lng === 'number' && Number.isFinite(candidate.lng)
      ? candidate.lng
      : undefined,
});

export const serializeUserStoreCache = (
  store: Store,
  pendingSync: boolean
): string =>
  JSON.stringify({
    version: 1,
    pendingSync,
    store,
  } satisfies UserStoreCacheEntry);

export const parseUserStoreCache = (
  value: string,
  uid: string,
  ownerEmail: string
): UserStoreCacheEntry | null => {
  try {
    const parsed = JSON.parse(value) as
      | UserStoreCacheEntry
      | (Partial<Store> & { id?: unknown });

    if (
      parsed &&
      typeof parsed === 'object' &&
      'version' in parsed &&
      parsed.version === 1 &&
      'store' in parsed &&
      parsed.store &&
      typeof parsed.store === 'object'
    ) {
      if (parsed.store.id !== uid) return null;

      return {
        version: 1,
        pendingSync: parsed.pendingSync === true,
        store: normalizeStore(parsed.store, uid, ownerEmail),
      };
    }

    // Backward compatibility with the plain Store JSON used before cache v1.
    if (parsed && typeof parsed === 'object' && parsed.id === uid) {
      return {
        version: 1,
        pendingSync: true,
        store: normalizeStore(parsed, uid, ownerEmail),
      };
    }
  } catch {
    return null;
  }

  return null;
};

export const loadUserStoreCache = (
  storage: UserStoreCacheStorage,
  uid: string,
  ownerEmail: string
): UserStoreCacheEntry | null => {
  const value = storage.getItem(getUserStoreCacheKey(uid));
  return value ? parseUserStoreCache(value, uid, ownerEmail) : null;
};

export const saveUserStoreCache = (
  storage: UserStoreCacheStorage,
  uid: string,
  store: Store,
  pendingSync: boolean
): void => {
  storage.setItem(
    getUserStoreCacheKey(uid),
    serializeUserStoreCache(store, pendingSync)
  );
};
