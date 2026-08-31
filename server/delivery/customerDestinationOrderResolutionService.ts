import { FieldValue } from 'firebase-admin/firestore';
import { normalizeCanonicalPaymentIntent } from '../../src/utils/canonicalPaymentIntent.js';
import { parseDeliveryCustomerDestinationResolution } from '../../shared/deliveryCustomerDestinationResolution.js';
import { adminDb } from '../firebaseAdmin.js';
import { resolveCustomerDestinationFromAddress } from './customerDestinationGeocodingService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const resolutionPath = (storeId: string, orderId: string): string =>
  `stores/${storeId}/orderDestinationResolutions/${orderId}`;

const orderPath = (storeId: string, orderId: string): string =>
  `artifacts/${storeId}/public/data/customerOrders/${orderId}`;

export type PersistedCustomerDestinationResolutionStatus =
  | 'not_applicable'
  | 'resolved'
  | 'review_required'
  | 'provider_not_configured'
  | 'not_found'
  | 'provider_unavailable';

export interface PreparedCustomerDestinationResolution {
  storeId: string;
  orderId: string;
  paymentIntentId: string;
  status: PersistedCustomerDestinationResolutionStatus;
  resolution: ReturnType<typeof parseDeliveryCustomerDestinationResolution>;
}

const parsePrepared = (
  value: unknown
): PreparedCustomerDestinationResolution | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const status = clean(raw.status) as PersistedCustomerDestinationResolutionStatus;
  if (![
    'not_applicable',
    'resolved',
    'review_required',
    'provider_not_configured',
    'not_found',
    'provider_unavailable',
  ].includes(status)) return null;
  const storeId = clean(raw.storeId);
  const orderId = clean(raw.orderId);
  const paymentIntentId = clean(raw.paymentIntentId);
  if (!storeId || !orderId || !paymentIntentId) return null;
  const resolution = raw.resolution
    ? parseDeliveryCustomerDestinationResolution(raw.resolution)
    : null;
  if ((status === 'resolved' || status === 'review_required') && !resolution) return null;
  if (resolution && resolution.status !== status) return null;
  return { storeId, orderId, paymentIntentId, status, resolution };
};

export const prepareCustomerDestinationResolutionForPaymentIntent = async (input: {
  storeId: string;
  paymentIntentId: string;
}): Promise<PreparedCustomerDestinationResolution> => {
  const storeId = input.storeId.trim();
  const paymentIntentId = input.paymentIntentId.trim();
  if (!storeId || !paymentIntentId) {
    throw new Error('CUSTOMER_DESTINATION_TARGET_REQUIRED');
  }

  const intentSnapshot = await adminDb
    .doc(`stores/${storeId}/paymentIntents/${paymentIntentId}`)
    .get();
  if (!intentSnapshot.exists) throw new Error('PAYMENT_INTENT_NOT_FOUND');
  const intent = normalizeCanonicalPaymentIntent(intentSnapshot.data() as never);
  if (intent.storeId !== storeId || intent.id !== paymentIntentId) {
    throw new Error('CUSTOMER_DESTINATION_PAYMENT_INTENT_MISMATCH');
  }

  const orderId = intent.orderDraft.draftId;
  const reference = adminDb.doc(resolutionPath(storeId, orderId));
  const existingSnapshot = await reference.get();
  if (existingSnapshot.exists) {
    const existing = parsePrepared(existingSnapshot.data());
    if (
      !existing ||
      existing.storeId !== storeId ||
      existing.orderId !== orderId ||
      existing.paymentIntentId !== paymentIntentId
    ) {
      throw new Error('CUSTOMER_DESTINATION_RESOLUTION_CONFLICT');
    }
    return existing;
  }

  const attempt = intent.orderDraft.fulfillmentType === 'delivery'
    ? await resolveCustomerDestinationFromAddress(intent.orderDraft.deliveryAddress)
    : { resolution: null, status: 'not_applicable' as const };

  const prepared: PreparedCustomerDestinationResolution = {
    storeId,
    orderId,
    paymentIntentId,
    status: attempt.status,
    resolution: attempt.resolution,
  };

  try {
    await reference.create({
      schemaVersion: 1,
      ...prepared,
      authority: 'kyrub_server',
      source: 'payment_intent_order_birth',
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    const racedSnapshot = await reference.get();
    const raced = parsePrepared(racedSnapshot.data());
    if (
      racedSnapshot.exists &&
      raced &&
      raced.storeId === storeId &&
      raced.orderId === orderId &&
      raced.paymentIntentId === paymentIntentId
    ) {
      return raced;
    }
    throw error;
  }

  return prepared;
};

export const attachPreparedCustomerDestinationResolutionToOperationalOrder = async (
  prepared: PreparedCustomerDestinationResolution
): Promise<void> => {
  const reference = adminDb.doc(orderPath(prepared.storeId, prepared.orderId));
  await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) return;
    const order = snapshot.data() as Record<string, unknown>;
    const existingStatus = clean(order.customerDestinationResolutionStatus);
    const existingResolution = order.customerDestinationResolution
      ? parseDeliveryCustomerDestinationResolution(order.customerDestinationResolution)
      : null;

    if (existingStatus) {
      if (existingStatus !== prepared.status) {
        throw new Error('CUSTOMER_DESTINATION_ORDER_RESOLUTION_CONFLICT');
      }
      if (
        prepared.resolution &&
        (!existingResolution ||
          existingResolution.placeId !== prepared.resolution.placeId ||
          existingResolution.latitude !== prepared.resolution.latitude ||
          existingResolution.longitude !== prepared.resolution.longitude)
      ) {
        throw new Error('CUSTOMER_DESTINATION_ORDER_RESOLUTION_CONFLICT');
      }
      return;
    }

    transaction.update(reference, {
      customerDestinationResolutionStatus: prepared.status,
      ...(prepared.resolution
        ? { customerDestinationResolution: prepared.resolution }
        : {}),
      customerDestinationResolutionAuthority: 'kyrub_server',
      customerDestinationResolutionSource: 'payment_intent_order_birth',
      customerDestinationResolutionPaymentIntentId: prepared.paymentIntentId,
      customerDestinationResolutionAttachedAt: FieldValue.serverTimestamp(),
    });
  });
};
