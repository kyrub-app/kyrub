import type { KyrubDeliveryCompletion } from '../../shared/kyrubDeliverySettlement.js';

const clean = (value: unknown, maximum = 180): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

export const evaluateKyrubDeliveryCompletion = (input: {
  deliveryId: string;
  orderId: string;
  storeId: string;
  buyerId: string;
  courierId: string;
  deliveryStatus: string;
  correlationId: string;
  buyerConfirmed?: boolean;
  disputed?: boolean;
  confirmedAt?: string;
}): KyrubDeliveryCompletion => {
  const deliveryId = clean(input.deliveryId);
  const orderId = clean(input.orderId);
  const storeId = clean(input.storeId);
  const buyerId = clean(input.buyerId);
  const courierId = clean(input.courierId);
  const correlationId = clean(input.correlationId, 160);
  if (!deliveryId || !orderId || !storeId || !buyerId || !courierId || !correlationId) {
    throw new Error('DELIVERY_COMPLETION_IDENTITY_INVALID');
  }

  if (input.disputed === true) {
    return {
      schemaVersion: 1,
      deliveryId,
      orderId,
      storeId,
      buyerId,
      courierId,
      status: 'disputed',
      settlementEligible: false,
      correlationId,
    };
  }

  if (input.deliveryStatus !== 'done') {
    return {
      schemaVersion: 1,
      deliveryId,
      orderId,
      storeId,
      buyerId,
      courierId,
      status: 'awaiting_delivery',
      settlementEligible: false,
      correlationId,
    };
  }

  if (input.buyerConfirmed !== true) {
    return {
      schemaVersion: 1,
      deliveryId,
      orderId,
      storeId,
      buyerId,
      courierId,
      status: 'awaiting_buyer_confirmation',
      settlementEligible: false,
      correlationId,
    };
  }

  const confirmedAt = clean(input.confirmedAt, 80);
  if (!confirmedAt || Number.isNaN(Date.parse(confirmedAt))) {
    throw new Error('DELIVERY_CONFIRMATION_TIMESTAMP_INVALID');
  }

  return {
    schemaVersion: 1,
    deliveryId,
    orderId,
    storeId,
    buyerId,
    courierId,
    status: 'confirmed',
    settlementEligible: true,
    confirmedBy: buyerId,
    confirmedAt: new Date(confirmedAt).toISOString(),
    correlationId,
  };
};

export const assertKyrubDeliverySettlementEligible = (
  completion: KyrubDeliveryCompletion
): void => {
  if (completion.status !== 'confirmed' || completion.settlementEligible !== true) {
    throw new Error(`DELIVERY_SETTLEMENT_BLOCKED:${completion.status}`);
  }
};
