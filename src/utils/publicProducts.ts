import {
  collection,
  doc,
  deleteField,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type {
  Product,
  ProductCategoryCollection,
  ProductOptionGroup,
} from '../types';
import {
  parseProductSaleModality,
  type ProductSaleModality,
} from '../../shared/productSaleModality';
import {
  parseSubscriptionContractDiscounts,
  type ContractTermMonths,
} from '../../shared/subscriptionContractOffers';
import { normalizeStorePointsPerUnit } from '../../shared/storePoints';
import { db } from './firebase';
import {
  chooseCanonicalReadSource,
  parseCanonicalReadConfig,
  recordCanonicalReadDecision,
  type CanonicalReadDecision,
} from './canonicalReadCutover';
import {
  parseProductOptionGroups,
  parseProductQuickNotes,
  quickNotesToOptionGroup,
  QUICK_NOTES_OPTION_GROUP_ID,
} from './productCustomization';

export const PUBLIC_PRODUCT_CREATE_EVENT = 'kyrub-public-product-create';

export type PublicProduct = Product & {
  storeId: string;
  updatedAt: string;
  contractDiscounts?: { months: ContractTermMonths; discountPercent: number }[];
};

export interface PublicProductDraft {
  name: string;
  description: string;
  price: string;
  stock: string;
  category: string;
  image: string;
  isService: boolean;
  isComplimentary?: boolean;
  storePointsPerUnit?: number;
  saleModality?: ProductSaleModality;
  contractDiscounts?: { months: ContractTermMonths; discountPercent: number }[];
  categoryCollections?: ProductCategoryCollection[];
  optionGroups?: ProductOptionGroup[];
  quickNotes?: string[];
}

export interface PublicProductCreateRequest {
  product: PublicProduct;
  accepted: boolean;
  reason?: string;
}

/** Hide offers that cannot yet be confirmed against a mapped canonical catalog. */
export const suppressUnverifiedContractDiscounts = (
  products: PublicProduct[],
  canonicalStoreId: string,
  source: CanonicalReadDecision['source']
): PublicProduct[] =>
  canonicalStoreId && source !== 'canonical'
    ? products.map(product => product.contractDiscounts === undefined
      ? product : { ...product, contractDiscounts: undefined })
    : products;

export interface PreferredPublicProductsResult {
  products: PublicProduct[];
  decision: CanonicalReadDecision;
  canonicalStoreId: string;
}

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const timestampToIso = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as Timestamp).toDate().toISOString();
  }
  return '';
};

const optionGroupsWithQuickNotes = (
  optionGroups: unknown,
  quickNotes: unknown
): ProductOptionGroup[] => {
  const baseGroups = parseProductOptionGroups(optionGroups).filter(
    group => group.id !== QUICK_NOTES_OPTION_GROUP_ID
  );
  const quickNotesGroup = quickNotesToOptionGroup(quickNotes);
  return quickNotesGroup ? [...baseGroups, quickNotesGroup] : baseGroups;
};

export const parseProductCategoryCollections = (
  value: unknown
): ProductCategoryCollection[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  return value.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object') return [];
    const record = candidate as Record<string, unknown>;
    const path = cleanString(record.path);
    const name = cleanString(record.name);
    const image = cleanString(record.image);
    const normalizedPath = path.toLocaleLowerCase('pt-BR');

    if (!path || !name || seen.has(normalizedPath)) return [];
    seen.add(normalizedPath);
    return [{ path, name, image } satisfies ProductCategoryCollection];
  });
};

