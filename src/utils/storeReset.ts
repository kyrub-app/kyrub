import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type WriteBatch,
} from 'firebase/firestore';
import type { MarketplaceListingDocument, Store } from '../types';
import { getCanonicalProductsCollectionPath } from './canonicalProductDualWrite';
import { db } from './firebase';
import { getMarketplaceListingsCollectionPath } from './marketplacePaths';
import { resolveCanonicalStoreForLegacyTenant } from './operationalDualWrite';
import {
  createEmptyStoreOperationalSettings,
  getStoreOperationalSettingsCacheKey,
} from './storeOperationalSettings';
import {
  persistPrivateUserStore,
  saveCachedUserStore,
  setStoreMarketplacePublication,
  type StorageLike,
} from './storePersistence';

export const STORE_RESET_CONFIRMATION_TEXT = 'EXCLUIR';
export const STORE_RESTART_SESSION_KEY = 'kyrub_store_restart_completed';

const LOCAL_PRODUCTS_KEY = 'kyrub_products';
const LOCAL_TENANTS_KEY = 'kyrub_tenants';
const LOCAL_ATENDIMENTO_SPACES_KEY = 'kyrub_atendimento_spaces';
const LOCAL_PRODUCAO_SPACES_KEY = 'kyrub_producao_spaces';

export interface StoreResetResult {
  store: Store;
  archivedCanonicalProducts: number;
  pausedMarketplaceOffers: number;
  preservedOperationalHistory: true;
  warnings: string[];
}

export const hasMeaningfulStoreSetup = (store: Store | null): boolean => {
  if (!store) return false;

  return Boolean(
    store.name.trim() ||
      store.slug.trim() ||
      store.description.trim() ||
      store.logo.trim() ||
      store.banner.trim() ||
      store.primaryColor.trim() ||
      store.address?.trim() ||
      store.contact?.trim() ||
      (store.keywords?.length ?? 0) > 0 ||
      (store.offerImages?.length ?? 0) > 0 ||
      store.status === 'open' ||
      store.status === 'delayed'
  );
};

export const buildRestartedStore = (
  user: Pick<User, 'uid' | 'email'>,
  currentStore: Store
): Store => {
  if (currentStore.id && currentStore.id !== user.uid) {
    throw new Error('A loja selecionada não pertence ao usuário autenticado.');
  }

  return {
    id: user.uid,
    name: '',
    slug: '',
    description: '',
    logo: '',
    banner: '',
    primaryColor: '',
    plan: currentStore.plan,
    ownerEmail: user.email ?? '',
    address: '',
    contact: '',
    keywords: [],
    offerImages: [],
    status: 'closed',
  };
};

const commitOperations = async (
  operations: Array<(batch: WriteBatch) => void>
): Promise<void> => {
  for (let index = 0; index < operations.length; index += 400) {
    const batch = writeBatch(db);
    operations.slice(index, index + 400).forEach(operation => operation(batch));
    await batch.commit();
  }
};

