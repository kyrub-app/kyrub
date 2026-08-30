import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { evaluateKyrubDeliveryCompletion } from './deliveryCompletionService.js';
import { persistDeliveryOperationalEvent } from './deliveryOperationalEventService.js';
import {
  buildCourierPayableObligationFromCapture,
  economicObligationPath,
  type EconomicObligation,
} from '../../shared/economicObligations.js';
import { buildCourierPayableDeliveryEligibilityUpdate } from '../../shared/economicObligationEligibility.js';
import { buildDeliveryPaidWaitingObligationId } from '../../shared/deliveryPaidWaitingObligation.js';
import type { StoreEconomicLedgerEntry } from '../../shared/storeEconomicLedger.js';

const DELIVERY_COLLECTION = 'hub/renda/deliveries';
const DELIVERY_CLAIM_COLLECTION = 'deliveryClaims';
const DELIVERY_TRACKING_COLLECTION = 'deliveryTracking';
const DELIVERY_COMPLETION_COLLECTION = 'deliveryCompletions';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validId = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized || !/^[a-zA-Z0-9_-]{1,128}$/.test(normalized)) {
    throw new Error(`${label} não foi identificado.`);
  }
  return normalized;
};

const orderPath = (storeId: string, orderId: string): string =>
  `artifacts/${storeId}/public/data/customerOrders/${orderId}`;

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const timestampIso = (value: unknown): string => {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    const date = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return '';
};

const assertExistingCourierPayableEquivalent = (
  existing: EconomicObligation,
  expected: EconomicObligation
): void => {
  const immutableKeys: Array<keyof EconomicObligation> = [
    'id',
    'storeId',
    'kind',
    'currency',
    'amountMinor',
    'beneficiaryType',
    'beneficiaryPrincipalId',
    'paymentId',
    'orderId',
    'fulfillmentId',
    'sourceEconomicEntryId',
    'sourceAuthority',
    'createdAt',
  ];
  for (const key of immutableKeys) {
    if (existing[key] !== expected[key]) {
      throw new Error(`DELIVERY_COURIER_PAYABLE_CONFLICT:${String(key)}`);
    }
  }
};

const assertPaidWaitingPayableMatchesDelivery = (input: {
  obligation: EconomicObligation;
  canonicalStoreId: string;
  orderId: string;
  deliveryId: string;
  courierId: string;
}): void => {
  const { obligation } = input;
  if (
    obligation.kind !== 'courier_payable' ||
    obligation.sourceAuthority !== 'delivery_paid_waiting' ||
    obligation.storeId !== input.canonicalStoreId ||
    obligation.orderId !== input.orderId ||
    obligation.fulfillmentId !== input.deliveryId ||
    obligation.beneficiaryType !== 'courier' ||
    obligation.beneficiaryPrincipalId !== input.courierId ||
    obligation.currency !== 'BRL' ||
    !Number.isSafeInteger(obligation.amountMinor) ||
    obligation.amountMinor <= 0
  ) {
    throw new Error('DELIVERY_WAITING_PAYABLE_CONFLICT');
  }
};