export const buildPublicProduct = (
  user: Pick<User, 'uid'>,
  draft: PublicProductDraft,
  now: number = Date.now()
): PublicProduct => {
  const name = draft.name.trim();
  const category = draft.category.trim();
  const isComplimentary = draft.isComplimentary === true;
  const parsedPrice = Number.parseFloat(draft.price.replace(',', '.'));
  const price = isComplimentary ? 0 : parsedPrice;
  const parsedStock = draft.isService
    ? 0
    : Number.parseInt(draft.stock || '0', 10);
  const storePointsPerUnit = normalizeStorePointsPerUnit(draft.storePointsPerUnit);
  const saleModality = parseProductSaleModality(draft.saleModality);
  const contractDiscounts = draft.contractDiscounts === undefined
    ? undefined
    : parseSubscriptionContractDiscounts(draft.contractDiscounts);
  if (draft.contractDiscounts !== undefined && (!contractDiscounts || saleModality?.mode !== 'subscription')) {
    throw new Error('Períodos de contratação inválidos.');
  }
  const categoryCollections = parseProductCategoryCollections(
    draft.categoryCollections
  );
  const quickNotes = parseProductQuickNotes(draft.quickNotes);
  const optionGroups = optionGroupsWithQuickNotes(
    draft.optionGroups,
    quickNotes
  );

  if (!name) {
    throw new Error('Informe o nome do item.');
  }

  if (!Number.isFinite(price) || price < 0) {
    throw new Error('Informe um preço válido.');
  }

  if (!category) {
    throw new Error('Informe a categoria do item.');
  }

  if (!draft.isService && (!Number.isFinite(parsedStock) || parsedStock < 0)) {
    throw new Error('Informe um estoque válido.');
  }

  if (!saleModality) {
    throw new Error('A forma de venda do item é inválida.');
  }

  return {
    id: `product-${user.uid}-${now}`,
    storeId: user.uid,
    supplierId: user.uid,
    name,
    description: draft.description.trim(),
    price,
    image: draft.image.trim(),
    stock: draft.isService ? 0 : parsedStock,
    category,
    isService: draft.isService,
    isComplimentary,
    storePointsPerUnit,
    saleModality,
    ...(contractDiscounts ? { contractDiscounts } : {}),
    ...(categoryCollections.length > 0 ? { categoryCollections } : {}),
    ...(optionGroups.length > 0 ? { optionGroups } : {}),
    ...(quickNotes.length > 0 ? { quickNotes } : {}),
    updatedAt: new Date(now).toISOString(),
  };
};

export const parsePublicProducts = (value: unknown): PublicProduct[] => {
  if (!Array.isArray(value)) return [];

  return value.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object') return [];

    const product = candidate as Record<string, unknown>;
    const id = cleanString(product.id);
    const storeId = cleanString(product.storeId);
    const supplierId = cleanString(product.supplierId);
    const name = cleanString(product.name);
    const category = cleanString(product.category);
    const price = finiteNumber(product.price);
    const stock = finiteNumber(product.stock);
    const saleModality = parseProductSaleModality(product.saleModality);
    const contractDiscounts = product.contractDiscounts === undefined
      ? undefined : parseSubscriptionContractDiscounts(product.contractDiscounts);
    if (product.contractDiscounts !== undefined && (!contractDiscounts || saleModality?.mode !== 'subscription')) return [];
    let storePointsPerUnit = 0;
    try {
      storePointsPerUnit = normalizeStorePointsPerUnit(product.storePointsPerUnit);
    } catch {
      return [];
    }
    const categoryCollections = parseProductCategoryCollections(
      product.categoryCollections
    );
    const quickNotes = parseProductQuickNotes(product.quickNotes);
    const optionGroups = optionGroupsWithQuickNotes(
      product.optionGroups,
      quickNotes
    );

    if (
      !id ||
      !storeId ||
      !supplierId ||
      !name ||
      !category ||
      price === null ||
      price < 0 ||
      stock === null ||
      stock < 0 ||
      saleModality === null
    ) {
      return [];
    }

    return [{
      id,
      storeId,
      supplierId,
      name,
      description: cleanString(product.description),
      price: product.isComplimentary === true ? 0 : price,
      image: cleanString(product.image),
      stock,
      category,
      isService: product.isService === true,
      isComplimentary: product.isComplimentary === true,
      storePointsPerUnit,
      saleModality,
      ...(contractDiscounts ? { contractDiscounts } : {}),
      ...(categoryCollections.length > 0 ? { categoryCollections } : {}),
      ...(optionGroups.length > 0 ? { optionGroups } : {}),
      ...(quickNotes.length > 0 ? { quickNotes } : {}),
      updatedAt: cleanString(product.updatedAt),
    } satisfies PublicProduct];
  });
};

