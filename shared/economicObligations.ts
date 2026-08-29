import type { EconomicAllocationSnapshot } from './economicFeesSubsidies.js';
import type { StoreEconomicLedgerEntry } from './storeEconomicLedger.js';

export const ECONOMIC_OBLIGATION_SCHEMA_VERSION = 1 as const;
export const ECONOMIC_OBLIGATION_CURRENCY = 'BRL' as const;

export type EconomicObligationKind =
  | 'store_receivable'
  | 'courier_payable';

export type EconomicObligationStatus =
  | 'pending'
  | 'eligible'
  | 'settled'
  | 'reversed';

export type EconomicObligationBeneficiaryType = 'store' | 'courier';
export type EconomicObligationSourceAuthority = 'economic_allocation_snapshot';

export interface EconomicObligationFundingSnapshot {
  customerMinor: number;
  kyrubMinor: number;
  partnerMinor: number;
  storeFundedDiscountMinor: number;
}

export interface EconomicObligation {
  schemaVersion: typeof ECONOMIC_OBLIGATION_SCHEMA_VERSION;
  id: string;
  storeId: string;
  kind: EconomicObligationKind;
  status: EconomicObligationStatus;
  currency: typeof ECONOMIC_OBLIGATION_CURRENCY;
  amountMinor: number;
  beneficiaryType: EconomicObligationBeneficiaryType;
  beneficiaryPrincipalId: string;
  paymentId: string;
  orderId: string;
  fulfillmentId: string;
  sourceEconomicEntryId: string;
  sourceAuthority: EconomicObligationSourceAuthority;
  funding: EconomicObligationFundingSnapshot;
  createdAt: string;
  eligibleAt: string;
  settledAt: string;
  reversedAt: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validIso = (value: string): boolean =>
  Boolean(value) && Number.isFinite(Date.parse(value));

const validPathId = (value: string): boolean =>
  Boolean(value) && value.length <= 240 && value !== '.' && value !== '..';

const positiveMinor = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`ECONOMIC_OBLIGATION_${label}_INVALID`);
  }
  return value;
};

const nonNegativeMinor = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`ECONOMIC_OBLIGATION_${label}_INVALID`);
  }
  return value;
};

const addSafe = (left: number, right: number, label: string): number => {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new Error(`ECONOMIC_OBLIGATION_${label}_OVERFLOW`);
  }
  return result;
};

const requireCaptureAllocation = (
  capture: StoreEconomicLedgerEntry
): EconomicAllocationSnapshot => {
  if (
    capture.kind !== 'payment_capture' ||
    capture.amountMinor <= 0 ||
    !capture.storeId ||
    !capture.paymentId ||
    !capture.orderId ||
    !validIso(clean(capture.occurredAt))
  ) {
    throw new Error('ECONOMIC_OBLIGATION_CAPTURE_INVALID');
  }
  if (!capture.economicAllocation) {
    throw new Error('ECONOMIC_OBLIGATION_ALLOCATION_REQUIRED');
  }
  if (capture.economicAllocation.currency !== ECONOMIC_OBLIGATION_CURRENCY) {
    throw new Error('ECONOMIC_OBLIGATION_CURRENCY_INVALID');
  }
  if (capture.amountMinor !== capture.economicAllocation.customerPaidMinor) {
    throw new Error('ECONOMIC_OBLIGATION_CAPTURE_ALLOCATION_MISMATCH');
  }
  return capture.economicAllocation;
};

const obligationId = (kind: EconomicObligationKind, ...parts: string[]): string => {
  const normalized = parts.map(clean);
  if (normalized.some(part => !part || part.includes('/'))) {
    throw new Error('ECONOMIC_OBLIGATION_IDENTITY_INVALID');
  }
  const id = `obligation:${kind}:${normalized.join(':')}`;
  if (!validPathId(id)) {
    throw new Error('ECONOMIC_OBLIGATION_IDENTITY_INVALID');
  }
  return id;
};

export const buildStoreReceivableObligationId = (paymentId: string): string =>
  obligationId('store_receivable', paymentId);

export const buildCourierPayableObligationId = (input: {
  paymentId: string;
  fulfillmentId: string;
  courierUserId: string;
}): string =>
  obligationId(
    'courier_payable',
    input.paymentId,
    input.fulfillmentId,
    input.courierUserId
  );

export const economicObligationPath = (
  storeIdInput: string,
  obligationIdInput: string
): string => {
  const storeId = clean(storeIdInput);
  const id = clean(obligationIdInput);
  if (!storeId || storeId.includes('/') || !validPathId(id)) {
    throw new Error('ECONOMIC_OBLIGATION_PATH_INVALID');
  }
  return `stores/${storeId}/economicObligations/${encodeURIComponent(id)}`;
};

export const deriveStoreReceivableMinor = (
  allocation: EconomicAllocationSnapshot
): number => {
  const merchandiseGrossMinor = nonNegativeMinor(
    allocation.merchandiseGrossMinor,
    'MERCHANDISE_GROSS'
  );
  const storeFundedDiscountMinor = nonNegativeMinor(
    allocation.storeSubsidyMinor,
    'STORE_SUBSIDY'
  );
  const amountMinor = merchandiseGrossMinor - storeFundedDiscountMinor;
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error('ECONOMIC_OBLIGATION_STORE_RECEIVABLE_INVALID');
  }
  return amountMinor;
};