export const markCourierArrivedAtCustomer = async (input: {
  deliveryId: string;
  courierId: string;
}): Promise<{ deliveryId: string; status: 'awaiting_buyer_confirmation' }> => {
  const deliveryId = validId(input.deliveryId, 'A entrega');
  const courierId = validId(input.courierId, 'O entregador');
  const deliveryRef = adminDb.doc(`${DELIVERY_COLLECTION}/${deliveryId}`);
  const claimRef = adminDb.doc(`${DELIVERY_CLAIM_COLLECTION}/${deliveryId}`);
  const trackingRef = adminDb.doc(`${DELIVERY_TRACKING_COLLECTION}/${deliveryId}`);

  await adminDb.runTransaction(async transaction => {
    const [deliverySnapshot, claimSnapshot, trackingSnapshot] = await Promise.all([
      transaction.get(deliveryRef),
      transaction.get(claimRef),
      transaction.get(trackingRef),
    ]);
    if (!deliverySnapshot.exists || !claimSnapshot.exists) {
      throw new Error('A entrega não foi encontrada.');
    }
    const delivery = deliverySnapshot.data() as Record<string, unknown>;
    const claim = claimSnapshot.data() as Record<string, unknown>;
    if (clean(claim.courierId) !== courierId) {
      throw new Error('Somente o entregador responsável pode informar a chegada ao cliente.');
    }
    if (clean(delivery.status) === 'done') return;
    if (clean(delivery.status) !== 'delivering') {
      throw new Error('A rota precisa estar em andamento antes da chegada ao cliente.');
    }
    const tracking = trackingSnapshot.data() as Record<string, unknown> | undefined;
    if (!trackingSnapshot.exists || tracking?.active !== true) {
      throw new Error('O rastreio precisa estar ativo no momento da chegada ao cliente.');
    }

    const storeId = validId(clean(delivery.storeId), 'A loja');
    const orderId = validId(clean(delivery.sourceOrderId), 'O pedido');
    const currentHandoff = record(delivery.customerHandoff);
    const existingArrivedAt = timestampIso(currentHandoff.arrivedAt);
    const arrivedAt = existingArrivedAt || Timestamp.now().toDate().toISOString();
    const arrivalEvent = await persistDeliveryOperationalEvent({
      transaction,
      deliveryId,
      orderId,
      storeId,
      courierId,
      type: 'courier_arrived_customer',
      occurredAt: arrivedAt,
      authority: 'courier_action',
      actor: 'courier',
      referenceId: `${DELIVERY_COLLECTION}/${deliveryId}:customerHandoff`,
    });
    if (!arrivalEvent) throw new Error('DELIVERY_CUSTOMER_ARRIVAL_EVENT_CONFLICT');

    if (clean(currentHandoff.status) === 'awaiting_buyer_confirmation') return;

    const customerHandoff = {
      status: 'awaiting_buyer_confirmation',
      arrivedByCourierId: courierId,
      arrivedAt: Timestamp.fromDate(new Date(arrivedAt)),
      trackingWasActive: true,
    };
    transaction.update(deliveryRef, {
      customerHandoff,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(claimRef, {
      customerHandoff,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  return { deliveryId, status: 'awaiting_buyer_confirmation' };
};

export const confirmBuyerReceivedDelivery = async (input: {
  deliveryId: string;
  buyerId: string;
}): Promise<{
  deliveryId: string;
  status: 'done';
  settlementEligible: true;
  courierPayableEligible: boolean;
}> => {
  const deliveryId = validId(input.deliveryId, 'A entrega');
  const buyerId = validId(input.buyerId, 'O comprador');
  const deliveryRef = adminDb.doc(`${DELIVERY_COLLECTION}/${deliveryId}`);
  const claimRef = adminDb.doc(`${DELIVERY_CLAIM_COLLECTION}/${deliveryId}`);
  const trackingRef = adminDb.doc(`${DELIVERY_TRACKING_COLLECTION}/${deliveryId}`);
  const completionRef = adminDb.doc(`${DELIVERY_COMPLETION_COLLECTION}/${deliveryId}`);

  return adminDb.runTransaction(async transaction => {
    const [deliverySnapshot, claimSnapshot, existingCompletionSnapshot] = await Promise.all([
      transaction.get(deliveryRef),
      transaction.get(claimRef),
      transaction.get(completionRef),
    ]);
    if (!deliverySnapshot.exists || !claimSnapshot.exists) {
      throw new Error('A entrega não foi encontrada.');
    }
    const delivery = deliverySnapshot.data() as Record<string, unknown>;
    const claim = claimSnapshot.data() as Record<string, unknown>;
    const storeId = validId(clean(delivery.storeId), 'A loja');
    const orderId = validId(clean(delivery.sourceOrderId), 'O pedido');
    const courierId = validId(clean(claim.courierId), 'O entregador');

    const [orderSnapshot, tenantSnapshot, trackingSnapshot] = await Promise.all([
      transaction.get(adminDb.doc(orderPath(storeId, orderId))),
      transaction.get(adminDb.doc(`tenants/${storeId}`)),
      transaction.get(trackingRef),
    ]);
    if (!orderSnapshot.exists) throw new Error('O pedido vinculado à entrega não foi encontrado.');
    const order = orderSnapshot.data() as Record<string, unknown>;
    if (clean(order.buyerId) !== buyerId || clean(delivery.buyerId) !== buyerId) {
      throw new Error('DELIVERY_BUYER_CONFIRMATION_FORBIDDEN');
    }

    if (existingCompletionSnapshot.exists) {
      const existing = existingCompletionSnapshot.data() as Record<string, unknown>;
      if (
        clean(existing.status) === 'confirmed' &&
        existing.settlementEligible === true &&
        clean(existing.confirmedBy) === buyerId
      ) {
        return {
          deliveryId,
          status: 'done' as const,
          settlementEligible: true as const,
          courierPayableEligible: true,
        };
      }
      throw new Error('DELIVERY_COMPLETION_CONFLICT');
    }

    if (clean(delivery.status) !== 'delivering') {
      throw new Error('A entrega precisa estar em rota antes da confirmação do cliente.');
    }
    const handoff = record(delivery.customerHandoff);
    if (clean(handoff.status) !== 'awaiting_buyer_confirmation') {
      throw new Error('O entregador ainda não informou a chegada ao cliente.');
    }
    if (handoff.trackingWasActive !== true) {
      throw new Error('A chegada ao cliente não possui evidência de rastreio ativo.');
    }

    const confirmedAt = new Date().toISOString();
    const completion = evaluateKyrubDeliveryCompletion({
      deliveryId,
      orderId,
      storeId,
      buyerId,
      courierId,
      deliveryStatus: 'done',
      buyerConfirmed: true,
      confirmedAt,
      correlationId: `delivery:${deliveryId}:buyer_confirmation`,
    });
    if (completion.status !== 'confirmed' || completion.settlementEligible !== true) {
      throw new Error('DELIVERY_COMPLETION_NOT_ELIGIBLE');
    }

    const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId);
    let courierPayable: EconomicObligation | null = null;
    let courierPayableRef: ReturnType<typeof adminDb.doc> | null = null;
    let existingCourierPayable: EconomicObligation | null = null;
    let waitingPayableRef: ReturnType<typeof adminDb.doc> | null = null;
    let existingWaitingPayable: EconomicObligation | null = null;

    if (canonicalStoreId) {
      const captureQuery = adminDb
        .collection(`stores/${canonicalStoreId}/economicLedger`)
        .where('orderId', '==', orderId);
      const waitingObligationId = buildDeliveryPaidWaitingObligationId({
        deliveryId,
        courierId,
      });
      waitingPayableRef = adminDb.doc(
        economicObligationPath(canonicalStoreId, waitingObligationId)
      );
      const [captureSnapshot, waitingSnapshot] = await Promise.all([
        transaction.get(captureQuery),
        transaction.get(waitingPayableRef),
      ]);
      const captures = captureSnapshot.docs
        .map(document => document.data() as StoreEconomicLedgerEntry)
        .filter(entry => entry.kind === 'payment_capture');
      if (captures.length > 1) {
        throw new Error('DELIVERY_CAPTURE_AMBIGUOUS');
      }
      if (captures.length === 1) {
        courierPayable = buildCourierPayableObligationFromCapture({
          capture: captures[0],
          fulfillmentId: deliveryId,
          courierUserId: courierId,
        });
        if (courierPayable) {
          courierPayableRef = adminDb.doc(
            economicObligationPath(canonicalStoreId, courierPayable.id)
          );
          const obligationSnapshot = await transaction.get(courierPayableRef);
          if (obligationSnapshot.exists) {
            existingCourierPayable = obligationSnapshot.data() as EconomicObligation;
            assertExistingCourierPayableEquivalent(existingCourierPayable, courierPayable);
          }
        }
      }
      if (waitingSnapshot.exists) {
        existingWaitingPayable = waitingSnapshot.data() as EconomicObligation;
        assertPaidWaitingPayableMatchesDelivery({
          obligation: existingWaitingPayable,
          canonicalStoreId,
          orderId,
          deliveryId,
          courierId,
        });
      }
    }

    const customerAvailableEvent = await persistDeliveryOperationalEvent({
      transaction,
      deliveryId,
      orderId,
      storeId,
      courierId,
      type: 'customer_available',
      occurredAt: confirmedAt,
      authority: 'customer_action',
      actor: 'customer',
      referenceId: `${DELIVERY_COMPLETION_COLLECTION}/${deliveryId}:buyer_confirmation`,
    });
    if (!customerAvailableEvent) throw new Error('DELIVERY_CUSTOMER_AVAILABLE_EVENT_CONFLICT');

    const confirmedEvent = await persistDeliveryOperationalEvent({
      transaction,
      deliveryId,
      orderId,
      storeId,
      courierId,
      type: 'delivery_confirmed',
      occurredAt: confirmedAt,
      authority: 'customer_action',
      actor: 'customer',
      referenceId: `${DELIVERY_COMPLETION_COLLECTION}/${deliveryId}:buyer_confirmation`,
    });
    if (!confirmedEvent) throw new Error('DELIVERY_CONFIRMED_EVENT_CONFLICT');

    const customerHandoff = {
      ...handoff,
      status: 'confirmed',
      confirmedByBuyerId: buyerId,
      confirmedAt,
    };
    transaction.update(deliveryRef, {
      status: 'done',
      customerHandoff,
      deliveredAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(claimRef, {
      status: 'done',
      customerHandoff,
      deliveredAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(
      adminDb.doc(orderPath(storeId, orderId)),
      { status: 'completed', updatedAt: confirmedAt },
      { merge: true }
    );
    if (canonicalStoreId) {
      transaction.set(
        adminDb.doc(`stores/${canonicalStoreId}/orders/${orderId}`),
        { status: 'completed', updatedAt: confirmedAt },
        { merge: true }
      );
    }
    transaction.create(completionRef, completion);
    transaction.set(
      trackingRef,
      {
        active: false,
        endedAt: FieldValue.serverTimestamp(),
        endReason: 'buyer_confirmed_delivery',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (courierPayable && courierPayableRef) {
      if (!existingCourierPayable) {
        const eligibility = buildCourierPayableDeliveryEligibilityUpdate({
          obligation: courierPayable,
          evidence: {
            storeId: canonicalStoreId,
            orderId,
            deliveryId,
            courierId,
            buyerId,
            confirmedAt,
          },
        });
        transaction.create(courierPayableRef, { ...courierPayable, ...eligibility });
      } else if (existingCourierPayable.status === 'pending') {
        transaction.update(
          courierPayableRef,
          buildCourierPayableDeliveryEligibilityUpdate({
            obligation: existingCourierPayable,
            evidence: {
              storeId: canonicalStoreId,
              orderId,
              deliveryId,
              courierId,
              buyerId,
              confirmedAt,
            },
          })
        );
      } else if (existingCourierPayable.status !== 'eligible' && existingCourierPayable.status !== 'settled') {
        throw new Error(`DELIVERY_COURIER_PAYABLE_STATUS_INVALID:${existingCourierPayable.status}`);
      }
    }

    if (existingWaitingPayable && waitingPayableRef) {
      if (existingWaitingPayable.status !== 'pending') {
        throw new Error(`DELIVERY_WAITING_PAYABLE_STATUS_INVALID:${existingWaitingPayable.status}`);
      }
      transaction.update(
        waitingPayableRef,
        buildCourierPayableDeliveryEligibilityUpdate({
          obligation: existingWaitingPayable,
          evidence: {
            storeId: canonicalStoreId,
            orderId,
            deliveryId,
            courierId,
            buyerId,
            confirmedAt,
          },
        })
      );
    }

    return {
      deliveryId,
      status: 'done' as const,
      settlementEligible: true as const,
      courierPayableEligible: Boolean(courierPayable || existingWaitingPayable),
    };
  });
};
