import { adminDb } from '../firebaseAdmin.js';

const clean = (value: unknown, max = 500): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, max)
    : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const stringList = (value: unknown, max = 240): string[] =>
  Array.isArray(value)
    ? Array.from(new Set(
        value.map(item => clean(item, max)).filter(Boolean)
      )).sort()
    : [];

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const timestampToIso = (value: unknown): string => {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return clean(value, 120);
};

const canonicalStoreIdForTenant = async (tenantId: string): Promise<string> => {
  const tenant = await adminDb.doc(`tenants/${tenantId}`).get();
  const canonicalStoreId = clean(tenant.data()?.canonicalStoreId, 160);
  if (!canonicalStoreId) {
    throw new Error('NINETY_NINE_FOOD_E2E_ORDER_OBSERVATION_CANONICAL_STORE_REQUIRED');
  }
  return canonicalStoreId;
};

export type NinetyNineFoodObservedReservationState =
  | 'reserved'
  | 'released'
  | 'consumed'
  | 'waiting_physical_consumption'
  | 'not_applicable'
  | 'blocked_product_binding_unresolved'
  | 'blocked_insufficient_atp'
  | 'blocked_authority_unresolved'
  | 'unobserved';

const RESERVATION_STATES = new Set<NinetyNineFoodObservedReservationState>([
  'reserved',
  'released',
  'consumed',
  'waiting_physical_consumption',
  'not_applicable',
  'blocked_product_binding_unresolved',
  'blocked_insufficient_atp',
  'blocked_authority_unresolved',
]);

const reservationState = (
  reservation: Record<string, unknown>
): NinetyNineFoodObservedReservationState => {
  const state = clean(reservation.state, 120) as NinetyNineFoodObservedReservationState;
  return RESERVATION_STATES.has(state) ? state : 'unobserved';
};

interface InboundEventEvidence {
  eventId: string;
  eventType: string;
  status: string;
  receivedAt: string;
  processedAt: string;
}

const eventRank = (event: InboundEventEvidence): string =>
  event.processedAt || event.receivedAt;

export interface NinetyNineFoodE2EObservedOrder {
  orderId: string;
  externalOrderId: string;
  displayId: string;
  customerName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastEvent: string;
  inboundEvent: InboundEventEvidence;
  reservation: {
    state: NinetyNineFoodObservedReservationState;
    detail: string;
    canonicalProductIds: string[];
    unresolvedExternalProductIds: string[];
    inventoryItemId: string;
    requiredQuantity: number | null;
    availableQuantity: number | null;
    reconciledAt: string;
  };
}

export const listRecentNinetyNineFoodE2EObservedOrders = async (input: {
  tenantId: string;
  requestedByUserId: string;
  limit?: number;
}): Promise<{
  canonicalStoreId: string;
  observedAt: string;
  items: NinetyNineFoodE2EObservedOrder[];
}> => {
  const tenantId = clean(input.tenantId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!tenantId || requestedByUserId !== tenantId) {
    throw new Error('NINETY_NINE_FOOD_E2E_ORDER_OBSERVATION_FORBIDDEN');
  }
  const canonicalStoreId = await canonicalStoreIdForTenant(tenantId);
  const requestedLimit = typeof input.limit === 'number' && Number.isFinite(input.limit)
    ? Math.trunc(input.limit)
    : 20;
  const limit = Math.max(1, Math.min(50, requestedLimit));
  const [ordersSnapshot, eventsSnapshot] = await Promise.all([
    adminDb.collection(`stores/${canonicalStoreId}/orders`).get(),
    adminDb.collection(`tenants/${tenantId}/integrationEvents`).get(),
  ]);

  const eventByExternalOrderId = new Map<string, InboundEventEvidence>();
  for (const document of eventsSnapshot.docs) {
    const event = record(document.data());
    if (clean(event.provider, 120) !== '99food') continue;
    const externalOrderId = clean(event.externalOrderId, 240);
    const eventId = clean(event.eventId, 240);
    if (!externalOrderId || !eventId) continue;
    const candidate: InboundEventEvidence = {
      eventId,
      eventType: clean(event.eventType, 160),
      status: clean(event.status, 120),
      receivedAt: timestampToIso(event.receivedAt),
      processedAt: timestampToIso(event.processedAt),
    };
    const current = eventByExternalOrderId.get(externalOrderId);
    const candidateProcessed = candidate.status === 'processed';
    const currentProcessed = current?.status === 'processed';
    if (
      !current ||
      (candidateProcessed && !currentProcessed) ||
      (candidateProcessed === currentProcessed && eventRank(candidate) > eventRank(current))
    ) {
      eventByExternalOrderId.set(externalOrderId, candidate);
    }
  }

  const items = ordersSnapshot.docs.flatMap(document => {
    const order = record(document.data());
    const integration = record(order.integration);
    if (clean(integration.provider, 120) !== '99food') return [];
    const externalOrderId = clean(integration.externalOrderId, 240);
    if (!externalOrderId) return [];
    const reservation = record(order.inventoryReservation);
    const ingress = eventByExternalOrderId.get(externalOrderId);
    const fallbackEventId = clean(integration.lastInboundEventId, 240);
    const fallbackEventAt = clean(integration.lastInboundEventAt, 120);
    return [{
      orderId: document.id,
      externalOrderId,
      displayId:
        clean(integration.displayId, 160) ||
        clean(order.displayId, 160) ||
        externalOrderId,
      customerName: clean(order.buyerName, 240) || clean(order.customerName, 240),
      status: clean(order.status, 120),
      createdAt: clean(order.createdAt, 120),
      updatedAt: clean(order.updatedAt, 120),
      lastEvent: clean(integration.lastEvent, 160),
      inboundEvent: ingress ?? {
        eventId: fallbackEventId,
        eventType: clean(integration.lastEvent, 160),
        status: fallbackEventId ? 'observed_on_order' : 'unobserved',
        receivedAt: fallbackEventAt,
        processedAt: fallbackEventAt,
      },
      reservation: {
        state: reservationState(reservation),
        detail: clean(reservation.detail, 500),
        canonicalProductIds: stringList(reservation.canonicalProductIds),
        unresolvedExternalProductIds: stringList(
          reservation.unresolvedExternalProductIds
        ),
        inventoryItemId: clean(reservation.inventoryItemId, 240),
        requiredQuantity: finiteNumber(reservation.requiredQuantity),
        availableQuantity: finiteNumber(reservation.availableQuantity),
        reconciledAt: clean(reservation.reconciledAt, 120),
      },
    } satisfies NinetyNineFoodE2EObservedOrder];
  });

  items.sort((left, right) => {
    const leftTime = left.updatedAt || left.createdAt;
    const rightTime = right.updatedAt || right.createdAt;
    return rightTime.localeCompare(leftTime);
  });

  return {
    canonicalStoreId,
    observedAt: new Date().toISOString(),
    items: items.slice(0, limit),
  };
};
