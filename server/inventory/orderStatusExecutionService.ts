import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import {
  executeAuthorizedOrderStatusTransition as executeBaseOrderStatusTransition,
  executeAuthorizedPickupCodeRead,
  mapOrderStatusExecutionError,
} from './orderStatusExecutionServiceBase.js';
import type { OrderStatusExecutionHttpResult } from './orderStatusExecutionServiceBase.js';
import {
  commitMarketplaceOrderInventoryReservation,
  releaseMarketplaceOrderInventoryReservation,
  reserveMarketplaceOrderInventoryOnAcceptance,
} from './marketplaceOrderInventoryReservationService.js';

export { executeAuthorizedPickupCodeRead, mapOrderStatusExecutionError };
export type { OrderStatusExecutionHttpResult };

const PAYMENT_GATED_PRODUCTION_STATUSES = new Set([
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
]);

const TERMINAL_RELEASE_STATUSES = new Set(['rejected', 'cancelled']);

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const resultInventoryAction = (result: OrderStatusExecutionHttpResult): string => {
  if (!result.body || typeof result.body !== 'object' || Array.isArray(result.body)) return '';
  return clean((result.body as Record<string, unknown>).inventoryAction);
};

const successful = (result: OrderStatusExecutionHttpResult): boolean =>
  result.status >= 200 && result.status < 300;

const reservationErrorResult = (error: unknown): OrderStatusExecutionHttpResult => {
  const message = error instanceof Error ? error.message : String(error);
  if (/reserva de estoque|estoque reservado/i.test(message)) {
    return {
      status: 409,
      body: {
        error: message,
        code: 'INVENTORY_RESERVATION_BLOCKED',
      },
    } as unknown as OrderStatusExecutionHttpResult;
  }
  return mapOrderStatusExecutionError(error);
};

export const executeAuthorizedOrderStatusTransition = async (
  authorization: string,
  body: unknown
): Promise<OrderStatusExecutionHttpResult> => {
  const candidate = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const requestedStatus = clean(candidate.status);
  const token = bearerToken(authorization);
  const orderId = clean(candidate.orderId);
  let actorUid = '';

  if (PAYMENT_GATED_PRODUCTION_STATUSES.has(requestedStatus) && token && orderId) {
    try {
      const identity = await verifyFirebaseIdToken(token);
      actorUid = identity.uid;
      const snapshot = await adminDb
        .doc(`artifacts/${identity.uid}/public/data/customerOrders/${orderId}`)
        .get();
      const order = snapshot.data() as Record<string, unknown> | undefined;
      if (
        snapshot.exists &&
        clean(order?.checkoutAuthority) === 'merchant_approval_required' &&
        clean(order?.paymentStatus) !== 'paid'
      ) {
        return {
          status: 409,
          body: {
            error: 'O pedido foi aceito, mas o pagamento ainda não foi confirmado. Aguarde o Pix antes de iniciar a produção.',
            code: 'PAYMENT_REQUIRED_FOR_PRODUCTION',
          },
        } as unknown as OrderStatusExecutionHttpResult;
      }
    } catch (error) {
      console.warn('[Order Status Execution] Payment gate precheck deferred to canonical transition.', error);
    }
  }

  if (requestedStatus === 'accepted' && token && orderId) {
    let reservationAction: Awaited<ReturnType<typeof reserveMarketplaceOrderInventoryOnAcceptance>> = 'not_applicable';
    try {
      if (!actorUid) {
        const identity = await verifyFirebaseIdToken(token);
        actorUid = identity.uid;
      }
      reservationAction = await reserveMarketplaceOrderInventoryOnAcceptance(
        actorUid,
        orderId
      );
    } catch (error) {
      return reservationErrorResult(error);
    }

    const result = await executeBaseOrderStatusTransition(authorization, body);
    if (!successful(result)) {
      if (reservationAction === 'reserved') {
        await releaseMarketplaceOrderInventoryReservation({
          tenantId: actorUid,
          orderId,
          reason: 'acceptance_failed',
          retryable: true,
        }).catch(error => {
          console.error('[Order Status Execution] Acceptance reservation compensation failed.', error);
        });
      }
      return result;
    }

    const inventoryAction = resultInventoryAction(result);
    if (inventoryAction === 'consumed' || inventoryAction === 'duplicate') {
      await commitMarketplaceOrderInventoryReservation(actorUid, orderId).catch(error => {
        console.error('[Order Status Execution] Reservation commit after acceptance failed.', error);
      });
    }
    return result;
  }

  const result = await executeBaseOrderStatusTransition(authorization, body);
  if (!successful(result) || !token || !orderId) return result;

  try {
    if (!actorUid) {
      const identity = await verifyFirebaseIdToken(token);
      actorUid = identity.uid;
    }
    if (TERMINAL_RELEASE_STATUSES.has(requestedStatus)) {
      await releaseMarketplaceOrderInventoryReservation({
        tenantId: actorUid,
        orderId,
        reason: `order_${requestedStatus}`,
      });
    } else if (PAYMENT_GATED_PRODUCTION_STATUSES.has(requestedStatus)) {
      const inventoryAction = resultInventoryAction(result);
      if (inventoryAction === 'consumed' || inventoryAction === 'duplicate') {
        await commitMarketplaceOrderInventoryReservation(actorUid, orderId);
      }
    }
  } catch (error) {
    console.error('[Order Status Execution] Inventory reservation reconciliation failed.', error);
  }

  return result;
};
