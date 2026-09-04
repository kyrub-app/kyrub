import type { NinetyNineFoodE2EObservedOrder } from './ninetyNineFoodE2EOrderObservation';

export const KYRUB_99FOOD_E2E_TEST_SUBJECT_CHANGED_EVENT =
  'kyrub:99food-e2e-test-subject-changed';

export interface NinetyNineFoodE2ETestWindow {
  storeId: string;
  startedAt: string;
}

export interface NinetyNineFoodE2ETestSubject {
  storeId: string;
  orderId: string;
  externalOrderId: string;
  displayId: string;
  inboundEventId: string;
  inboundEventReceivedAt: string;
  reservationState: NinetyNineFoodE2EObservedOrder['reservation']['state'];
  selectedAt: string;
}

const windowByStore = new Map<string, NinetyNineFoodE2ETestWindow>();
const subjectByStore = new Map<string, NinetyNineFoodE2ETestSubject>();

const clean = (value: string, max = 300): string =>
  value.trim().slice(0, max);

const isoMillis = (value: string): number | null => {
  const normalized = clean(value, 120);
  if (!normalized) return null;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const notifyChanged = (storeId: string): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<{ storeId: string }>(
    KYRUB_99FOOD_E2E_TEST_SUBJECT_CHANGED_EVENT,
    { detail: { storeId } }
  ));
};

export const startNinetyNineFoodE2ETestWindow = (
  storeIdValue: string,
  now = Date.now()
): NinetyNineFoodE2ETestWindow | null => {
  const storeId = clean(storeIdValue, 240);
  if (!storeId || !Number.isFinite(now)) return null;
  const startedAt = new Date(now).toISOString();
  const testWindow = { storeId, startedAt };
  windowByStore.set(storeId, testWindow);
  subjectByStore.delete(storeId);
  notifyChanged(storeId);
  return testWindow;
};

export const readNinetyNineFoodE2ETestWindow = (
  storeIdValue: string
): NinetyNineFoodE2ETestWindow | null => {
  const storeId = clean(storeIdValue, 240);
  if (!storeId) return null;
  return windowByStore.get(storeId) ?? null;
};

export const isNinetyNineFoodE2EOrderFreshForWindow = (
  item: NinetyNineFoodE2EObservedOrder,
  testWindow: NinetyNineFoodE2ETestWindow | null
): boolean => {
  if (!testWindow) return false;
  const eventReceivedAt = isoMillis(item.inboundEvent.receivedAt);
  const startedAt = isoMillis(testWindow.startedAt);
  return Boolean(
    eventReceivedAt !== null &&
    startedAt !== null &&
    eventReceivedAt >= startedAt &&
    item.inboundEvent.status === 'processed' &&
    clean(item.inboundEvent.eventId, 240) &&
    clean(item.orderId, 240) &&
    clean(item.externalOrderId, 240)
  );
};

export const selectNinetyNineFoodE2ETestSubject = (
  storeIdValue: string,
  item: NinetyNineFoodE2EObservedOrder
): NinetyNineFoodE2ETestSubject | null => {
  const storeId = clean(storeIdValue, 240);
  const testWindow = readNinetyNineFoodE2ETestWindow(storeId);
  if (!storeId || !isNinetyNineFoodE2EOrderFreshForWindow(item, testWindow)) {
    return null;
  }
  const orderId = clean(item.orderId, 240);
  const externalOrderId = clean(item.externalOrderId, 240);
  const inboundEventId = clean(item.inboundEvent.eventId, 240);
  const inboundEventReceivedAt = clean(item.inboundEvent.receivedAt, 120);
  if (!orderId || !externalOrderId || !inboundEventId || !inboundEventReceivedAt) {
    return null;
  }
  const subject: NinetyNineFoodE2ETestSubject = {
    storeId,
    orderId,
    externalOrderId,
    displayId: clean(item.displayId, 160) || externalOrderId,
    inboundEventId,
    inboundEventReceivedAt,
    reservationState: item.reservation.state,
    selectedAt: new Date().toISOString(),
  };
  subjectByStore.set(storeId, subject);
  notifyChanged(storeId);
  return subject;
};

export const readNinetyNineFoodE2ETestSubject = (
  storeIdValue: string
): NinetyNineFoodE2ETestSubject | null => {
  const storeId = clean(storeIdValue, 240);
  if (!storeId) return null;
  return subjectByStore.get(storeId) ?? null;
};

export const clearNinetyNineFoodE2ETestSubject = (
  storeIdValue: string
): boolean => {
  const storeId = clean(storeIdValue, 240);
  if (!storeId || !subjectByStore.has(storeId)) return false;
  subjectByStore.delete(storeId);
  notifyChanged(storeId);
  return true;
};

export const clearNinetyNineFoodE2ETestWindow = (
  storeIdValue: string
): boolean => {
  const storeId = clean(storeIdValue, 240);
  if (!storeId || !windowByStore.has(storeId)) return false;
  windowByStore.delete(storeId);
  subjectByStore.delete(storeId);
  notifyChanged(storeId);
  return true;
};
