import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { Store } from '../types';
import { db } from './firebase';
import {
  buildUserStoreCreateData,
  buildUserStoreUpdateData,
  type BuildUserStoreCreateInput,
  type BuildUserStoreUpdateInput,
} from './userStoreDocument';
import {
  buildMarketplaceStoreCreateData,
  buildMarketplaceStoreUpdateData,
  type BuildMarketplaceStoreCreateInput,
} from './marketplaceDocuments';
import {
  getMarketplaceStoreListingDocumentPath,
} from './marketplacePaths';
import { getPrimaryUserStoreDocumentPath } from './storePaths';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StoreProfileFields {
  name: string;
  description: string;
  address: string;
  contact: string;
  keywords: string[];
}

export const getUserStoreCacheKey = (uid: string): string =>
  `kyrub_user_store_${uid}`;

export const getUserStorePendingKey = (uid: string): string =>
  `kyrub_user_store_pending_${uid}`;

const isStorePlan = (value: unknown): value is Store['plan'] =>
  value === 'free' || value === 'business';

const isStoreStatus = (value: unknown): value is Store['status'] =>
  value === 'open' || value === 'delayed' || value === 'closed';

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];

export const normalizeCachedStore = (
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
  keywords: stringArray(candidate.keywords),
  offerImages: stringArray(candidate.offerImages),
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

export const loadCachedUserStore = (
  storage: StorageLike,
  uid: string,
  ownerEmail: string
): Store | null => {
  const value = storage.getItem(getUserStoreCacheKey(uid));
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<Store>;
    if (parsed.id !== uid) return null;
    return normalizeCachedStore(parsed, uid, ownerEmail);
  } catch {
    return null;
  }
};

export const saveCachedUserStore = (
  storage: StorageLike,
  uid: string,
  store: Store,
  pendingSync: boolean
): void => {
  storage.setItem(
    getUserStoreCacheKey(uid),
    JSON.stringify(normalizeCachedStore(store, uid, store.ownerEmail))
  );

  if (pendingSync) {
    storage.setItem(getUserStorePendingKey(uid), '1');
  } else {
    storage.removeItem(getUserStorePendingKey(uid));
  }
};

export const hasPendingUserStoreSync = (
  storage: StorageLike,
  uid: string
): boolean => storage.getItem(getUserStorePendingKey(uid)) === '1';

export const slugifyStoreName = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

export const buildConfiguredStore = (
  currentStore: Store | null,
  user: Pick<User, 'uid' | 'email'>,
  fields: StoreProfileFields
): Store => {
  const ownerEmail = user.email ?? '';
  const normalizedCurrent = normalizeCachedStore(
    currentStore ?? {},
    user.uid,
    ownerEmail
  );
  const name = fields.name.trim();

  return {
    ...normalizedCurrent,
    id: user.uid,
    ownerEmail,
    name,
    slug: slugifyStoreName(name),
    description: fields.description.trim(),
    address: fields.address.trim(),
    contact: fields.contact.trim(),
    keywords: fields.keywords
      .map(keyword => keyword.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 30),
  };
};

const getCreateInput = (
  store: Store,
  user: Pick<User, 'uid' | 'email'>
): BuildUserStoreCreateInput => {
  const input: BuildUserStoreCreateInput = {
    uid: user.uid,
    ownerEmail: user.email ?? '',
    name: store.name,
    slug: store.slug,
    description: store.description,
    logo: store.logo,
    banner: store.banner,
    primaryColor: store.primaryColor,
    keywords: [...(store.keywords ?? [])],
    offerImages: [...(store.offerImages ?? [])],
    address: store.address ?? '',
    contact: store.contact ?? '',
    status: store.status ?? 'closed',
  };

  if (
    typeof store.lat === 'number' &&
    typeof store.lng === 'number' &&
    Number.isFinite(store.lat) &&
    Number.isFinite(store.lng)
  ) {
    input.lat = store.lat;
    input.lng = store.lng;
  }

  return input;
};

const getUpdateInput = (
  store: Store,
  user: Pick<User, 'uid' | 'email'>
): BuildUserStoreUpdateInput => {
  const input: BuildUserStoreUpdateInput = {
    ownerEmail: user.email ?? '',
    name: store.name,
    slug: store.slug,
    description: store.description,
    logo: store.logo,
    banner: store.banner,
    primaryColor: store.primaryColor,
    keywords: [...(store.keywords ?? [])],
    offerImages: [...(store.offerImages ?? [])],
    address: store.address ?? '',
    contact: store.contact ?? '',
    status: store.status ?? 'closed',
  };

  if (
    typeof store.lat === 'number' &&
    typeof store.lng === 'number' &&
    Number.isFinite(store.lat) &&
    Number.isFinite(store.lng)
  ) {
    input.lat = store.lat;
    input.lng = store.lng;
  }

  return input;
};

