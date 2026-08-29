export const MARKETPLACE_DISCOVERY_SCHEMA_VERSION = 1 as const;

export type MarketplaceForYouReason =
  | 'purchase_history'
  | 'points_balance'
  | 'purchase_and_points'
  | 'none';

export interface MarketplaceStoreDiscoverySignal {
  schemaVersion: typeof MARKETPLACE_DISCOVERY_SCHEMA_VERSION;
  storeId: string;
  inPromotion: boolean;
  forYou: boolean;
  forYouReason: MarketplaceForYouReason;
  confirmedPurchases: number;
  pointsBalance: number;
}

export interface MarketplaceDiscoveryResponse {
  schemaVersion: typeof MARKETPLACE_DISCOVERY_SCHEMA_VERSION;
  customerId: string;
  generatedAt: string;
  signals: MarketplaceStoreDiscoverySignal[];
}

const nonNegativeInteger = (value: number, code: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(code);
  return value;
};

export const deriveMarketplaceForYouReason = (input: {
  confirmedPurchases: number;
  pointsBalance: number;
}): MarketplaceForYouReason => {
  const confirmedPurchases = nonNegativeInteger(
    input.confirmedPurchases,
    'MARKETPLACE_DISCOVERY_PURCHASES_INVALID'
  );
  if (!Number.isSafeInteger(input.pointsBalance)) {
    throw new Error('MARKETPLACE_DISCOVERY_POINTS_INVALID');
  }
  const hasPurchases = confirmedPurchases > 0;
  const hasPoints = input.pointsBalance > 0;
  if (hasPurchases && hasPoints) return 'purchase_and_points';
  if (hasPurchases) return 'purchase_history';
  if (hasPoints) return 'points_balance';
  return 'none';
};

export const buildMarketplaceStoreDiscoverySignal = (input: {
  storeId: string;
  inPromotion: boolean;
  confirmedPurchases: number;
  pointsBalance: number;
}): MarketplaceStoreDiscoverySignal => {
  const storeId = input.storeId.trim();
  if (!storeId) throw new Error('MARKETPLACE_DISCOVERY_STORE_REQUIRED');
  const confirmedPurchases = nonNegativeInteger(
    input.confirmedPurchases,
    'MARKETPLACE_DISCOVERY_PURCHASES_INVALID'
  );
  if (!Number.isSafeInteger(input.pointsBalance)) {
    throw new Error('MARKETPLACE_DISCOVERY_POINTS_INVALID');
  }
  const forYouReason = deriveMarketplaceForYouReason({
    confirmedPurchases,
    pointsBalance: input.pointsBalance,
  });
  return {
    schemaVersion: MARKETPLACE_DISCOVERY_SCHEMA_VERSION,
    storeId,
    inPromotion: input.inPromotion === true,
    forYou: forYouReason !== 'none',
    forYouReason,
    confirmedPurchases,
    pointsBalance: input.pointsBalance,
  };
};

export const compareMarketplaceForYouSignals = (
  left: MarketplaceStoreDiscoverySignal,
  right: MarketplaceStoreDiscoverySignal
): number => {
  if (left.forYou !== right.forYou) return left.forYou ? -1 : 1;
  if (left.confirmedPurchases !== right.confirmedPurchases) {
    return right.confirmedPurchases - left.confirmedPurchases;
  }
  if (left.pointsBalance !== right.pointsBalance) {
    return right.pointsBalance - left.pointsBalance;
  }
  return left.storeId.localeCompare(right.storeId);
};
