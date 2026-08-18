import type { User } from 'firebase/auth';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import {
  calculateCompositionUnitCost,
  calculateSaleMarginPercent,
  calculateSuggestedPrice,
  roundCurrency,
} from '../../shared/productPricing';
import { db } from './firebase';
import { getProductInventoryDocumentPath } from './productInventory';

export {
  calculateCompositionUnitCost,
  calculateSaleMarginPercent,
  calculateSuggestedPrice,
  roundCurrency,
};

export type ProductPricingSetting = {
  targetMarginPercent: number;
};

const validProductId = (value: string): boolean =>
  /^[a-zA-Z0-9_-]{1,128}$/.test(value.trim());

const finitePercent = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 100
    ? value
    : null;

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
