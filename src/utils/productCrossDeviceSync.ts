import type { Product } from '../types';
import type { PublicProduct } from './publicProducts';

export const LEGACY_PRODUCT_CACHE_KEY = 'kyrub_products';

export const parseLegacyProductCache = (value: string | null): Product[] => {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as Product[]) : [];
  } catch {
    return [];
  }
};

const isOwnedRetailProduct = (product: Product, ownerId: string): boolean =>
  product.supplierId === ownerId && product.wholesalePrice === undefined;

export const mergeCloudProductsIntoLegacyCache = (
  cachedProducts: Product[],
  cloudProducts: PublicProduct[],
  ownerId: string
): Product[] => {
  const cloudIds = new Set(cloudProducts.map(product => product.id));
  const preservedProducts = cachedProducts.filter(
    product =>
      !isOwnedRetailProduct(product, ownerId) && !cloudIds.has(product.id)
  );

  return [...cloudProducts, ...preservedProducts];
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort((left, right) => left.localeCompare(right))
      .map(key => [key, stableValue(record[key])])
  );
};

export const productCacheSignature = (products: Product[]): string =>
  JSON.stringify(
    [...products]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(product => stableValue(product))
  );