const clearLegacyMarketplaceCopy = async (
  user: Pick<User, 'uid' | 'email'>,
  store: Store
): Promise<void> => {
  await setDoc(
    doc(db, 'tenants', user.uid),
    {
      id: user.uid,
      ownerId: user.uid,
      email: user.email ?? '',
      role: 'retailer',
      plan: store.plan,
      name: '',
      slug: '',
      description: '',
      address: '',
      logo: '',
      banner: '',
      primaryColor: '',
      keywords: [],
      status: 'closed',
      publicationStatus: 'paused',
      publicProducts: [],
      operationalSettings: createEmptyStoreOperationalSettings(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

const pauseMarketplaceOfferListings = async (
  userId: string
): Promise<number> => {
  const snapshot = await getDocs(
    query(
      collection(db, getMarketplaceListingsCollectionPath()),
      where('ownerId', '==', userId)
    )
  );
  const offerDocuments = snapshot.docs.filter(snapshotDocument => {
    const listing = snapshotDocument.data() as MarketplaceListingDocument;
    return (
      listing.listingType === 'offer' &&
      listing.publicationStatus !== 'paused'
    );
  });

  await commitOperations(
    offerDocuments.map(snapshotDocument => batch =>
      batch.update(snapshotDocument.ref, {
        publicationStatus: 'paused',
        updatedAt: serverTimestamp(),
      })
    )
  );

  return offerDocuments.length;
};

const pauseCanonicalStoreAndArchiveCatalog = async (
  user: Pick<User, 'uid'>,
  legacyStoreId: string
): Promise<number> => {
  const canonicalStore = await resolveCanonicalStoreForLegacyTenant(
    user,
    legacyStoreId
  );
  if (!canonicalStore) return 0;

  const productsSnapshot = await getDocs(
    collection(db, getCanonicalProductsCollectionPath(canonicalStore.id))
  );
  const activeProductDocuments = productsSnapshot.docs.filter(
    snapshotDocument => snapshotDocument.data().publicationStatus !== 'archived'
  );

  await updateDoc(doc(db, 'stores', canonicalStore.id), {
    publicationStatus: 'paused',
    updatedAt: serverTimestamp(),
  });

  await commitOperations(
    activeProductDocuments.map(snapshotDocument => batch =>
      batch.update(snapshotDocument.ref, {
        publicationStatus: 'archived',
        updatedByUserId: user.uid,
        updatedByRole: 'owner',
        archivedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    )
  );

  return activeProductDocuments.length;
};

const filterStoredArray = (
  storage: StorageLike,
  key: string,
  keep: (candidate: Record<string, unknown>) => boolean
): void => {
  const serialized = storage.getItem(key);
  if (!serialized) return;

  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (!Array.isArray(parsed)) {
      storage.removeItem(key);
      return;
    }

    const filtered = parsed.filter(candidate => {
      if (!candidate || typeof candidate !== 'object') return false;
      return keep(candidate as Record<string, unknown>);
    });
    storage.setItem(key, JSON.stringify(filtered));
  } catch {
    storage.removeItem(key);
  }
};

export const clearLocalStoreSetup = (
  storage: StorageLike,
  userId: string
): void => {
  filterStoredArray(
    storage,
    LOCAL_PRODUCTS_KEY,
    candidate =>
      candidate.supplierId !== userId && candidate.storeId !== userId
  );
  filterStoredArray(
    storage,
    LOCAL_TENANTS_KEY,
    candidate => candidate.id !== userId
  );
  storage.removeItem(LOCAL_ATENDIMENTO_SPACES_KEY);
  storage.removeItem(LOCAL_PRODUCAO_SPACES_KEY);
  storage.removeItem(getStoreOperationalSettingsCacheKey(userId));
};

export const resetStoreForRestart = async (
  user: Pick<User, 'uid' | 'email'>,
  currentStore: Store,
  storage: StorageLike
): Promise<StoreResetResult> => {
  if (!user.uid) throw new Error('Faça login novamente para excluir a loja.');

  const restartedStore = buildRestartedStore(user, currentStore);
  const warnings: string[] = [];
  let archivedCanonicalProducts = 0;
  let pausedMarketplaceOffers = 0;

  await clearLegacyMarketplaceCopy(user, restartedStore);

  try {
    await setStoreMarketplacePublication(user, restartedStore, false);
  } catch (error) {
    console.warn('Store reset could not refresh every marketplace mirror.', error);
    warnings.push('Uma cópia secundária da vitrine ficou pendente para sincronização.');
  }

  try {
    pausedMarketplaceOffers = await pauseMarketplaceOfferListings(user.uid);
  } catch (error) {
    console.warn('Marketplace offer cleanup is unavailable.', error);
    warnings.push('Ofertas antigas do índice canônico serão ocultadas na próxima sincronização.');
  }

  try {
    archivedCanonicalProducts = await pauseCanonicalStoreAndArchiveCatalog(
      user,
      user.uid
    );
  } catch (error) {
    console.warn('Canonical catalog archival is unavailable.', error);
    warnings.push('O catálogo canônico será arquivado pela gravação dupla assim que ela reconectar.');
  }

  await persistPrivateUserStore(user, restartedStore);
  saveCachedUserStore(storage, user.uid, restartedStore, false);
  clearLocalStoreSetup(storage, user.uid);

  return {
    store: restartedStore,
    archivedCanonicalProducts,
    pausedMarketplaceOffers,
    preservedOperationalHistory: true,
    warnings,
  };
};
