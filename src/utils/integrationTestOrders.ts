import type { Order } from '../types';
import type { StoreIntegrationId } from './storeOperationalSettings';

export const INTEGRATION_TEST_ORDER_EVENT = 'kyrub-integration-test-order';
export const LEGACY_ORDER_CACHE_KEY = 'kyrub_orders';

export interface IntegrationTestOrderRequest {
  requestId: string;
  providerId: StoreIntegrationId;
  providerLabel: string;
  storeId: string;
  routingTarget: string;
  accountLabel: string;
  externalStoreId: string;
  createdAt: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const normalizeText = (value: unknown, maxLength = 120): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

export const parseIntegrationTestOrderRequest = (
  value: unknown
): IntegrationTestOrderRequest | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const providerId = candidate.providerId;

  if (
    providerId !== 'open-delivery' &&
    providerId !== 'sefaz' &&
    providerId !== 'ifood' &&
    providerId !== '99food' &&
    providerId !== 'mercado-livre' &&
    providerId !== 'shopee'
  ) {
    return null;
  }

  const request: IntegrationTestOrderRequest = {
    requestId: normalizeText(candidate.requestId),
    providerId,
    providerLabel: normalizeText(candidate.providerLabel),
    storeId: normalizeText(candidate.storeId),
    routingTarget: normalizeText(candidate.routingTarget),
    accountLabel: normalizeText(candidate.accountLabel),
    externalStoreId: normalizeText(candidate.externalStoreId),
    createdAt: normalizeText(candidate.createdAt),
  };

  if (
    !request.requestId ||
    !request.providerLabel ||
    !request.storeId ||
    !request.routingTarget ||
    !request.accountLabel ||
    !request.externalStoreId ||
    !Number.isFinite(Date.parse(request.createdAt))
  ) {
    return null;
  }

  return {
    ...request,
    createdAt: new Date(request.createdAt).toISOString(),
  };
};

export const parseLegacyOrderCache = (value: string | null): Order[] => {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as Order[] : [];
  } catch {
    return [];
  }
};

export const buildIntegrationTestOrder = (
  request: IntegrationTestOrderRequest
): Order => ({
  id: request.requestId,
  storeId: request.storeId,
  buyerName: `TESTE · ${request.providerLabel}`,
  buyerEmail: '',
  items: [
    {
      productId: `integration-test-${request.providerId}`,
      name: `[TESTE] ${request.accountLabel} → ${request.routingTarget}`,
      price: 0,
      quantity: 1,
    },
  ],
  total: 0,
  status: 'pending',
  createdAt: request.createdAt,
  type: 'retail',
});

export const appendIntegrationTestOrder = (
  storage: StorageLike,
  request: IntegrationTestOrderRequest
): Order => {
  const orders = parseLegacyOrderCache(storage.getItem(LEGACY_ORDER_CACHE_KEY));
  const existing = orders.find(order => order.id === request.requestId);
  if (existing) return existing;

  const order = buildIntegrationTestOrder(request);
  storage.setItem(LEGACY_ORDER_CACHE_KEY, JSON.stringify([order, ...orders]));
  return order;
};