export const persistPrivateUserStore = async (
  user: Pick<User, 'uid' | 'email'>,
  store: Store
): Promise<void> => {
  const reference = doc(db, getPrimaryUserStoreDocumentPath(user.uid));
  const snapshot = await getDoc(reference);

  if (snapshot.exists()) {
    await updateDoc(reference, buildUserStoreUpdateData(getUpdateInput(store, user)));
    return;
  }

  await setDoc(reference, buildUserStoreCreateData(getCreateInput(store, user)));
};

const marketplaceInput = (
  user: Pick<User, 'uid'>,
  store: Store,
  publicationStatus: 'published' | 'paused'
): BuildMarketplaceStoreCreateInput => {
  const publicStore: BuildMarketplaceStoreCreateInput['store'] = {
    id: user.uid,
    ownerId: user.uid,
    name: store.name,
    slug: store.slug,
    description: store.description,
    address: store.address ?? '',
    logo: store.logo,
    banner: store.banner,
    primaryColor: store.primaryColor,
    keywords: [...(store.keywords ?? [])],
    status: store.status ?? 'closed',
  };

  if (
    typeof store.lat === 'number' &&
    typeof store.lng === 'number' &&
    Number.isFinite(store.lat) &&
    Number.isFinite(store.lng)
  ) {
    publicStore.lat = store.lat;
    publicStore.lng = store.lng;
  }

  return { store: publicStore, publicationStatus };
};

const persistCanonicalMarketplaceListing = async (
  user: Pick<User, 'uid'>,
  store: Store,
  publicationStatus: 'published' | 'paused'
): Promise<void> => {
  const reference = doc(
    db,
    getMarketplaceStoreListingDocumentPath(user.uid)
  );
  const snapshot = await getDoc(reference);
  const input = marketplaceInput(user, store, publicationStatus);

  if (snapshot.exists()) {
    await updateDoc(reference, buildMarketplaceStoreUpdateData(input));
  } else if (publicationStatus === 'published') {
    await setDoc(reference, buildMarketplaceStoreCreateData(input));
  }
};

const persistTenantMarketplaceFallback = async (
  user: Pick<User, 'uid' | 'email'>,
  store: Store,
  publicationStatus: 'published' | 'paused'
): Promise<void> => {
  const reference = doc(db, 'tenants', user.uid);
  const snapshot = await getDoc(reference);
  const payload: Record<string, unknown> = {
    id: user.uid,
    ownerId: user.uid,
    name: store.name,
    email: user.email ?? '',
    role: 'retailer',
    plan: store.plan,
    slug: store.slug,
    description: store.description,
    address: store.address ?? '',
    logo: store.logo,
    banner: store.banner,
    primaryColor: store.primaryColor,
    keywords: [...(store.keywords ?? [])],
    status: store.status ?? 'closed',
    publicationStatus,
    updatedAt: serverTimestamp(),
  };

  if (!snapshot.exists()) {
    payload.createdAt = serverTimestamp();
  }

  if (
    typeof store.lat === 'number' &&
    typeof store.lng === 'number' &&
    Number.isFinite(store.lat) &&
    Number.isFinite(store.lng)
  ) {
    payload.lat = store.lat;
    payload.lng = store.lng;
  }

  await setDoc(reference, payload, { merge: true });
};

export const setStoreMarketplacePublication = async (
  user: Pick<User, 'uid' | 'email'>,
  store: Store,
  published: boolean
): Promise<void> => {
  const publicationStatus = published ? 'published' : 'paused';
  let canonicalError: unknown = null;

  try {
    await persistCanonicalMarketplaceListing(
      user,
      store,
      publicationStatus
    );
  } catch (error) {
    canonicalError = error;
    console.warn('Canonical marketplace publication is unavailable.', error);
  }

  try {
    await persistTenantMarketplaceFallback(
      user,
      store,
      publicationStatus
    );
  } catch (fallbackError) {
    if (canonicalError) throw canonicalError;
    throw fallbackError;
  }
};
