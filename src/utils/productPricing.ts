import type { User } from 'firebase/auth';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import {
  getProductInventoryDocumentPath,
  parseProductComposition,
  type InventoryCatalogItem,
  type ProductComposition,
} from './productInventory';

export type ProductPricingSetting = {
  targetMarginPercent: number;
};

const validProductId = (value: string): boolean =>
  /^[a-zA-Z0-9_-]{1,128}$/.test(value.trim());

const finitePercent = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 100
    ? value
    : null;

export const calculateCompositionUnitCost = (
  catalog: InventoryCatalogItem[],
  composition: ProductComposition
): number | null => {
  const parsed = parseProductComposition(composition);
  if (parsed.lines.length === 0 || parsed.yieldQuantity <= 0) return null;
  const byId = new Map(catalog.map(item => [item.id, item]));
  let total = 0;

  for (const line of parsed.lines) {
    const item = byId.get(line.inventoryItemId);
    // Custo zero na entrada sem valor fiscal significa custo ainda não
    // informado, não insumo gratuito. Evita sugerir preço com base incompleta.
    if (!item || !Number.isFinite(item.purchaseCost) || item.purchaseCost <= 0) {
      return null;
    }
    total += line.quantity * item.purchaseCost;
  }

  const unitCost = total / parsed.yieldQuantity;
  return Number.isFinite(unitCost) && unitCost >= 0 ? unitCost : null;
};

export const calculateSuggestedPrice = (
  unitCost: number | null,
  targetMarginPercent: number | null
): number | null => {
  if (
    unitCost === null ||
    !Number.isFinite(unitCost) ||
    unitCost < 0 ||
    targetMarginPercent === null ||
    !Number.isFinite(targetMarginPercent) ||
    targetMarginPercent < 0 ||
    targetMarginPercent >= 100
  ) {
    return null;
  }
  const price = unitCost / (1 - targetMarginPercent / 100);
  return Number.isFinite(price) ? price : null;
};

export const calculateSaleMarginPercent = (
  unitCost: number | null,
  salePrice: number | null
): number | null => {
  if (
    unitCost === null ||
    salePrice === null ||
    !Number.isFinite(unitCost) ||
    !Number.isFinite(salePrice) ||
    unitCost < 0 ||
    salePrice <= 0
  ) return null;
  return ((salePrice - unitCost) / salePrice) * 100;
};

export const roundCurrency = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export const parseProductPricingSettings = (
  value: unknown
): Record<string, ProductPricingSetting> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const parsed: Record<string, ProductPricingSetting> = {};
  for (const [productId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!validProductId(productId) || !raw || typeof raw !== 'object' || Array.isArray(raw)) {
      continue;
    }
    const margin = finitePercent((raw as Record<string, unknown>).targetMarginPercent);
    if (margin === null) continue;
    parsed[productId] = { targetMarginPercent: margin };
  }
  return parsed;
};

export const saveProductTargetMargin = async (
  user: Pick<User, 'uid'>,
  productId: string,
  targetMarginPercent: number
): Promise<void> => {
  const normalizedProductId = productId.trim();
  const margin = finitePercent(targetMarginPercent);
  if (!validProductId(normalizedProductId) || margin === null) {
    throw new Error('Informe uma margem entre 0% e 99,99%.');
  }

  const reference = doc(db, getProductInventoryDocumentPath(user.uid));
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    const current = parseProductPricingSettings(snapshot.data()?.productPricingSettings);
    transaction.set(reference, {
      ownerId: user.uid,
      productPricingSettings: {
        ...current,
        [normalizedProductId]: { targetMarginPercent: margin },
      },
      updatedAt: serverTimestamp(),
      ...(snapshot.exists() ? {} : { createdAt: serverTimestamp() }),
    }, { merge: true });
  });
};
