export const KYRUB_CANONICAL_ORDER_NAVIGATION_REQUESTED_EVENT =
  'kyrub:canonical-order-navigation-requested';

export interface CanonicalOrderNavigationRequest {
  storeId: string;
  orderId: string;
}

let pendingNavigation: CanonicalOrderNavigationRequest | null = null;

const clean = (value: string): string => value.trim().slice(0, 240);

const normalizeRequest = (
  request: CanonicalOrderNavigationRequest
): CanonicalOrderNavigationRequest | null => {
  const storeId = clean(request.storeId);
  const orderId = clean(request.orderId);
  if (!storeId || !orderId) return null;
  return { storeId, orderId };
};

export const requestCanonicalOrderNavigation = (
  request: CanonicalOrderNavigationRequest
): boolean => {
  const normalized = normalizeRequest(request);
  if (!normalized) return false;

  pendingNavigation = normalized;
  window.dispatchEvent(new CustomEvent<CanonicalOrderNavigationRequest>(
    KYRUB_CANONICAL_ORDER_NAVIGATION_REQUESTED_EVENT,
    { detail: normalized }
  ));
  return true;
};

export const consumeCanonicalOrderNavigation = (
  storeId: string
): CanonicalOrderNavigationRequest | null => {
  const normalizedStoreId = clean(storeId);
  if (!normalizedStoreId || pendingNavigation?.storeId !== normalizedStoreId) {
    return null;
  }
  const request = pendingNavigation;
  pendingNavigation = null;
  return request;
};
