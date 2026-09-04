import type { User } from 'firebase/auth';
import { recordOmnichannelE2EEvidence } from './omnichannelE2EEvidence';

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

export interface NinetyNineFoodE2EObservedOrder {
  orderId: string;
  externalOrderId: string;
  displayId: string;
  customerName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastEvent: string;
  inboundEvent: {
    eventId: string;
    eventType: string;
    status: string;
    receivedAt: string;
    processedAt: string;
  };
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

export interface NinetyNineFoodE2EOrderObservationResult {
  canonicalStoreId: string;
  observedAt: string;
  items: NinetyNineFoodE2EObservedOrder[];
}

const RESERVATION_STATES = new Set<NinetyNineFoodObservedReservationState>([
  'reserved',
  'released',
  'consumed',
  'waiting_physical_consumption',
  'not_applicable',
  'blocked_product_binding_unresolved',
  'blocked_insufficient_atp',
  'blocked_authority_unresolved',
  'unobserved',
]);

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string =>
        typeof item === 'string' && Boolean(item.trim())
      ).map(item => item.trim())
    : [];

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const parseObservedOrder = (value: unknown): NinetyNineFoodE2EObservedOrder | null => {
  const candidate = object(value);
  const orderId = clean(candidate.orderId);
  const externalOrderId = clean(candidate.externalOrderId);
  const status = clean(candidate.status);
  const inbound = object(candidate.inboundEvent);
  const reservationValue = object(candidate.reservation);
  const reservationState = clean(reservationValue.state) as NinetyNineFoodObservedReservationState;
  if (
    !orderId ||
    !externalOrderId ||
    !status ||
    !RESERVATION_STATES.has(reservationState)
  ) {
    return null;
  }
  return {
    orderId,
    externalOrderId,
    displayId: clean(candidate.displayId) || externalOrderId,
    customerName: clean(candidate.customerName),
    status,
    createdAt: clean(candidate.createdAt),
    updatedAt: clean(candidate.updatedAt),
    lastEvent: clean(candidate.lastEvent),
    inboundEvent: {
      eventId: clean(inbound.eventId),
      eventType: clean(inbound.eventType),
      status: clean(inbound.status) || 'unobserved',
      receivedAt: clean(inbound.receivedAt),
      processedAt: clean(inbound.processedAt),
    },
    reservation: {
      state: reservationState,
      detail: clean(reservationValue.detail),
      canonicalProductIds: strings(reservationValue.canonicalProductIds),
      unresolvedExternalProductIds: strings(
        reservationValue.unresolvedExternalProductIds
      ),
      inventoryItemId: clean(reservationValue.inventoryItemId),
      requiredQuantity: finiteNumber(reservationValue.requiredQuantity),
      availableQuantity: finiteNumber(reservationValue.availableQuantity),
      reconciledAt: clean(reservationValue.reconciledAt),
    },
  };
};

export const loadNinetyNineFoodE2EObservedOrders = async (
  user: User,
  limit = 20
): Promise<NinetyNineFoodE2EOrderObservationResult> => {
  const token = await user.getIdToken();
  const normalizedLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
  const response = await fetch(
    `/api/integrations/99food/e2e/recent-orders?limit=${normalizedLimit}`,
    {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    }
  );
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      clean(payload.error) ||
      `Não foi possível observar os pedidos 99Food (${response.status}).`
    );
  }
  const canonicalStoreId = clean(payload.canonicalStoreId);
  const observedAt = clean(payload.observedAt);
  if (!canonicalStoreId || !observedAt || !Array.isArray(payload.items)) {
    throw new Error('A leitura autoritativa dos pedidos 99Food está incompleta.');
  }
  const items = payload.items
    .map(parseObservedOrder)
    .filter((item): item is NinetyNineFoodE2EObservedOrder => Boolean(item));

  for (const item of items) {
    const ingressProcessed = item.inboundEvent.status === 'processed';
    recordOmnichannelE2EEvidence({
      storeId: user.uid,
      kind: '99food_order_observation',
      source: 'canonical_readback',
      referenceId: item.orderId,
      outcome: ingressProcessed
        ? item.reservation.state
        : `ingress_${item.inboundEvent.status}`,
      summary: ingressProcessed
        ? `Pedido 99Food ${item.displayId} observado no canônico com evento ${item.inboundEvent.eventId} processado e reserva em ${item.reservation.state}.`
        : `Pedido 99Food ${item.displayId} existe no canônico, mas a evidência ingress está em ${item.inboundEvent.status}; não trate esta observação como prova limpa de entrada.`,
      details: {
        orderId: item.orderId,
        externalOrderId: item.externalOrderId,
        displayId: item.displayId,
        orderStatus: item.status,
        lastEvent: item.lastEvent,
        inboundEventId: item.inboundEvent.eventId,
        inboundEventType: item.inboundEvent.eventType,
        inboundEventStatus: item.inboundEvent.status,
        reservationState: item.reservation.state,
        inventoryItemId: item.reservation.inventoryItemId,
        requiredQuantity: item.reservation.requiredQuantity,
        availableQuantity: item.reservation.availableQuantity,
      },
    });
  }

  return { canonicalStoreId, observedAt, items };
};
