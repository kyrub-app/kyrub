export const KYRUB_CANONICAL_ORDER_NAVIGATION_REQUESTED_EVENT =
  'kyrub:canonical-order-navigation-requested';

export interface CanonicalOrderNavigationRequest {
  storeId: string;
  orderId: string;
}

const clean = (value: string): string => value.trim().slice(0, 240);

export const requestCanonicalOrderNavigation = (
  request: CanonicalOrderNavigationRequest
): boolean => {
  const storeId = clean(request.storeId);
  const orderId = clean(request.orderId);
  if (!storeId || !orderId) return false;

  window.dispatchEvent(new CustomEvent<CanonicalOrderNavigationRequest>(
    KYRUB_CANONICAL_ORDER_NAVIGATION_REQUESTED_EVENT,
    { detail: { storeId, orderId } }
  ));
  return true;
};
