import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import {
  executeAuthorizedOrderStatusTransition as executeBaseOrderStatusTransition,
  executeAuthorizedPickupCodeRead,
  mapOrderStatusExecutionError,
} from './orderStatusExecutionServiceBase.js';
import type { OrderStatusExecutionHttpResult } from './orderStatusExecutionServiceBase.js';

export { executeAuthorizedPickupCodeRead, mapOrderStatusExecutionError };
export type { OrderStatusExecutionHttpResult };

const PAYMENT_GATED_PRODUCTION_STATUSES = new Set([
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
]);

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

export const executeAuthorizedOrderStatusTransition = async (
  authorization: string,
  body: unknown
): Promise<OrderStatusExecutionHttpResult> => {
  const candidate = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const requestedStatus = clean(candidate.status);
  if (!PAYMENT_GATED_PRODUCTION_STATUSES.has(requestedStatus)) {
    return executeBaseOrderStatusTransition(authorization, body);
  }

  const token = bearerToken(authorization);
  const orderId = clean(candidate.orderId);
  if (!token || !orderId) {
    return executeBaseOrderStatusTransition(authorization, body);
  }

  try {
    const identity = await verifyFirebaseIdToken(token);
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
      };
    }
  } catch (error) {
    console.warn('[Order Status Execution] Payment gate precheck deferred to canonical transition.', error);
  }

  return executeBaseOrderStatusTransition(authorization, body);
};
