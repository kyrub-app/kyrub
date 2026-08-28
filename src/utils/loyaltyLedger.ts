import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { CustomerOrder } from './customerOrders';
import { db } from './firebase';
import { getProductBasePoints, type ProductLoyaltyMap } from './productLoyalty';

export type LoyaltyLedgerEventType = 'earn' | 'reversal' | 'adjustment';

export interface LoyaltyLedgerLine {
  lineId: string;
  productId: string;
  productName: string;
  quantity: number;
  basePointsPerUnit: number;
  basePoints: number;
  bonusPoints: number;
  totalPoints: number;
}

export interface LoyaltyLedgerEvent {
  id: string;
  storeId: string;
  buyerId: string;
  buyerEmail: string;
  orderId: string;
  type: LoyaltyLedgerEventType;
  points: number;
  reason: string;
  lines: LoyaltyLedgerLine[];
  sourceEventId: string;
  createdAt: string;
}

const cleanString = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const cleanInteger = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};
const safeId = (value: string): string => value.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);

// Merchant-private canonical ledger. Never place buyer identity in the public artifacts tree.
export const getLoyaltyLedgerCollectionPath = (storeId: string): string =>
  `storeLoyaltyLedgers/${storeId.trim()}/events`;

export const getLoyaltyLedgerEventPath = (storeId: string, eventId: string): string =>
  `${getLoyaltyLedgerCollectionPath(storeId)}/${eventId.trim()}`;

// Buyer-private mirror used by Meu relacionamento. A buyer only reads their own collection.
export const getBuyerLoyaltyLedgerCollectionPath = (buyerId: string): string =>
  `users/${buyerId.trim()}/loyaltyLedger`;

export const getBuyerLoyaltyLedgerEventId = (storeId: string, eventId: string): string =>
  `${safeId(storeId)}__${safeId(eventId)}`.slice(0, 240);

export const getBuyerLoyaltyLedgerEventPath = (
  buyerId: string,
  storeId: string,
  eventId: string
): string => `${getBuyerLoyaltyLedgerCollectionPath(buyerId)}/${getBuyerLoyaltyLedgerEventId(storeId, eventId)}`;

export const getOrderLoyaltyEarnEventId = (orderId: string): string => `order-${orderId.trim()}-earn`;
export const getOrderLoyaltyReversalEventId = (orderId: string): string => `order-${orderId.trim()}-reversal`;

export const buildOrderLoyaltyLines = (
  order: Pick<CustomerOrder, 'items'>,
  loyalty: ProductLoyaltyMap
): LoyaltyLedgerLine[] => order.items.map(item => {
  const eligibleQuantity = Math.max(0, Math.min(item.quantity, item.paidQuantity || item.quantity));
  const basePointsPerUnit = getProductBasePoints(loyalty, item.productId);
  const basePoints = eligibleQuantity * basePointsPerUnit;
  return {
    lineId: item.lineId,
    productId: item.productId,
    productName: item.name,
    quantity: eligibleQuantity,
    basePointsPerUnit,
    basePoints,
    bonusPoints: 0,
    totalPoints: basePoints,
  };
});

export const calculateOrderLoyaltyPoints = (
  order: Pick<CustomerOrder, 'items'>,
  loyalty: ProductLoyaltyMap
): number => buildOrderLoyaltyLines(order, loyalty).reduce((total, line) => total + line.totalPoints, 0);

const eventPayload = (event: LoyaltyLedgerEvent) => ({
  ...event,
  recordedAt: serverTimestamp(),
  schemaVersion: 2,
});

