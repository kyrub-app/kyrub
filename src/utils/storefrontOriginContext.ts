import type { CartItem, Product } from '../types';
import { buildProductConfigurationSelection } from './productCustomization';

const ORIGIN_KEY = 'kyrub_storefront_origin_v1';
const CART_PREFIX = 'kyrub_storefront_cart_v1:';
const MAX_CONTEXT_AGE_MS = 12 * 60 * 60 * 1000;

export type StorefrontOriginContext = {
  slug: string;
  storeId: string;
  storeName: string;
  path: string;
  capturedAt: number;
};

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const storage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

export const saveStorefrontOriginContext = (input: {
  slug: string;
  storeId: string;
  storeName: string;
}): StorefrontOriginContext | null => {
  const slug = clean(input.slug);
  const storeId = clean(input.storeId);
  if (!slug || !storeId) return null;

  const context: StorefrontOriginContext = {
    slug,
    storeId,
    storeName: clean(input.storeName) || 'loja de origem',
    path: `/@${slug}`,
    capturedAt: Date.now(),
  };

  storage()?.setItem(ORIGIN_KEY, JSON.stringify(context));
  return context;
};

export const loadStorefrontOriginContext = (): StorefrontOriginContext | null => {
  const target = storage();
  if (!target) return null;

  const raw = target.getItem(ORIGIN_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StorefrontOriginContext>;
    const slug = clean(parsed.slug);
    const storeId = clean(parsed.storeId);
    const storeName = clean(parsed.storeName);
    const capturedAt = Number(parsed.capturedAt);

    if (
      !slug ||
      !storeId ||
      !Number.isFinite(capturedAt) ||
      capturedAt <= 0 ||
      Date.now() - capturedAt > MAX_CONTEXT_AGE_MS
    ) {
      target.removeItem(ORIGIN_KEY);
      return null;
    }

    return {
      slug,
      storeId,
      storeName: storeName || 'loja de origem',
      path: `/@${slug}`,
      capturedAt,
    };
  } catch {
    target.removeItem(ORIGIN_KEY);
    return null;
  }
};

export const clearStorefrontOriginContext = (): void => {
  storage()?.removeItem(ORIGIN_KEY);
};

const cartKey = (slug: string): string => `${CART_PREFIX}${clean(slug)}`;

const isProduct = (value: unknown): value is Product => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const product = value as Partial<Product>;
  return (
    typeof product.id === 'string' &&
    typeof product.name === 'string' &&
    typeof product.description === 'string' &&
    typeof product.price === 'number' &&
    Number.isFinite(product.price) &&
    typeof product.image === 'string' &&
    typeof product.stock === 'number' &&
    Number.isFinite(product.stock) &&
    typeof product.category === 'string'
  );
};


/**
 * The published storefront is authoritative for which products may remain in
 * a resumed buyer cart. Remove withdrawn items and replace stale price/terms
 * snapshots with the freshly published offer; preserve buyer quantities.
 */
export const reconcilePublishedStorefrontCart = (
  cart: readonly CartItem[],
  publishedOffers: readonly Product[]
): CartItem[] => {
  const current = new Map(publishedOffers.map(product => [product.id, product]));
  return cart.flatMap(item => {
    const originalId = item.product.id;
    const sourceId = item.product.sourceProductId ?? originalId.split('::', 1)[0];
    const product = current.get(sourceId);
    if (!product) return [];

    const configured = originalId !== sourceId ||
      (item.product.selectedOptions?.length ?? 0) > 0 ||
      (item.product.selectedQuickNotes?.length ?? 0) > 0;
    if (!configured) return [{ ...item, product }];

    // Public projections may omit customization metadata when product choices
    // are supplied by legacy store-wide defaults. Without that authoritative
    // metadata, keep the buyer's selection and existing displayed price;
    // never fabricate a new option price or discard a still-published item.
    const choicesUnknown = (item.product.selectedOptions?.length ?? 0) > 0 &&
      product.optionGroups === undefined;
    const quickNotesUnknown = (item.product.selectedQuickNotes?.length ?? 0) > 0 &&
      product.quickNotes === undefined;
    if (choicesUnknown || quickNotesUnknown) {
      return [{ ...item, product: { ...item.product, stock: product.stock } }];
    }

    // Keep a configured cart line only if all selected choices/notes remain
    // valid in the current catalog. Reprice through the same PDV builder.
    const selectedIds: Record<string, string[]> = {};
    for (const option of item.product.selectedOptions ?? []) {
      (selectedIds[option.groupId] ??= []).push(option.choiceId);
    }
    try {
      const refreshed = buildProductConfigurationSelection(
        product,
        selectedIds,
        item.product.selectedQuickNotes ?? [],
        (item.product as Product & { customerNote?: string }).customerNote ?? ''
      );
      // A changed key means one or more choices/notes were removed or altered.
      // Never silently convert a configured purchase into a different item.
      if (refreshed.id !== originalId) return [];
      return [{
        ...item, product: refreshed,
        ...(item.unitPrice !== undefined ? { unitPrice: refreshed.unitPrice } : {}),
        ...(item.selectedOptions !== undefined ? { selectedOptions: refreshed.selectedOptions } : {}),
        ...(item.selectedQuickNotes !== undefined ? { selectedQuickNotes: refreshed.selectedQuickNotes } : {}),
        ...(item.customizationSummary !== undefined ? { customizationSummary: refreshed.customizationSummary } : {}),
      }];
    } catch {
      return [];
    }
  });
};

export const saveStorefrontCart = (
  slug: string,
  cart: readonly CartItem[]
): void => {
  const target = storage();
  const normalizedSlug = clean(slug);
  if (!target || !normalizedSlug) return;

  const safeCart = cart
    .filter(item => isProduct(item.product) && Number.isFinite(item.quantity))
    .map(item => ({ ...item, quantity: Math.max(1, Math.floor(item.quantity)) }));
  target.setItem(cartKey(normalizedSlug), JSON.stringify(safeCart));
};

export const loadStorefrontCart = (slug: string): CartItem[] => {
  const target = storage();
  const normalizedSlug = clean(slug);
  if (!target || !normalizedSlug) return [];

  const raw = target.getItem(cartKey(normalizedSlug));
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const item = value as Partial<CartItem>;
      if (!isProduct(item.product) || !Number.isFinite(item.quantity)) return [];
      return [{
        ...item,
        product: item.product,
        quantity: Math.max(1, Math.floor(item.quantity as number)),
      } as CartItem];
    });
  } catch {
    target.removeItem(cartKey(normalizedSlug));
    return [];
  }
};

export const clearStorefrontCart = (slug: string): void => {
  const target = storage();
  const normalizedSlug = clean(slug);
  if (!target || !normalizedSlug) return;
  target.removeItem(cartKey(normalizedSlug));
};