const parseCanonicalPublicProduct = (
  snapshot: QueryDocumentSnapshot<DocumentData>,
  legacyStoreId: string
): PublicProduct | null => {
  const value = snapshot.data() as Record<string, unknown>;
  const id = cleanString(value.id) || snapshot.id;
  const name = cleanString(value.name);
  const category = cleanString(value.category);
  const price = finiteNumber(value.price);
  const stock = finiteNumber(value.stock);
  const saleModality = parseProductSaleModality(value.saleModality);
  const contractDiscounts = value.contractDiscounts === undefined
    ? undefined : parseSubscriptionContractDiscounts(value.contractDiscounts);
  if (value.contractDiscounts !== undefined && (!contractDiscounts || saleModality?.mode !== 'subscription')) return null;
  let storePointsPerUnit = 0;
  try {
    storePointsPerUnit = normalizeStorePointsPerUnit(value.storePointsPerUnit);
  } catch {
    return null;
  }
  const categoryCollections = parseProductCategoryCollections(
    value.categoryCollections
  );
  const quickNotes = parseProductQuickNotes(value.quickNotes);
  const optionGroups = optionGroupsWithQuickNotes(
    value.optionGroups,
    quickNotes
  );

  if (
    !id ||
    !name ||
    !category ||
    price === null ||
    price < 0 ||
    stock === null ||
    stock < 0 ||
    saleModality === null ||
    cleanString(value.publicationStatus) !== 'published'
  ) {
    return null;
  }

  return {
    id,
    storeId: legacyStoreId,
    supplierId: legacyStoreId,
    name,
    description: cleanString(value.description),
    price: value.isComplimentary === true ? 0 : price,
    image: cleanString(value.image),
    stock: value.isService === true ? 0 : stock,
    category,
    isService: value.isService === true,
    isComplimentary: value.isComplimentary === true,
    storePointsPerUnit,
    saleModality,
    ...(contractDiscounts ? { contractDiscounts } : {}),
    ...(categoryCollections.length > 0 ? { categoryCollections } : {}),
    ...(optionGroups.length > 0 ? { optionGroups } : {}),
    ...(quickNotes.length > 0 ? { quickNotes } : {}),
    updatedAt:
      cleanString(value.legacyUpdatedAt) || timestampToIso(value.updatedAt),
  };
};

const comparableProduct = (product: PublicProduct) => ({
  id: product.id,
  name: product.name.trim(),
  description: product.description.trim(),
  price: Number(product.price.toFixed(2)),
  image: product.image.trim(),
  stock: product.isService ? 0 : product.stock,
  category: product.category.trim(),
  categoryCollections: parseProductCategoryCollections(
    product.categoryCollections
  ),
  optionGroups: optionGroupsWithQuickNotes(
    product.optionGroups,
    product.quickNotes
  ),
  quickNotes: parseProductQuickNotes(product.quickNotes),
  isService: product.isService === true,
  isComplimentary: product.isComplimentary === true,
  storePointsPerUnit: normalizeStorePointsPerUnit(product.storePointsPerUnit),
  saleModality: parseProductSaleModality(product.saleModality),
  contractDiscounts: product.contractDiscounts ?? null,
});

export const publicProductCollectionsEquivalent = (
  legacyProducts: PublicProduct[],
  canonicalProducts: PublicProduct[]
): boolean => {
  if (legacyProducts.length !== canonicalProducts.length) return false;
  const normalize = (products: PublicProduct[]) =>
    products
      .map(comparableProduct)
      .sort((left, right) => left.id.localeCompare(right.id));
  return JSON.stringify(normalize(legacyProducts)) ===
    JSON.stringify(normalize(canonicalProducts));
};

/**
 * Canonical-only editor write. The caller must select the canonical store;
 * never infer it from the legacy user ID or write a tenant mirror.
 */
/**
 * Write a product only to the canonical catalog. Read store and product inside
 * the same transaction to avoid a stale migration-status or create race.
 */
