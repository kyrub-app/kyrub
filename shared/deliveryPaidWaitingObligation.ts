export type DeliveryPaidWaitingObligationPayer = 'store' | 'kyrub';

export interface DeliveryPaidWaitingCourierObligation {
  schemaVersion: 1;
  id: string;
  storeId: string;
  kind: 'courier_payable';
  status: 'pending';
  currency: 'BRL';
  amountMinor: number;
  beneficiaryType: 'courier';
  beneficiaryPrincipalId: string;
  paymentId: string;
  orderId: string;
  fulfillmentId: string;
  sourceEconomicEntryId: string;
  sourceAuthority: 'delivery_paid_waiting';
  funding: {
    customerMinor: 0;
    kyrubMinor: number;
    partnerMinor: 0;
    storeFundedDiscountMinor: 0;
  };
  payer: DeliveryPaidWaitingObligationPayer;
  payerPrincipalId: string;
  waitingEvidenceRef: string;
  billableWaitingDecisionRef: string;
  responsibilityPolicyId: string;
  responsibilityPolicyVersion: number;
  policyId: string;
  policyVersion: number;
  createdAt: string;
  eligibleAt: '';
  settledAt: '';
  reversedAt: '';
}

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const validIdentity = (value: string): boolean =>
  Boolean(value) && value.length <= 180 && !value.includes('/');

const positiveMinor = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error('DELIVERY_WAITING_OBLIGATION_AMOUNT_INVALID');
  }
  return Number(value);
};

export const buildDeliveryPaidWaitingObligationId = (input: {
  deliveryId: string;
  courierId: string;
}): string => {
  const deliveryId = clean(input.deliveryId);
  const courierId = clean(input.courierId);
  if (!validIdentity(deliveryId) || !validIdentity(courierId)) {
    throw new Error('DELIVERY_WAITING_OBLIGATION_IDENTITY_INVALID');
  }
  const id = `obligation:courier_payable:waiting:${deliveryId}:${courierId}`;
  if (id.length > 240) throw new Error('DELIVERY_WAITING_OBLIGATION_IDENTITY_INVALID');
  return id;
};

export const buildDeliveryPaidWaitingCourierObligation = (input: {
  canonicalStoreId: string;
  orderId: string;
  deliveryId: string;
  courierId: string;
  amountMinor: number;
  payer: DeliveryPaidWaitingObligationPayer;
  policyId: string;
  policyVersion: number;
  responsibilityPolicyId: string;
  responsibilityPolicyVersion: number;
  decidedAt: string;
}): DeliveryPaidWaitingCourierObligation => {
  const canonicalStoreId = clean(input.canonicalStoreId);
  const orderId = clean(input.orderId);
  const deliveryId = clean(input.deliveryId);
  const courierId = clean(input.courierId);
  const policyId = clean(input.policyId);
  const responsibilityPolicyId = clean(input.responsibilityPolicyId);
  if (
    !validIdentity(canonicalStoreId) ||
    !validIdentity(orderId) ||
    !validIdentity(deliveryId) ||
    !validIdentity(courierId) ||
    !validIdentity(policyId) ||
    !validIdentity(responsibilityPolicyId) ||
    !Number.isSafeInteger(input.policyVersion) ||
    input.policyVersion <= 0 ||
    !Number.isSafeInteger(input.responsibilityPolicyVersion) ||
    input.responsibilityPolicyVersion <= 0 ||
    !input.decidedAt ||
    Number.isNaN(Date.parse(input.decidedAt)) ||
    (input.payer !== 'store' && input.payer !== 'kyrub')
  ) {
    throw new Error('DELIVERY_WAITING_OBLIGATION_INPUT_INVALID');
  }
  const amountMinor = positiveMinor(input.amountMinor);
  const payerPrincipalId = input.payer === 'store'
    ? `store:${canonicalStoreId}`
    : 'kyrub:platform';

  return {
    schemaVersion: 1,
    id: buildDeliveryPaidWaitingObligationId({ deliveryId, courierId }),
    storeId: canonicalStoreId,
    kind: 'courier_payable',
    status: 'pending',
    currency: 'BRL',
    amountMinor,
    beneficiaryType: 'courier',
    beneficiaryPrincipalId: courierId,
    paymentId: '',
    orderId,
    fulfillmentId: deliveryId,
    sourceEconomicEntryId: '',
    sourceAuthority: 'delivery_paid_waiting',
    funding: {
      customerMinor: 0,
      kyrubMinor: input.payer === 'kyrub' ? amountMinor : 0,
      partnerMinor: 0,
      storeFundedDiscountMinor: 0,
    },
    payer: input.payer,
    payerPrincipalId,
    waitingEvidenceRef: `delivery:${deliveryId}:paidWaitingEvidence`,
    billableWaitingDecisionRef: `delivery:${deliveryId}:billableWaitingDecision`,
    responsibilityPolicyId,
    responsibilityPolicyVersion: input.responsibilityPolicyVersion,
    policyId,
    policyVersion: input.policyVersion,
    createdAt: new Date(input.decidedAt).toISOString(),
    eligibleAt: '',
    settledAt: '',
    reversedAt: '',
  };
};
