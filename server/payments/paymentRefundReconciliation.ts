import type {
  KyrubPaymentAllocation,
  KyrubPaymentTransaction,
} from '../../shared/kyrubPaymentAllocations.js';

export type KyrubRefundKind = 'full' | 'partial';

export interface KyrubRefundAllocation {
  allocationId: string;
  recipientUserId: string;
  role: KyrubPaymentAllocation['role'];
  originalAmountMinor: number;
  refundAmountMinor: number;
}

export interface KyrubRefundPlan {
  kind: KyrubRefundKind;
  transactionId: string;
  refundAmountMinor: number;
  allocations: KyrubRefundAllocation[];
  correlationId: string;
}

const positiveMinor = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label}_INVALID`);
  }
  return value;
};

export const buildKyrubRefundPlan = (input: {
  transaction: KyrubPaymentTransaction;
  refundAmountMinor: number;
  correlationId: string;
}): KyrubRefundPlan => {
  const total = positiveMinor(input.transaction.amountMinor, 'PAYMENT_AMOUNT');
  const refund = positiveMinor(input.refundAmountMinor, 'REFUND_AMOUNT');
  if (refund > total) throw new Error('REFUND_EXCEEDS_PAYMENT');
  const correlationId = input.correlationId.trim();
  if (!correlationId) throw new Error('REFUND_CORRELATION_REQUIRED');

  const eligible = input.transaction.allocations.filter(allocation => allocation.status !== 'reversed');
  if (eligible.length === 0) throw new Error('REFUND_NO_ELIGIBLE_ALLOCATIONS');
  const allocationTotal = eligible.reduce((sum, allocation) => sum + allocation.amountMinor, 0);
  if (allocationTotal !== total) throw new Error('REFUND_ALLOCATION_TOTAL_MISMATCH');

  let assigned = 0;
  const allocations = eligible.map((allocation, index): KyrubRefundAllocation => {
    const isLast = index === eligible.length - 1;
    const proportional = isLast
      ? refund - assigned
      : Math.floor((refund * allocation.amountMinor) / total);
    assigned += proportional;
    return {
      allocationId: allocation.allocationId,
      recipientUserId: allocation.recipientUserId,
      role: allocation.role,
      originalAmountMinor: allocation.amountMinor,
      refundAmountMinor: proportional,
    };
  }).filter(allocation => allocation.refundAmountMinor > 0);

  const plannedTotal = allocations.reduce((sum, allocation) => sum + allocation.refundAmountMinor, 0);
  if (plannedTotal !== refund) throw new Error('REFUND_PLAN_TOTAL_MISMATCH');

  return {
    kind: refund === total ? 'full' : 'partial',
    transactionId: input.transaction.transactionId,
    refundAmountMinor: refund,
    allocations,
    correlationId,
  };
};
