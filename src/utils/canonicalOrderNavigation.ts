export const KYRUB_CANONICAL_ORDER_NAVIGATION_REQUESTED_EVENT =
  'kyrub:canonical-order-navigation-requested';
export const KYRUB_CANONICAL_ORDER_NAVIGATION_CHANGED_EVENT =
  'kyrub:canonical-order-navigation-changed';

export interface CanonicalOrderNavigationRequest {
  storeId: string;
  orderId: string;
}

let pendingNavigation: CanonicalOrderNavigationRequest | null = null;
let replacedNavigationOrderId = '';

const clean = (value: string): string => value.trim().slice(0, 240);

const notifyNavigationChanged = (): void => {
  window.dispatchEvent(new Event(KYRUB_CANONICAL_ORDER_NAVIGATION_CHANGED_EVENT));
};

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

  const previous = pendingNavigation;
  replacedNavigationOrderId =
    previous &&
    previous.storeId === normalized.storeId &&
    previous.orderId !== normalized.orderId
      ? previous.orderId
      : '';
  pendingNavigation = normalized;
  window.dispatchEvent(new CustomEvent<CanonicalOrderNavigationRequest>(
    KYRUB_CANONICAL_ORDER_NAVIGATION_REQUESTED_EVENT,
    { detail: normalized }
  ));
  notifyNavigationChanged();
  return true;
};

export const readCanonicalOrderNavigation = (
  storeId: string
): CanonicalOrderNavigationRequest | null => {
  const normalizedStoreId = clean(storeId);
  if (!normalizedStoreId || pendingNavigation?.storeId !== normalizedStoreId) {
    return null;
  }
  return pendingNavigation;
};

export const readReplacedCanonicalOrderNavigationId = (
  storeId: string
): string => {
  const normalizedStoreId = clean(storeId);
  if (
    !normalizedStoreId ||
    pendingNavigation?.storeId !== normalizedStoreId
  ) {
    return '';
  }
  return replacedNavigationOrderId;
};

export const isCurrentCanonicalOrderNavigation = (
  storeId: string,
  orderId: string
): boolean => {
  const normalizedStoreId = clean(storeId);
  const normalizedOrderId = clean(orderId);
  return Boolean(
    normalizedStoreId &&
    normalizedOrderId &&
    pendingNavigation?.storeId === normalizedStoreId &&
    pendingNavigation.orderId === normalizedOrderId
  );
};

export const cancelCanonicalOrderNavigation = (
  storeId: string,
  orderId: string
): boolean => {
  if (!isCurrentCanonicalOrderNavigation(storeId, orderId)) {
    return false;
  }
  pendingNavigation = null;
  replacedNavigationOrderId = '';
  notifyNavigationChanged();
  return true;
};

export const acknowledgeCanonicalOrderNavigation = (
  storeId: string,
  orderId: string
): boolean => {
  if (!isCurrentCanonicalOrderNavigation(storeId, orderId)) {
    return false;
  }
  pendingNavigation = null;
  replacedNavigationOrderId = '';
  notifyNavigationChanged();
  return true;
};

export const consumeCanonicalOrderNavigation = (
  storeId: string
): CanonicalOrderNavigationRequest | null => {
  const request = readCanonicalOrderNavigation(storeId);
  if (!request) return null;
  pendingNavigation = null;
  replacedNavigationOrderId = '';
  notifyNavigationChanged();
  return request;
};