export const persistPaidOrderLoyaltyEarn = async (
  user: Pick<User, 'uid'>,
  order: CustomerOrder,
  loyalty: ProductLoyaltyMap
): Promise<{ created: boolean; points: number }> => {
  if (order.storeId.trim() !== user.uid) throw new Error('Somente a loja responsável pode registrar pontos deste pedido.');
  if (order.paymentStatus !== 'paid' || order.status === 'cancelled' || order.status === 'rejected') {
    return { created: false, points: 0 };
  }
  const lines = buildOrderLoyaltyLines(order, loyalty);
  const points = lines.reduce((total, line) => total + line.totalPoints, 0);
  const eventId = getOrderLoyaltyEarnEventId(order.id);
  const storeReference = doc(db, getLoyaltyLedgerEventPath(order.storeId, eventId));
  const buyerId = order.buyerId.trim();
  const buyerReference = buyerId ? doc(db, getBuyerLoyaltyLedgerEventPath(buyerId, order.storeId, eventId)) : null;

  return runTransaction(db, async transaction => {
    const existing = await transaction.get(storeReference);
    if (existing.exists()) return { created: false, points: cleanInteger(existing.data()?.points) };
    const event: LoyaltyLedgerEvent = {
      id: eventId,
      storeId: order.storeId,
      buyerId,
      buyerEmail: order.buyerEmail.trim().toLocaleLowerCase('pt-BR'),
      orderId: order.id,
      type: 'earn',
      points,
      reason: 'Pontos-base da compra paga',
      lines,
      sourceEventId: order.id,
      createdAt: order.updatedAt || order.createdAt || new Date().toISOString(),
    };
    transaction.set(storeReference, eventPayload(event));
    if (buyerReference) transaction.set(buyerReference, eventPayload(event));
    return { created: true, points };
  });
};

export const persistOrderLoyaltyReversal = async (
  user: Pick<User, 'uid'>,
  order: CustomerOrder,
  reason = 'Estorno dos pontos da compra'
): Promise<{ created: boolean; points: number }> => {
  if (order.storeId.trim() !== user.uid) throw new Error('Somente a loja responsável pode estornar pontos deste pedido.');
  const earnId = getOrderLoyaltyEarnEventId(order.id);
  const reversalId = getOrderLoyaltyReversalEventId(order.id);
  const earnReference = doc(db, getLoyaltyLedgerEventPath(order.storeId, earnId));
  const reversalReference = doc(db, getLoyaltyLedgerEventPath(order.storeId, reversalId));

  return runTransaction(db, async transaction => {
    const [earnSnapshot, reversalSnapshot] = await Promise.all([
      transaction.get(earnReference),
      transaction.get(reversalReference),
    ]);
    if (reversalSnapshot.exists()) return { created: false, points: cleanInteger(reversalSnapshot.data()?.points) };
    if (!earnSnapshot.exists()) return { created: false, points: 0 };
    const earn = parseLoyaltyLedgerEvent(earnSnapshot.data());
    if (!earn || earn.type !== 'earn') return { created: false, points: 0 };
    const points = -Math.abs(earn.points);
    const event: LoyaltyLedgerEvent = {
      ...earn,
      id: reversalId,
      type: 'reversal',
      points,
      reason: reason.trim() || 'Estorno dos pontos da compra',
      lines: earn.lines.map(line => ({
        ...line,
        basePoints: -Math.abs(line.basePoints),
        bonusPoints: -Math.abs(line.bonusPoints),
        totalPoints: -Math.abs(line.totalPoints),
      })),
      sourceEventId: earn.id,
      createdAt: order.updatedAt || new Date().toISOString(),
    };
    transaction.set(reversalReference, eventPayload(event));
    if (earn.buyerId) {
      transaction.set(
        doc(db, getBuyerLoyaltyLedgerEventPath(earn.buyerId, earn.storeId, reversalId)),
        eventPayload(event)
      );
    }
    return { created: true, points };
  });
};

export const reconcileOrderLoyalty = async (
  user: Pick<User, 'uid'>,
  order: CustomerOrder,
  loyalty: ProductLoyaltyMap
): Promise<{ action: 'earned' | 'reversed' | 'none'; points: number }> => {
  if (order.status === 'cancelled' || order.status === 'rejected') {
    const result = await persistOrderLoyaltyReversal(user, order, 'Pedido cancelado ou recusado');
    return { action: result.created ? 'reversed' : 'none', points: result.points };
  }
  if (order.paymentStatus === 'paid') {
    const result = await persistPaidOrderLoyaltyEarn(user, order, loyalty);
    return { action: result.created ? 'earned' : 'none', points: result.points };
  }
  return { action: 'none', points: 0 };
};

