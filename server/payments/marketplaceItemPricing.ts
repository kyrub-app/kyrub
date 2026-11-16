import type { Product, ProductOptionGroup } from '../../src/types/index.js';
import {
  buildProductConfigurationSelection,
  parseProductOptionGroups,
  parseProductQuickNotes,
} from '../../src/utils/productCustomization.js';

export interface MarketplaceCatalogPricingProduct {
  id: string;
  name: string;
  price: number;
  image: string;
  category: string;
  isService: boolean;
  isComplimentary: boolean;
  storePointsPerUnit: number;
  optionGroups: ProductOptionGroup[];
  quickNotes: string[];
}

export interface MarketplaceCheckoutSelectionInput {
  productId: string;
  quantity: number;
  note?: string;
  selectedOptions: Array<{ groupId: string; choiceId: string }>;
  selectedQuickNotes: string[];
  customerNote: string;
}

export interface PricedMarketplaceCheckoutItem {
  productId: string;
  sourceProductId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
  note: string;
  image: string;
  isService: boolean;
  storePointsPerUnit: number;
}

/**
 * Reconstructs prices from the store catalog only. The browser may describe
 * option IDs and a line key, but may not set prices or supply option premiums.
 */
export const priceMarketplaceCheckoutItems = (
  catalog: readonly MarketplaceCatalogPricingProduct[],
  items: readonly MarketplaceCheckoutSelectionInput[]
): PricedMarketplaceCheckoutItem[] => {
  const productMap = new Map(catalog.map(product => [product.id, product]));
  return items.map(item => {
    const sourceId = item.productId.split('::', 1)[0]?.trim() ?? '';
    const product = productMap.get(sourceId);
    if (!product) throw new Error('CHECKOUT_PRODUCT_NOT_AVAILABLE');
    const groupIds = new Set<string>();
    for (const group of parseProductOptionGroups(product.optionGroups)) {
      if (groupIds.has(group.id)) throw new Error('CHECKOUT_ITEM_CONFIGURATION_INVALID');
      groupIds.add(group.id);
    }

    const selections: Record<string, string[]> = {};
    for (const option of item.selectedOptions) {
      (selections[option.groupId] ??= []).push(option.choiceId);
    }

    let selected: ReturnType<typeof buildProductConfigurationSelection>;
    try {
      selected = buildProductConfigurationSelection({
        id: product.id,
        name: product.name,
        description: '',
        category: product.category,
        price: product.price,
        stock: 0,
        image: product.image,
        isService: product.isService,
        isComplimentary: product.isComplimentary,
        optionGroups: product.optionGroups,
        quickNotes: product.quickNotes,
      } satisfies Product, selections, item.selectedQuickNotes, item.customerNote);
    } catch {
      throw new Error('CHECKOUT_ITEM_CONFIGURATION_INVALID');
    }

    const requestedOptions = item.selectedOptions.map(option =>
      `${option.groupId}\u0000${option.choiceId}`
    ).sort();
    const authorizedOptions = selected.selectedOptions.map(option =>
      `${option.groupId}\u0000${option.choiceId}`
    ).sort();
    const requestedNotes = parseProductQuickNotes(item.selectedQuickNotes);
    if (selected.id !== item.productId ||
        requestedOptions.length !== authorizedOptions.length ||
        requestedOptions.some((id, index) => id !== authorizedOptions[index]) ||
        requestedNotes.length !== item.selectedQuickNotes.length ||
        requestedNotes.length !== selected.selectedQuickNotes.length ||
        requestedNotes.some((note, index) => note !== selected.selectedQuickNotes[index])) {
      throw new Error('CHECKOUT_ITEM_CONFIGURATION_INVALID');
    }

    const unitPrice = selected.unitPrice;
    const total = Number((unitPrice * item.quantity).toFixed(2));
    if (!Number.isFinite(unitPrice) || unitPrice < 0 ||
        !Number.isFinite(total) || total < 0) {
      throw new Error('CHECKOUT_ITEM_PRICE_INVALID');
    }
    return {
      productId: item.productId,
      sourceProductId: sourceId,
      name: selected.name,
      quantity: item.quantity,
      unitPrice,
      total,
      note: item.note ?? '',
      image: product.image,
      isService: product.isService,
      storePointsPerUnit: product.storePointsPerUnit,
    };
  });
};
