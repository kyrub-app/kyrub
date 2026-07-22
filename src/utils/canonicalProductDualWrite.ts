import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  writeBatch,
  type DocumentData,
  type Unsubscribe,
  type WriteBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  parsePublicProducts,
  type PublicProduct,
} from './publicProducts';
import {
  activateOperationalDualWrite,
  resolveCanonicalStoreForLegacyTenant,
} from './operationalDualWrite';
import type { CanonicalStoreRecord } from './storeDirectory';
import type { StoreRole } from './storeSecurity';

export type CanonicalProductPublicationStatus =
  | 'draft'
  | 'published'
  | 'paused'
  | 'archived';

export interface CanonicalProductMirrorData {
  id: string;
  storeId: string;
  supplierId: string;
  name: string;
  description: string;
  price: number;
  image: string;
  stock: number;
  category: string;
  isService: boolean;
  publicationStatus: CanonicalProductPublicationStatus;
  createdByUserId: string;
  createdByRole: StoreRole;
  updatedByUserId: string;
  updatedByRole: StoreRole;
  legacyStoreId: string;
  legacyProductId: string;
  legacySupplierId: string;
  legacyUpdatedAt: string;
  migratedFromPath: string;
  archivedAt: string;
  migration: {
    mode: 'dual_write';
    migratedByUserId: string;
    migratedByRole: StoreRole;
  };
}

export interface CanonicalProductSyncStats {
  created: number;
  updated: number;
  archived: number;
  unchanged: number;
}

export interface CanonicalProductDualWriteCallbacks {
  onReady?: (store: CanonicalStoreRecord) => void;
  onSynced?: (stats: CanonicalProductSyncStats) => void;
  onError?: (error: Error) => void;
  onUnavailable?: () => void;
}

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const getCanonicalProductsCollectionPath = (storeId: string): string =>
  `stores/${storeId.trim()}/products`;

export const getCanonicalProductDocumentPath = (
  storeId: string,
  productId: string
): string => `${getCanonicalProductsCollectionPath(storeId)}/${productId.trim()}`;

export const getLegacyPublicProductLogicalPath = (
  legacyStoreId: string,
  productId: string
): string => `tenants/${legacyStoreId.trim()}#publicProducts/${productId.trim()}`;

export const selectLegacyPublicProductsForStore = (
  products: PublicProduct[],
  legacyStoreId: string
): PublicProduct[] => {
  const expectedStoreId = legacyStoreId.trim();
  if (!expectedStoreId) throw new Error('A loja antiga não foi identificada.');

  const seen = new Set<string>();
  for (const product of products) {
    if (
      product.storeId !== expectedStoreId ||
      product.supplierId !== expectedStoreId
    ) {
      throw new Error(
        `O produto “${product.name}” não pertence à loja antiga selecionada.`
      );
    }
    if (seen.has(product.id)) {
      throw new Error(`O produto “${product.name}” está duplicado no catálogo antigo.`);
    }
    seen.add(product.id);
  }

  return products;
};

export const parseLegacyPublicProductsForStore = (
  value: unknown,
  legacyStoreId: string
): PublicProduct[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error('O catálogo antigo possui um formato inválido.');
  }

  const parsed = parsePublicProducts(value);
  if (parsed.length !== value.length) {
    throw new Error('Um ou mais produtos antigos possuem dados inválidos.');
  }

  return selectLegacyPublicProductsForStore(parsed, legacyStoreId);
};