const storeFundingSnapshot = (
  allocation: EconomicAllocationSnapshot,
  amountMinor: number
): EconomicObligationFundingSnapshot => {
  const customerMinor =
    nonNegativeMinor(allocation.customerPaidMinor, 'CUSTOMER_PAID') -
    nonNegativeMinor(allocation.deliveryFeeMinor, 'DELIVERY_FEE');
  if (!Number.isSafeInteger(customerMinor) || customerMinor < 0) {
    throw new Error('ECONOMIC_OBLIGATION_CUSTOMER_FUNDING_INVALID');
  }
  const kyrubMinor = nonNegativeMinor(
    allocation.kyrubIncentiveMinor,
    'KYRUB_INCENTIVE'
  );
  const partnerMinor = nonNegativeMinor(
    allocation.partnerSubsidyMinor,
    'PARTNER_SUBSIDY'
  );
  const fundedMinor = addSafe(
    addSafe(customerMinor, kyrubMinor, 'STORE_FUNDING'),
    partnerMinor,
    'STORE_FUNDING'
  );
  if (fundedMinor !== amountMinor) {
    throw new Error('ECONOMIC_OBLIGATION_STORE_FUNDING_MISMATCH');
  }
  return {
    customerMinor,
    kyrubMinor,
    partnerMinor,
    storeFundedDiscountMinor: nonNegativeMinor(
      allocation.storeSubsidyMinor,
      'STORE_SUBSIDY'
    ),
  };
};

const baseObligation = (input: {
  capture: StoreEconomicLedgerEntry;
  id: string;
  kind: EconomicObligationKind;
  amountMinor: number;
  beneficiaryType: EconomicObligationBeneficiaryType;
  beneficiaryPrincipalId: string;
  fulfillmentId: string;
  funding: EconomicObligationFundingSnapshot;
}): EconomicObligation => ({
  schemaVersion: ECONOMIC_OBLIGATION_SCHEMA_VERSION,
  id: input.id,
  storeId: clean(input.capture.storeId),
  kind: input.kind,
  status: 'pending',
  currency: ECONOMIC_OBLIGATION_CURRENCY,
  amountMinor: positiveMinor(input.amountMinor, 'AMOUNT'),
  beneficiaryType: input.beneficiaryType,
  beneficiaryPrincipalId: clean(input.beneficiaryPrincipalId),
  paymentId: clean(input.capture.paymentId),
  orderId: clean(input.capture.orderId),
  fulfillmentId: clean(input.fulfillmentId),
  sourceEconomicEntryId: clean(input.capture.id),
  sourceAuthority: 'economic_allocation_snapshot',
  funding: input.funding,
  createdAt: clean(input.capture.occurredAt),
  eligibleAt: '',
  settledAt: '',
  reversedAt: '',
});

export const buildStoreReceivableObligationFromCapture = (
  capture: StoreEconomicLedgerEntry
): EconomicObligation | null => {
  const allocation = requireCaptureAllocation(capture);
  const amountMinor = deriveStoreReceivableMinor(allocation);
  if (amountMinor === 0) return null;

  return baseObligation({
    capture,
    id: buildStoreReceivableObligationId(capture.paymentId),
    kind: 'store_receivable',
    amountMinor,
    beneficiaryType: 'store',
    beneficiaryPrincipalId: `store:${capture.storeId}`,
    fulfillmentId: '',
    funding: storeFundingSnapshot(allocation, amountMinor),
  });
};

export const buildCourierPayableObligationFromCapture = (input: {
  capture: StoreEconomicLedgerEntry;
  fulfillmentId: string;
  courierUserId: string;
}): EconomicObligation | null => {
  const allocation = requireCaptureAllocation(input.capture);
  const fulfillmentId = clean(input.fulfillmentId);
  const courierUserId = clean(input.courierUserId);
  if (!fulfillmentId || fulfillmentId.includes('/') || !courierUserId || courierUserId.includes('/')) {
    throw new Error('ECONOMIC_OBLIGATION_COURIER_IDENTITY_REQUIRED');
  }

  const amountMinor = nonNegativeMinor(
    allocation.courierRemunerationMinor,
    'COURIER_REMUNERATION'
  );
  if (amountMinor === 0) return null;
  if (amountMinor !== allocation.deliveryFeeMinor) {
    throw new Error('ECONOMIC_OBLIGATION_COURIER_ALLOCATION_MISMATCH');
  }

  return baseObligation({
    capture: input.capture,
    id: buildCourierPayableObligationId({
      paymentId: input.capture.paymentId,
      fulfillmentId,
      courierUserId,
    }),
    kind: 'courier_payable',
    amountMinor,
    beneficiaryType: 'courier',
    beneficiaryPrincipalId: courierUserId,
    fulfillmentId,
    funding: {
      customerMinor: amountMinor,
      kyrubMinor: 0,
      partnerMinor: 0,
      storeFundedDiscountMinor: 0,
    },
  });
};

export const canTransitionEconomicObligationStatus = (
  from: EconomicObligationStatus,
  to: EconomicObligationStatus
): boolean => {
  if (from === to) return true;
  if (from === 'pending') return to === 'eligible' || to === 'reversed';
  if (from === 'eligible') return to === 'settled' || to === 'reversed';
  return false;
};
