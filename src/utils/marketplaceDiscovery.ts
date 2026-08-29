import type { User } from 'firebase/auth';
import type {
  MarketplaceDiscoveryResponse,
  MarketplaceStoreDiscoverySignal,
} from '../../shared/marketplaceDiscovery';

const parseSignal = (value: unknown): MarketplaceStoreDiscoverySignal | null => {
  if (!value || typeof value !== 'object') return null;
  const signal = value as Partial<MarketplaceStoreDiscoverySignal>;
  if (
    signal.schemaVersion !== 1 ||
    typeof signal.storeId !== 'string' ||
    !signal.storeId.trim() ||
    typeof signal.inPromotion !== 'boolean' ||
    typeof signal.forYou !== 'boolean' ||
    !['purchase_history', 'points_balance', 'purchase_and_points', 'none'].includes(
      String(signal.forYouReason)
    ) ||
    !Number.isSafeInteger(signal.confirmedPurchases) ||
    Number(signal.confirmedPurchases) < 0 ||
    !Number.isSafeInteger(signal.pointsBalance)
  ) {
    return null;
  }
  return signal as MarketplaceStoreDiscoverySignal;
};

export const loadMarketplaceDiscovery = async (
  user: Pick<User, 'getIdToken'>,
  storeIds: readonly string[]
): Promise<MarketplaceDiscoveryResponse> => {
  const token = await user.getIdToken();
  const response = await fetch('/api/marketplace-discovery', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ storeIds }),
    cache: 'no-store',
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'Não foi possível personalizar o marketplace.'
    );
  }
  const signals = Array.isArray(payload.signals)
    ? payload.signals.flatMap(value => {
        const signal = parseSignal(value);
        return signal ? [signal] : [];
      })
    : [];
  return {
    schemaVersion: 1,
    customerId: typeof payload.customerId === 'string' ? payload.customerId : '',
    generatedAt: typeof payload.generatedAt === 'string' ? payload.generatedAt : '',
    signals,
  };
};