export const parseLoyaltyLedgerEvent = (value: unknown): LoyaltyLedgerEvent | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const id = cleanString(record.id);
  const storeId = cleanString(record.storeId);
  const buyerId = cleanString(record.buyerId);
  const orderId = cleanString(record.orderId);
  const type = record.type;
  if (!id || !storeId || !buyerId) return null;
  if (type !== 'earn' && type !== 'reversal' && type !== 'adjustment') return null;
  if ((type === 'earn' || type === 'reversal') && !orderId) return null;
  const lines = Array.isArray(record.lines) ? record.lines.flatMap(value => {
    if (!value || typeof value !== 'object') return [];
    const line = value as Record<string, unknown>;
    const lineId = cleanString(line.lineId);
    const productId = cleanString(line.productId);
    if (!lineId || !productId) return [];
    return [{
      lineId,
      productId,
      productName: cleanString(line.productName),
      quantity: cleanInteger(line.quantity),
      basePointsPerUnit: cleanInteger(line.basePointsPerUnit),
      basePoints: cleanInteger(line.basePoints),
      bonusPoints: cleanInteger(line.bonusPoints),
      totalPoints: cleanInteger(line.totalPoints),
    } satisfies LoyaltyLedgerLine];
  }) : [];
  return {
    id,
    storeId,
    buyerId,
    buyerEmail: cleanString(record.buyerEmail),
    orderId,
    type,
    points: cleanInteger(record.points),
    reason: cleanString(record.reason),
    lines,
    sourceEventId: cleanString(record.sourceEventId),
    createdAt: cleanString(record.createdAt),
  };
};

const subscribeToLedgerCollection = (
  path: string,
  onEvents: (events: LoyaltyLedgerEvent[]) => void,
  onError?: (error: Error) => void,
  storeIdFilter = ''
): Unsubscribe => onSnapshot(
  collection(db, path),
  snapshot => {
    const events = snapshot.docs.flatMap(document => {
      const event = parseLoyaltyLedgerEvent(document.data());
      if (!event || (storeIdFilter && event.storeId !== storeIdFilter)) return [];
      return [event];
    }).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    onEvents(events);
  },
  error => {
    onEvents([]);
    onError?.(error);
  }
);

export const subscribeToStoreLoyaltyLedger = (
  storeId: string,
  onEvents: (events: LoyaltyLedgerEvent[]) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const normalized = storeId.trim();
  if (!normalized) { onEvents([]); return () => undefined; }
  return subscribeToLedgerCollection(getLoyaltyLedgerCollectionPath(normalized), onEvents, onError);
};

export const subscribeToBuyerLoyaltyLedger = (
  buyerId: string,
  storeId: string,
  onEvents: (events: LoyaltyLedgerEvent[]) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const normalizedBuyerId = buyerId.trim();
  const normalizedStoreId = storeId.trim();
  if (!normalizedBuyerId || !normalizedStoreId) { onEvents([]); return () => undefined; }
  return subscribeToLedgerCollection(
    getBuyerLoyaltyLedgerCollectionPath(normalizedBuyerId),
    onEvents,
    onError,
    normalizedStoreId
  );
};

export const getBuyerLoyaltyBalance = (
  events: LoyaltyLedgerEvent[],
  buyerId: string,
  buyerEmail = ''
): number => {
  const id = buyerId.trim();
  const email = buyerEmail.trim().toLocaleLowerCase('pt-BR');
  return events.reduce((total, event) => {
    const matches = event.buyerId === id || (!!email && event.buyerEmail === email);
    return matches ? total + event.points : total;
  }, 0);
};