export const buildCanonicalProductMirrorData = (
  product: PublicProduct,
  canonicalStoreId: string,
  migratedByUserId: string,
  migratedByRole: StoreRole = 'owner'
): CanonicalProductMirrorData => {
  const storeId = canonicalStoreId.trim();
  const actorUserId = migratedByUserId.trim();
  const legacyStoreId = product.storeId.trim();

  if (!storeId) throw new Error('A loja canônica não foi identificada.');
  if (!actorUserId) throw new Error('O responsável pela migração não foi identificado.');
  if (storeId === legacyStoreId) {
    throw new Error('O catálogo canônico exige um storeId independente do UID legado.');
  }
  if (product.supplierId !== legacyStoreId) {
    throw new Error('O fornecedor legado do produto não corresponde à loja antiga.');
  }
  if (!Number.isFinite(product.price) || product.price < 0) {
    throw new Error(`O preço de “${product.name}” é inválido.`);
  }
  if (!Number.isInteger(product.stock) || product.stock < 0) {
    throw new Error(`O estoque de “${product.name}” é inválido.`);
  }

  return {
    id: product.id,
    storeId,
    supplierId: storeId,
    name: product.name.trim(),
    description: product.description.trim(),
    price: product.price,
    image: product.image.trim(),
    stock: product.isService ? 0 : product.stock,
    category: product.category.trim(),
    isService: product.isService === true,
    publicationStatus: 'published',
    createdByUserId: actorUserId,
    createdByRole: migratedByRole,
    updatedByUserId: actorUserId,
    updatedByRole: migratedByRole,
    legacyStoreId,
    legacyProductId: product.id,
    legacySupplierId: product.supplierId,
    legacyUpdatedAt: product.updatedAt,
    migratedFromPath: getLegacyPublicProductLogicalPath(
      legacyStoreId,
      product.id
    ),
    archivedAt: '',
    migration: {
      mode: 'dual_write',
      migratedByUserId: actorUserId,
      migratedByRole,
    },
  };
};

const comparableProductFields = (
  value: Record<string, unknown>
): Record<string, unknown> => ({
  name: cleanString(value.name),
  description: cleanString(value.description),
  price: finiteNumber(value.price),
  image: cleanString(value.image),
  stock: finiteNumber(value.stock),
  category: cleanString(value.category),
  isService: value.isService === true,
  publicationStatus: cleanString(value.publicationStatus),
  legacyUpdatedAt: cleanString(value.legacyUpdatedAt),
  archivedAt: cleanString(value.archivedAt),
});

export const canonicalProductNeedsUpdate = (
  existing: Record<string, unknown>,
  next: CanonicalProductMirrorData
): boolean =>
  JSON.stringify(comparableProductFields(existing)) !==
  JSON.stringify(comparableProductFields(next as unknown as Record<string, unknown>));

const assertCanonicalProductIdentity = (
  existing: Record<string, unknown>,
  next: CanonicalProductMirrorData
): void => {
  const existingMigration = existing.migration as Record<string, unknown> | undefined;
  if (
    cleanString(existing.id) !== next.id ||
    cleanString(existing.storeId) !== next.storeId ||
    cleanString(existing.supplierId) !== next.supplierId ||
    cleanString(existing.legacyStoreId) !== next.legacyStoreId ||
    cleanString(existing.legacyProductId) !== next.legacyProductId ||
    cleanString(existing.migratedFromPath) !== next.migratedFromPath ||
    cleanString(existingMigration?.mode) !== 'dual_write'
  ) {
    throw new Error(
      `O produto “${next.name}” conflita com outro registro canônico e não foi sobrescrito.`
    );
  }
};

export const getCanonicalProductIdsToArchive = (
  canonicalProducts: Array<{ id: string; data: Record<string, unknown> }>,
  currentProductIds: ReadonlySet<string>,
  legacyStoreId: string
): string[] =>
  canonicalProducts.flatMap(product => {
    const migration = product.data.migration as Record<string, unknown> | undefined;
    const belongsToLegacyStore =
      cleanString(product.data.legacyStoreId) === legacyStoreId.trim() &&
      cleanString(migration?.mode) === 'dual_write';
    const isAlreadyArchived =
      cleanString(product.data.publicationStatus) === 'archived';

    return belongsToLegacyStore &&
      !currentProductIds.has(product.id) &&
      !isAlreadyArchived
      ? [product.id]
      : [];
  });

const commitOperations = async (
  operations: Array<(batch: WriteBatch) => void>
): Promise<void> => {
  for (let index = 0; index < operations.length; index += 400) {
    const batch = writeBatch(db);
    operations.slice(index, index + 400).forEach(operation => operation(batch));
    await batch.commit();
  }
};

const assertMigrationContext = (
  user: Pick<User, 'uid'>,
  canonicalStore: CanonicalStoreRecord,
  legacyStoreId: string
): void => {
  if (canonicalStore.ownerId !== user.uid) {
    throw new Error('A loja canônica não pertence ao usuário autenticado.');
  }
  if (canonicalStore.legacyTenantId !== legacyStoreId.trim()) {
    throw new Error('A loja antiga não corresponde ao cadastro canônico selecionado.');
  }
  if (canonicalStore.id === legacyStoreId.trim()) {
    throw new Error('O storeId canônico precisa ser independente do UID legado.');
  }
};