export const persistCanonicalPublicProduct = async (
  user: Pick<User, 'uid'>,
  canonicalStoreId: string,
  product: PublicProduct
): Promise<void> => {
  const storeId = canonicalStoreId.trim();
  if (!storeId || storeId === user.uid) {
    throw new Error('Selecione uma loja canônica independente do usuário.');
  }
  if (product.storeId !== user.uid || product.supplierId !== user.uid) {
    throw new Error('O produto não pertence à loja autenticada.');
  }
  const saleModality = parseProductSaleModality(product.saleModality);
  const discounts = product.contractDiscounts === undefined
    ? undefined : parseSubscriptionContractDiscounts(product.contractDiscounts);
  if (!saleModality || (product.contractDiscounts !== undefined &&
      (!discounts || saleModality.mode !== 'subscription'))) {
    throw new Error('Modalidade ou períodos de contratação inválidos.');
  }
  const storeReference = doc(db, 'stores', storeId);
  const reference = doc(db, 'stores', storeId, 'products', product.id);
  await runTransaction(db, async transaction => {
    const storeSnapshot = await transaction.get(storeReference);
    const existing = await transaction.get(reference);
    const store = storeSnapshot.data();
    if (!storeSnapshot.exists() || store?.ownerId !== user.uid ||
        store?.migrationStatus !== 'canonical') {
      throw new Error('A loja ainda não está habilitada para gravação canônica.');
    }
    const payload = {
      name: product.name.trim(),
      description: product.description.trim(),
      price: product.price,
      image: product.image.trim(),
      stock: product.isService ? 0 : product.stock,
      category: product.category.trim(),
      categoryCollections: parseProductCategoryCollections(product.categoryCollections),
      optionGroups: optionGroupsWithQuickNotes(product.optionGroups, product.quickNotes),
      quickNotes: parseProductQuickNotes(product.quickNotes),
      isService: product.isService === true,
      isComplimentary: product.isComplimentary === true,
      storePointsPerUnit: normalizeStorePointsPerUnit(product.storePointsPerUnit),
      saleModality,
      contractDiscounts: discounts ?? deleteField(),
      updatedByUserId: user.uid,
      updatedByRole: 'owner',
      updatedAt: serverTimestamp(),
    };
    if (existing.exists()) {
      const current = existing.data();
      if (current.storeId !== storeId || current.supplierId !== storeId ||
          current.id !== product.id || current.publicationStatus === 'archived') {
        throw new Error('O produto existente não pode ser alterado por este editor.');
      }
      transaction.update(reference, payload);
      return;
    }
    transaction.set(reference, {
      ...payload,
      contractDiscounts: discounts ?? [],
      id: product.id,
      storeId,
      supplierId: storeId,
      publicationStatus: 'published',
      createdByUserId: user.uid,
      createdByRole: 'owner',
      legacyStoreId: '',
      legacyProductId: '',
      legacySupplierId: '',
      legacyUpdatedAt: '',
      migratedFromPath: '',
      archivedAt: '',
      migration: { mode: 'canonical', migratedByUserId: '', migratedByRole: '' },
      createdAt: serverTimestamp(),
    });
  });
};

export const persistPublicProduct = async (
  user: Pick<User, 'uid' | 'email'>,
  product: PublicProduct
): Promise<void> => {
  if (product.storeId !== user.uid || product.supplierId !== user.uid) {
    throw new Error('O produto não pertence à loja autenticada.');
  }

  const tenantReference = doc(db, 'tenants', user.uid);

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(tenantReference);
    const currentData = snapshot.data() as Record<string, unknown> | undefined;
    const existingProducts = parsePublicProducts(currentData?.publicProducts);
    const quickNotes = parseProductQuickNotes(product.quickNotes);
    const optionGroups = optionGroupsWithQuickNotes(
      product.optionGroups,
      quickNotes
    );
    const saleModality = parseProductSaleModality(product.saleModality);
    if (!saleModality) {
      throw new Error('A forma de venda do item é inválida.');
    }
    const contractDiscounts = product.contractDiscounts === undefined
      ? undefined : parseSubscriptionContractDiscounts(product.contractDiscounts);
    if (product.contractDiscounts !== undefined && (!contractDiscounts || saleModality.mode !== 'subscription')) {
      throw new Error('Períodos de contratação inválidos.');
    }
    const normalizedProduct: PublicProduct = {
      ...product,
      storePointsPerUnit: normalizeStorePointsPerUnit(product.storePointsPerUnit),
      saleModality,
      quickNotes,
      optionGroups,
    };
    // Do not retain stale offers if a subscription is converted to a one-time sale.
    if (contractDiscounts) {
      normalizedProduct.contractDiscounts = contractDiscounts;
    } else {
      delete normalizedProduct.contractDiscounts;
    }
    const nextProducts = [
      normalizedProduct,
      ...existingProducts.filter(item => item.id !== product.id),
    ];
    // Never silently drop existing products during the legacy-to-canonical transition.
    // An oversized legacy catalog requires an explicit migration, not truncation.
    if (nextProducts.length > 200) {
      throw new Error('O catálogo antigo excede o limite seguro de 200 produtos. Migre os itens antes de continuar.');
    }

    transaction.set(
      tenantReference,
      {
        id: user.uid,
        ownerId: user.uid,
        email: user.email ?? '',
        role: 'retailer',
        plan: currentData?.plan === 'business' ? 'business' : 'free',
        publicationStatus:
          currentData?.publicationStatus === 'published' ? 'published' : 'paused',
        publicProducts: nextProducts,
        updatedAt: serverTimestamp(),
        ...(snapshot.exists() ? {} : { createdAt: serverTimestamp() }),
      },
      { merge: true }
    );
  });
};

