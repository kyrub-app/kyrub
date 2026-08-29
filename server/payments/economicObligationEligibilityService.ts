import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import {
  ECONOMIC_OBLIGATION_SCHEMA_VERSION,
  type EconomicObligation,
} from '../../shared/economicObligations.js';
import { buildStoreReceivablePickupEligibilityUpdate } from '../../shared/economicObligationEligibility.js';

export interface FinalizePickupEligibilityResult {
  handedOverAt: string;
  eligibleReceivables: number;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validIso = (value: unknown): value is string =>
  typeof value === 'string' && Boolean(value) && Number.isFinite(Date.parse(value));

const handoffRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const pickupSecretId = (tenantId: string, orderId: string): string =>
  createHash('sha256').update(`${tenantId}:${orderId}`).digest('hex');

const parseStoreReceivable = (
  value: unknown,
  expectedStoreId: string,
  expectedOrderId: string
): EconomicObligation => {
  const obligation = value as Partial<EconomicObligation>;
  const statusValid =
    obligation.status === 'pending' ||
    obligation.status === 'eligible' ||
    obligation.status === 'settled' ||
    obligation.status === 'reversed';

  if (
    obligation.schemaVersion !== ECONOMIC_OBLIGATION_SCHEMA_VERSION ||
    obligation.storeId !== expectedStoreId ||
    obligation.orderId !== expectedOrderId ||
    obligation.kind !== 'store_receivable' ||
    !statusValid ||
    obligation.currency !== 'BRL' ||
    !Number.isSafeInteger(obligation.amountMinor) ||
    Number(obligation.amountMinor) <= 0 ||
    obligation.beneficiaryType !== 'store' ||
    obligation.beneficiaryPrincipalId !== `store:${expectedStoreId}` ||
    obligation.fulfillmentId !== '' ||
    !clean(obligation.id) ||
    !clean(obligation.paymentId) ||
    !clean(obligation.sourceEconomicEntryId) ||
    obligation.sourceAuthority !== 'economic_allocation_snapshot' ||
    !validIso(obligation.createdAt) ||
    typeof obligation.eligibleAt !== 'string' ||
    typeof obligation.settledAt !== 'string' ||
    typeof obligation.reversedAt !== 'string'
  ) {
    throw new Error('ECONOMIC_OBLIGATION_ELIGIBILITY_STORED_RECEIVABLE_INVALID');
  }
  return obligation as EconomicObligation;
};

export const finalizePickupHandoffWithEconomicEligibility = async (input: {
  tenantId: string;
  orderId: string;
  actorId: string;
}): Promise<FinalizePickupEligibilityResult> => {
  const tenantId = clean(input.tenantId);
  const orderId = clean(input.orderId);
  const actorId = clean(input.actorId);
  if (!tenantId || !orderId || !actorId) {
    throw new Error('ECONOMIC_OBLIGATION_ELIGIBILITY_TARGET_REQUIRED');
  }

  const legacyOrderRef = adminDb.doc(
    `artifacts/${tenantId}/public/data/customerOrders/${orderId}`
  );
  const tenantRef = adminDb.doc(`tenants/${tenantId}`);
  const secretRef = adminDb.doc(
    `orderPickupSecrets/${pickupSecretId(tenantId, orderId)}`
  );

  return adminDb.runTransaction(async transaction => {
    const [orderSnapshot, tenantSnapshot] = await Promise.all([
      transaction.get(legacyOrderRef),
      transaction.get(tenantRef),
    ]);
    if (!orderSnapshot.exists) throw new Error('Pedido não encontrado.');

    const order = orderSnapshot.data() as Record<string, unknown>;
    if (order.fulfillmentType !== 'pickup' || order.status !== 'completed') {
      throw new Error('ECONOMIC_OBLIGATION_ELIGIBILITY_PICKUP_NOT_COMPLETED');
    }

    const handoff = handoffRecord(order.handoff);
    const currentHandoffStatus = clean(handoff.status);
    if (currentHandoffStatus !== 'verified' && currentHandoffStatus !== 'handed_over') {
      throw new Error('ECONOMIC_OBLIGATION_ELIGIBILITY_HANDOFF_NOT_VERIFIED');
    }

    const verifiedAt = clean(handoff.verifiedAt);
    const verifiedBy = clean(handoff.verifiedBy);
    if (!validIso(verifiedAt) || !verifiedBy) {
      throw new Error('ECONOMIC_OBLIGATION_ELIGIBILITY_HANDOFF_EVIDENCE_INVALID');
    }

    const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId);
    const receivableQuery = canonicalStoreId
      ? adminDb
        .collection(`stores/${canonicalStoreId}/economicObligations`)
        .where('orderId', '==', orderId)
      : null;
    const receivableSnapshot = receivableQuery
      ? await transaction.get(receivableQuery)
      : null;

    const now = new Date().toISOString();
    const handedOverAt = currentHandoffStatus === 'handed_over'
      ? clean(handoff.handedOverAt)
      : now;
    const handedOverBy = currentHandoffStatus === 'handed_over'
      ? clean(handoff.handedOverBy)
      : actorId;
    if (!validIso(handedOverAt) || !handedOverBy) {
      throw new Error('ECONOMIC_OBLIGATION_ELIGIBILITY_HANDOFF_FINAL_INVALID');
    }

    const nextHandoff = currentHandoffStatus === 'handed_over'
      ? handoff
      : {
        ...handoff,
        status: 'handed_over',
        handedOverAt,
        handedOverBy,
      };

    let eligibleReceivables = 0;
    if (receivableSnapshot && canonicalStoreId) {
      for (const document of receivableSnapshot.docs) {
        const raw = document.data() as Record<string, unknown>;
        if (raw.kind !== 'store_receivable') continue;
        const obligation = parseStoreReceivable(raw, canonicalStoreId, orderId);
        if (obligation.status !== 'pending') continue;

        const eligibility = buildStoreReceivablePickupEligibilityUpdate({
          obligation,
          evidence: {
            storeId: canonicalStoreId,
            orderId,
            verifiedAt,
            verifiedBy,
            handedOverAt,
            handedOverBy,
          },
        });
        transaction.update(document.ref, eligibility);
        eligibleReceivables += 1;
      }
    }

    transaction.set(
      legacyOrderRef,
      { handoff: nextHandoff, updatedAt: handedOverAt },
      { merge: true }
    );
    if (canonicalStoreId) {
      transaction.set(
        adminDb.doc(`stores/${canonicalStoreId}/orders/${orderId}`),
        { handoff: nextHandoff, updatedAt: handedOverAt },
        { merge: true }
      );
    }
    transaction.delete(secretRef);

    return { handedOverAt, eligibleReceivables };
  });
};
