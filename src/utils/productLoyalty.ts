import { doc, onSnapshot, runTransaction, serverTimestamp, type Unsubscribe } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from './firebase';

export type ProductLoyaltyRule = {
  productId: string;
  points: number;
  updatedAt?: string;
};

export type ProductLoyaltyMap = Record<string, number>;

const cleanPoints = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(1_000_000, Math.floor(parsed));
};

/**
 * Public canonical loyalty configuration for a store.
 *
 * Product base points must be readable by customers (Meu relacionamento) as
 * well as editable by the store owner. Keeping the rule inside the existing
 * artifacts tree also follows the repository's canonical tenant data layout
 * and its current Firestore security model.
 */
export const getProductLoyaltyDocumentPath = (storeId: string): string =>
  `artifacts/${storeId.trim()}/public/data/loyalty/config`;

export const parseProductLoyaltyMap = (value: unknown): ProductLoyaltyMap => {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  const source = record.productPoints;
  if (!source || typeof source !== 'object') return {};
  return Object.entries(source as Record<string, unknown>).reduce<ProductLoyaltyMap>(
    (result, [productId, points]) => {
      const id = productId.trim();
      if (!id) return result;
      result[id] = cleanPoints(points);
      return result;
    },
    {}
  );
};

export const subscribeToProductLoyalty = (
  storeId: string,
  onValue: (value: ProductLoyaltyMap) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const normalized = storeId.trim();
  if (!normalized) {
    onValue({});
    return () => undefined;
  }
  return onSnapshot(
    doc(db, getProductLoyaltyDocumentPath(normalized)),
    snapshot => onValue(parseProductLoyaltyMap(snapshot.data())),
    error => {
      onValue({});
      onError?.(error);
    }
  );
};

export const persistProductLoyaltyPoints = async (
  user: Pick<User, 'uid'>,
  productId: string,
  points: number
): Promise<void> => {
  const id = productId.trim();
  if (!id) throw new Error('O item não foi identificado para configurar pontos.');
  const normalizedPoints = cleanPoints(points);
  const reference = doc(db, getProductLoyaltyDocumentPath(user.uid));
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    const current = parseProductLoyaltyMap(snapshot.data());
    transaction.set(
      reference,
      {
        storeId: user.uid,
        productPoints: { ...current, [id]: normalizedPoints },
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });
};

export const getProductBasePoints = (
  loyalty: ProductLoyaltyMap,
  productId: string
): number => cleanPoints(loyalty[productId]);
