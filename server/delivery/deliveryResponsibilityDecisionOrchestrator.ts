import { adminDb } from '../firebaseAdmin.js';
import { assessDeliveryOperationalResponsibility } from '../../shared/deliveryResponsibilityAssessment.js';
import { decideDeliveryBillableWaiting } from '../../shared/deliveryBillableWaitingDecision.js';
import type { DeliveryOperationalEvent, DeliveryOperationalResponsibilityPolicySnapshot } from '../../shared/deliveryOperationalResponsibility.js';
import type { DeliveryPaidWaitingPolicySnapshot } from '../../shared/deliveryPaidWaiting.js';
import { createPaidWaitingObligationFromApprovedDecision } from './deliveryPaidWaitingObligationService.js';

const EVENT_COLLECTION = 'deliveryOperationalEvents';
const DELIVERY_COLLECTION = 'hub/renda/deliveries';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const parseResponsibilityPolicy = (value: unknown): DeliveryOperationalResponsibilityPolicySnapshot | null => {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  if (
    raw.authority !== 'kyrub_platform' ||
    raw.enabled !== true ||
    typeof raw.policyId !== 'string' || !raw.policyId.trim() ||
    !Number.isSafeInteger(raw.version) || Number(raw.version) <= 0 ||
    !Number.isSafeInteger(raw.storeFreeWaitingSeconds) || Number(raw.storeFreeWaitingSeconds) < 0 ||
    !Number.isSafeInteger(raw.customerFreeWaitingSeconds) || Number(raw.customerFreeWaitingSeconds) < 0 ||
    typeof raw.snapshottedAt !== 'string' || Number.isNaN(Date.parse(raw.snapshottedAt))
  ) return null;

  return raw as unknown as DeliveryOperationalResponsibilityPolicySnapshot;
};

const parseEconomicPolicy = (value: unknown): DeliveryPaidWaitingPolicySnapshot | null => {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const payer = raw.payer === 'store' || raw.payer === 'kyrub' ? raw.payer : null;
  if (
    raw.enabled !== true || !payer ||
    typeof raw.policyId !== 'string' || !raw.policyId.trim() ||
    !Number.isSafeInteger(raw.version) || Number(raw.version) <= 0 ||
    !Number.isSafeInteger(raw.freeMinutes) || Number(raw.freeMinutes) < 0 ||
    !Number.isSafeInteger(raw.billingIncrementMinutes) || Number(raw.billingIncrementMinutes) <= 0 ||
    !Number.isSafeInteger(raw.amountPerIncrementMinor) || Number(raw.amountPerIncrementMinor) <= 0 ||
    !Number.isSafeInteger(raw.maxAmountMinor) || Number(raw.maxAmountMinor) < 0
  ) return null;

  return raw as unknown as DeliveryPaidWaitingPolicySnapshot;
};

export const materializeDeliveryResponsibilityAndWaitingDecision = async (input: {
  deliveryId: string;
}): Promise<{ assessmentStatus: string; decisionStatus: string; obligationCreated: boolean } | null> => {
  const deliveryId = clean(input.deliveryId);
  if (!deliveryId) throw new Error('DELIVERY_RESPONSIBILITY_ORCHESTRATOR_ID_INVALID');

  const deliveryRef = adminDb.doc(`${DELIVERY_COLLECTION}/${deliveryId}`);
  return adminDb.runTransaction(async transaction => {
    const deliverySnapshot = await transaction.get(deliveryRef);
    if (!deliverySnapshot.exists) return null;
    const delivery = deliverySnapshot.data() as Record<string, unknown>;
    const orderId = clean(delivery.sourceOrderId);
    const storeId = clean(delivery.storeId);
    const courierId = clean(delivery.courierId) || clean(delivery.assignedCourierId);
    if (!orderId || !storeId || !courierId) return null;

    const responsibilityPolicy = parseResponsibilityPolicy(delivery.responsibilityPolicySnapshot);
    const economicPolicy = parseEconomicPolicy(delivery.waitingPolicySnapshot);
    if (!responsibilityPolicy || !economicPolicy) {
      return null;
    }

    const eventQuery = adminDb.collection(EVENT_COLLECTION)
      .where('deliveryId', '==', deliveryId);
    const eventSnapshots = await transaction.get(eventQuery);
    const events = eventSnapshots.docs
      .map(document => document.data() as DeliveryOperationalEvent)
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));

    const assessedAt = new Date().toISOString();
    const assessment = assessDeliveryOperationalResponsibility({
      deliveryId,
      events,
      policy: responsibilityPolicy,
      assessedAt,
    });
    const decision = decideDeliveryBillableWaiting({
      assessment,
      economicPolicy,
      decidedAt: assessedAt,
    });

    transaction.update(deliveryRef, {
      responsibilityAssessment: assessment,
      billableWaitingDecision: decision,
      economicDecisionUpdatedAt: assessedAt,
    });

    const obligation = decision.status === 'approved'
      ? await createPaidWaitingObligationFromApprovedDecision({
          transaction,
          operationalStoreId: storeId,
          orderId,
          deliveryId,
          courierId,
          decision,
        })
      : null;

    return {
      assessmentStatus: assessment.status,
      decisionStatus: decision.status,
      obligationCreated: Boolean(obligation),
    };
  });
};