export const subscribeToPublicProducts = (
  storeId: string,
  onProducts: (products: PublicProduct[]) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  if (!storeId) {
    onProducts([]);
    return () => undefined;
  }

  return onSnapshot(
    doc(db, 'tenants', storeId),
    snapshot => {
      onProducts(parsePublicProducts(snapshot.data()?.publicProducts));
    },
    error => {
      onProducts([]);
      onError?.(error);
    }
  );
};

export const subscribeToPreferredPublicProducts = (
  legacyStoreId: string,
  onResult: (result: PreferredPublicProductsResult) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const normalizedStoreId = legacyStoreId.trim();
  if (!normalizedStoreId) {
    onResult({
      products: [],
      canonicalStoreId: '',
      decision: { source: 'legacy', reason: 'missing_mapping' },
    });
    return () => undefined;
  }

  let legacyProducts: PublicProduct[] = [];
  let canonicalProducts: PublicProduct[] = [];
  let canonicalState: 'waiting' | 'available' | 'unavailable' = 'waiting';
  let canonicalStoreId = '';
  let canonicalEnabled = false;
  let unsubscribeCanonical: Unsubscribe = () => undefined;

  const publish = (): void => {
    const decision = chooseCanonicalReadSource(
      canonicalEnabled,
      canonicalStoreId,
      canonicalState,
      publicProductCollectionsEquivalent(legacyProducts, canonicalProducts)
    );
    recordCanonicalReadDecision(normalizedStoreId, 'products', decision);
    // Do not advertise unverified multi-month offers while a mapped canonical
    // catalog is waiting, unavailable or divergent. The payment quote reads only
    // the canonical product, so the legacy storefront cannot promise its terms.
    const selectedProducts = decision.source === 'canonical' ? canonicalProducts : legacyProducts;
    const products = suppressUnverifiedContractDiscounts(selectedProducts, canonicalStoreId, decision.source);
    onResult({
      products,
      decision,
      canonicalStoreId,
    });
  };

  const restartCanonicalSubscription = (): void => {
    unsubscribeCanonical();
    unsubscribeCanonical = () => undefined;
    canonicalProducts = [];
    canonicalState = 'waiting';

    if (!canonicalEnabled || !canonicalStoreId) {
      publish();
      return;
    }

    publish();
    unsubscribeCanonical = onSnapshot(
      query(
        collection(db, `stores/${canonicalStoreId}/products`),
        where('publicationStatus', '==', 'published')
      ),
      snapshot => {
        canonicalProducts = snapshot.docs.flatMap(document => {
          const parsed = parseCanonicalPublicProduct(
            document,
            normalizedStoreId
          );
          return parsed ? [parsed] : [];
        });
        canonicalState = 'available';
        publish();
      },
      error => {
        canonicalState = 'unavailable';
        publish();
        onError?.(error);
      }
    );
  };

  const unsubscribeTenant = onSnapshot(
    doc(db, 'tenants', normalizedStoreId),
    snapshot => {
      const previousStoreId = canonicalStoreId;
      const previousEnabled = canonicalEnabled;
      const data = snapshot.data();
      legacyProducts = parsePublicProducts(data?.publicProducts);
      const config = parseCanonicalReadConfig(data);
      canonicalStoreId = config.canonicalStoreId;
      canonicalEnabled = config.preferences.products;

      if (
        canonicalStoreId !== previousStoreId ||
        canonicalEnabled !== previousEnabled
      ) {
        restartCanonicalSubscription();
      } else {
        publish();
      }
    },
    error => {
      legacyProducts = [];
      canonicalEnabled = false;
      canonicalState = 'unavailable';
      publish();
      onError?.(error);
    }
  );

  return () => {
    unsubscribeTenant();
    unsubscribeCanonical();
  };
};