export const syncLegacyProductsToCanonical = async (
  user: Pick<User, 'uid'>,
  canonicalStore: CanonicalStoreRecord,
  legacyProducts: PublicProduct[]
): Promise<CanonicalProductSyncStats> => {
  assertMigrationContext(user, canonicalStore, canonicalStore.legacyTenantId);
  const products = selectLegacyPublicProductsForStore(
    legacyProducts,
    canonicalStore.legacyTenantId
  );
  const canonicalSnapshot = await getDocs(
    collection(db, getCanonicalProductsCollectionPath(canonicalStore.id))
  );
  const canonicalProducts = canonicalSnapshot.docs.map(snapshot => ({
    id: snapshot.id,
    data: snapshot.data() as Record<string, unknown>,
  }));
  const canonicalById = new Map(
    canonicalProducts.map(product => [product.id, product.data])
  );
  const currentProductIds = new Set(products.map(product => product.id));
  const operations: Array<(batch: WriteBatch) => void> = [];
  const stats: CanonicalProductSyncStats = {
    created: 0,
    updated: 0,
    archived: 0,
    unchanged: 0,
  };

  for (const product of products) {
    const next = buildCanonicalProductMirrorData(
      product,
      canonicalStore.id,
      user.uid,
      'owner'
    );
    const reference = doc(
      db,
      getCanonicalProductDocumentPath(canonicalStore.id, product.id)
    );
    const existing = canonicalById.get(product.id);

    if (!existing) {
      operations.push(batch =>
        batch.set(reference, {
          ...next,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      stats.created += 1;
      continue;
    }

    assertCanonicalProductIdentity(existing, next);
    if (!canonicalProductNeedsUpdate(existing, next)) {
      stats.unchanged += 1;
      continue;
    }

    operations.push(batch =>
      batch.update(reference, {
        name: next.name,
        description: next.description,
        price: next.price,
        image: next.image,
        stock: next.stock,
        category: next.category,
        isService: next.isService,
        publicationStatus: 'published',
        updatedByUserId: user.uid,
        updatedByRole: 'owner',
        legacyUpdatedAt: next.legacyUpdatedAt,
        archivedAt: '',
        updatedAt: serverTimestamp(),
      })
    );
    stats.updated += 1;
  }

  const idsToArchive = getCanonicalProductIdsToArchive(
    canonicalProducts,
    currentProductIds,
    canonicalStore.legacyTenantId
  );
  idsToArchive.forEach(productId => {
    const reference = doc(
      db,
      getCanonicalProductDocumentPath(canonicalStore.id, productId)
    );
    operations.push(batch =>
      batch.update(reference, {
        publicationStatus: 'archived',
        updatedByUserId: user.uid,
        updatedByRole: 'owner',
        archivedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    stats.archived += 1;
  });

  await commitOperations(operations);
  return stats;
};

export const subscribeToCanonicalProductDualWrite = async (
  user: Pick<User, 'uid'>,
  legacyStoreId: string,
  callbacks: CanonicalProductDualWriteCallbacks = {}
): Promise<Unsubscribe> => {
  const canonicalStore = await resolveCanonicalStoreForLegacyTenant(
    user,
    legacyStoreId
  );
  if (!canonicalStore) {
    callbacks.onUnavailable?.();
    return () => undefined;
  }

  const activeStore = await activateOperationalDualWrite(user, canonicalStore);
  callbacks.onReady?.(activeStore);

  let queue = Promise.resolve();
  const unsubscribe = onSnapshot(
    doc(db, 'tenants', legacyStoreId),
    snapshot => {
      queue = queue
        .then(async () => {
          if (!snapshot.exists()) {
            callbacks.onUnavailable?.();
            return;
          }
          const products = parseLegacyPublicProductsForStore(
            snapshot.data().publicProducts,
            legacyStoreId
          );
          const stats = await syncLegacyProductsToCanonical(
            user,
            activeStore,
            products
          );
          callbacks.onSynced?.(stats);
        })
        .catch(error =>
          callbacks.onError?.(
            error instanceof Error
              ? error
              : new Error('Falha na gravação dupla do catálogo.')
          )
        );
    },
    error => callbacks.onError?.(error)
  );

  return unsubscribe;
};
