import { adminDb } from '../firebaseAdmin.js';
import type { StoreEconomicLedgerEntry } from '../../shared/storeEconomicLedger.js';
import { buildCourierPayableObligationFromCapture } from '../../shared/economicObligations.js';
import {
  buildDeliveryReturnEconomicPreview,
  type DeliveryReturnEconomicPreview,
} from '../../shared/deliveryReturnEconomicPolicy.js';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const validId = (value: unknown): string => {
  const parsed = clean(value);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(parsed)) {
    throw new Error('DELIVERY_RETURN_ECONOMICS_INVALID');
  }
  return parsed;
};

export const previewDeliveryReturnEconomicReconciliation = async (input: {
  deliveryId: string;
  operatorId: string;
}): Promise<DeliveryReturnEconomicPreview> => {
  const deliveryId = validId(input.deliveryId);
  const operatorId = validId(input.operatorId);
  const [operatorSnap, returnSnap, deliverySnap, claimSnap, completionSnap] = await Promise.all([
    adminDb.doc('kyrub_admin/control_plane/admins/' + operatorId).get(),
    adminDb.doc('deliveryReturnProtocols/' + deliveryId).get(),
    adminDb.doc('hub/renda/deliveries/' + deliveryId).get(),
    adminDb.doc('deliveryClaims/' + deliveryId).get(),
    adminDb.doc('deliveryCompletions/' + deliveryId).get(),
  ]);
  const operator = record(operatorSnap.data());
  if (operator.uid !== operatorId || operator.status !== 'active'
    || !['super_admin', 'operations', 'finance', 'compliance'].includes(clean(operator.role))) {
    throw new Error('DELIVERY_RETURN_ECONOMICS_FORBIDDEN');
  }
  const protocol = record(returnSnap.data());
  const delivery = record(deliverySnap.data());
  const claim = record(claimSnap.data());
  if (!returnSnap.exists || !deliverySnap.exists || !claimSnap.exists
    || completionSnap.exists
    || protocol.status !== 'returned_to_store_pending_reconciliation'
    || protocol.financialStatus !== 'awaiting_independent_reconciliation'
    || delivery.status !== 'returned_to_store'
    || claim.status !== 'returned_to_store'
    || delivery.source !== 'kyrub-order'
    || !protocol.receivedByStoreAt
    || !['intact', 'damaged', 'disputed'].includes(clean(protocol.receivedCondition))
    || delivery.acceptedBy !== protocol.courierId
    || claim.courierId !== protocol.courierId
    || delivery.sourceOrderId !== protocol.orderId
    || delivery.storeId !== protocol.storeId) {
    throw new Error('DELIVERY_RETURN_ECONOMICS_CONFLICT');
  }
  const operationalStoreId = validId(protocol.storeId);
  const orderId = validId(protocol.orderId);
  const courierId = validId(protocol.courierId);
  const tenant = await adminDb.doc('tenants/' + operationalStoreId).get();
  const canonicalStoreId = clean(tenant.data()?.canonicalStoreId);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(canonicalStoreId)) {
    throw new Error('DELIVERY_RETURN_ECONOMICS_SOURCE_UNAVAILABLE');
  }
  // Advisory only: never trust delivery.payment or client-supplied monetary
  // values as the accepted fee. Use the payment capture from the ERP ledger.
  const [captures, obligations] = await Promise.all([
    adminDb.collection('stores/' + canonicalStoreId + '/economicLedger')
      .where('orderId', '==', orderId).limit(101).get(),
    adminDb.collection('stores/' + canonicalStoreId + '/economicObligations')
      .where('fulfillmentId', '==', deliveryId).limit(101).get(),
  ]);
  if (captures.size >= 101 || obligations.size >= 101) {
    throw new Error('DELIVERY_RETURN_ECONOMICS_SOURCE_UNAVAILABLE');
  }
  const paidCaptures = captures.docs
    .map(doc => record(doc.data()))
    .filter(row => row.kind === 'payment_capture'
      && row.storeId === canonicalStoreId && row.orderId === orderId);
  const captured = paidCaptures.length === 1
    ? paidCaptures[0] as unknown as StoreEconomicLedgerEntry : null;
  let originalRouteMinor: number | null = null;
  if (captured) {
    try {
      originalRouteMinor = buildCourierPayableObligationFromCapture({
        capture: captured, fulfillmentId: deliveryId, courierUserId: courierId,
      })?.amountMinor ?? null;
    } catch {
      // A malformed, incomplete or ambiguous capture cannot authorize payment.
      originalRouteMinor = null;
    }
  }
  const existingCourierObligations = obligations.docs
    .map(doc => {
      const raw = record(doc.data());
      return { id: doc.id, kind: clean(raw.kind), status: clean(raw.status) };
    })
    .filter(row => row.kind === 'courier_payable')
    .map(row => ({ id: row.id, status: row.status }));
  return buildDeliveryReturnEconomicPreview({
    deliveryId, orderId, courierId,
    receivedCondition: protocol.receivedCondition as 'intact' | 'damaged' | 'disputed',
    sourceCaptureId: captured ? clean(captured.id) || null : null,
    originalRouteMinor,
    existingCourierObligations,
    // Optional, immutable authorities. Absent in legacy deliveries: no quote.
    acceptedTariffTerms: claim.returnTariffAcceptedTerms,
    returnAuthorizationAt: protocol.authorizedAt
      && typeof (protocol.authorizedAt as {toDate?:()=>Date}).toDate==='function'
      ? (protocol.authorizedAt as {toDate:()=>Date}).toDate().toISOString() : null,
    independentReturnDistanceAuthority: protocol.independentReturnDistanceAuthority,
    recipientWaitingCorroboratedInterval: protocol.recipientWaitingCorroboratedInterval,
  });
};
