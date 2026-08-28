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
 * Canonical store-owned loyalty configuration.
 *
 * New writes live outside the legacy /artifacts tree so another signed-in
 * account cannot mutate a store's product-point rules through the old broad
 * artifact rule. Read access remains available to signed-in customers because
 * these rules describe public loyalty economics, not buyer-private data.
 */
export const getProductLoyaltyDocumentPath = (storeId: string): string =>
  `storeLoyaltyConfigs/${storeId.trim()}`;

/** Transitional legacy path used only as a read fallback while staging data is
 * backfilled naturally by the next merchant edit. No new writes go here. */
export const getLegacyProductLoyaltyDocumentPath = (storeId: string): string =>
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

  let unsubscribeLegacy: Unsubscribe | null = null;
  const unsubscribeCanonical = onSnapshot(
    doc(db, getProductLoyaltyDocumentPath(normalized)),
    snapshot => {
      unsubscribeLegacy?.();
      unsubscribeLegacy = null;
      if (snapshot.exists()) {
        onValue(parseProductLoyaltyMap(snapshot.data()));
        return;
      }
      unsubscribeLegacy = onSnapshot(
        doc(db, getLegacyProductLoyaltyDocumentPath(normalized)),
        legacySnapshot => onValue(parseProductLoyaltyMap(legacySnapshot.data())),
        error => {
          onValue({});
          onError?.(error);
        }
      );
    },
    error => {
      onValue({});
      onError?.(error);
    }
  );

  return () => {
    unsubscribeCanonical();
    unsubscribeLegacy?.();
  };
};

export const persistProductLoyaltyPoints = async (
  user: Pick<User, 'uid'>,
  productId: string,
  points: number
): Promise<void> => {
  const id = productId.trim();
  const storeId = user.uid.trim();
  if (!storeId) throw new Error('Loja não identificada.');
  if (!id) throw new Error('O item não foi identificado para configurar pontos.');
  const normalizedPoints = cleanPoints(points);
  const canonicalReference = doc(db, getProductLoyaltyDocumentPath(storeId));
  const legacyReference = doc(db, getLegacyProductLoyaltyDocumentPath(storeId));

  await runTransaction(db, async transaction => {
    const [canonicalSnapshot, legacySnapshot] = await Promise.all([
      transaction.get(canonicalReference),
      transaction.get(legacyReference),
    ]);
    const current = canonicalSnapshot.exists()
      ? parseProductLoyaltyMap(canonicalSnapshot.data())
      : parseProductLoyaltyMap(legacySnapshot.data());

    transaction.set(
      canonicalReference,
      {
        storeId,
        productPoints: { ...current, [id]: normalizedPoints },
        updatedAt: serverTimestamp(),
        schemaVersion: 2,
      },
      { merge: true }
    );
  });
};

export const getProductBasePoints = (
  loyalty: ProductLoyaltyMap,
  productId: string
): number => cleanPoints(loyalty[productId]);
