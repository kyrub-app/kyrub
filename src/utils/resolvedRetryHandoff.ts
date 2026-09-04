import {
  KYRUB_CANONICAL_ORDER_NAVIGATION_ACKNOWLEDGED_EVENT,
  type CanonicalOrderNavigationRequest,
} from './canonicalOrderNavigation';
import type { NinetyNineFoodRetryResolvedDetail } from './storeChannelOperations';

export const KYRUB_RESOLVED_RETRY_HANDOFF_CHANGED_EVENT =
  'kyrub:resolved-retry-handoff-changed';

const handoffByStore = new Map<string, NinetyNineFoodRetryResolvedDetail>();

const clean = (value: string): string => value.trim().slice(0, 240);

const notifyChanged = (storeId: string): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<{ storeId: string }>(
    KYRUB_RESOLVED_RETRY_HANDOFF_CHANGED_EVENT,
    { detail: { storeId } }
  ));
};

export const retainResolvedRetryHandoff = (
  detail: NinetyNineFoodRetryResolvedDetail
): boolean => {
  const storeId = clean(detail.storeId);
  const orderId = clean(detail.orderId);
  const checkedAt = detail.checkedAt.trim();
  if (!storeId || !orderId || !checkedAt) return false;

  handoffByStore.set(storeId, {
    ...detail,
    storeId,
    orderId,
    checkedAt,
  });
  notifyChanged(storeId);
  return true;
};

export const readResolvedRetryHandoff = (
  storeId: string
): NinetyNineFoodRetryResolvedDetail | null => {
  const normalizedStoreId = clean(storeId);
  if (!normalizedStoreId) return null;
  return handoffByStore.get(normalizedStoreId) ?? null;
};

export const clearResolvedRetryHandoff = (
  storeId: string,
  orderId: string
): boolean => {
  const normalizedStoreId = clean(storeId);
  const normalizedOrderId = clean(orderId);
  const current = handoffByStore.get(normalizedStoreId);
  if (
    !normalizedStoreId ||
    !normalizedOrderId ||
    !current ||
    current.orderId !== normalizedOrderId
  ) {
    return false;
  }

  handoffByStore.delete(normalizedStoreId);
  notifyChanged(normalizedStoreId);
  return true;
};

if (typeof window !== 'undefined') {
  window.addEventListener(
    KYRUB_CANONICAL_ORDER_NAVIGATION_ACKNOWLEDGED_EVENT,
    (event: Event) => {
      const detail = (event as CustomEvent<CanonicalOrderNavigationRequest>).detail;
      if (!detail) return;
      clearResolvedRetryHandoff(detail.storeId, detail.orderId);
    }
  );
}
