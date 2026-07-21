import { doc, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { Product } from '../types';
import { db } from './firebase';

export const PUBLIC_PRODUCT_CREATE_EVENT = 'kyrub-public-product-create';

export type PublicProduct = Product & {
  storeId: string;
  updatedAt: string;
};

export interface PublicProductDraft {
  name: string;
  description: string;
  price: string;
  stock: string;
  category: string;
  image: string;
  isService: boolean;
}

export interface PublicProductCreateRequest {
  product: PublicProduct;
  accepted: boolean;
  reason?: string;
}

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const buildPublicProduct = (
  user: Pick<User, 'uid'>,
  draft: PublicProductDraft,
  now: number = Date.now()
): PublicProduct => {
  const name = draft.name.trim();
  const category = draft.category.trim();
  const price = Number.parseFloat(draft.price.replace(',', '.'));
  const parsedStock = draft.isService
    ? 0
    : Number.parseInt(draft.stock || '0', 10);

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

    if (
      !id ||
      !storeId ||
      !supplierId ||
      !name ||
      !category ||
      price === null ||
      price < 0 ||
      stock === null ||
      stock < 0
    ) {
      return [];
    }

    return [{
      id,
      storeId,
      supplierId,
      name,
      description: cleanString(product.description),
      price,
      image: cleanString(product.image),
      stock,
      category,
      isService: product.isService === true,
      updatedAt: cleanString(product.updatedAt),
    } satisfies PublicProduct];
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
    const nextProducts = [
      product,
      ...existingProducts.filter(item => item.id !== product.id),
    ].slice(0, 200);

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
): (() => void) => {
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
