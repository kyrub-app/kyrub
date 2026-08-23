import type { KyrubPaymentAllocation, KyrubPaymentTransaction } from '../../shared/kyrubPaymentAllocations.js';

export type KyrubSettlementRail = 'mercado_pago_1_1' | 'mercado_pago_1_n' | 'pagbank' | 'pagarme' | 'manual_external';
export type KyrubSettlementStatus = 'planned' | 'submitted' | 'settled' | 'failed' | 'reversed';

export interface KyrubSettlementInstruction {
  transactionId: string;
  allocationId: string;
  recipientUserId: string;
  role: KyrubPaymentAllocation['role'];
  amountMinor: number;
  rail: KyrubSettlementRail;
  status: KyrubSettlementStatus;
  correlationId: string;
}

export interface KyrubDeliveryObligation {
  transactionId: string;
  allocationId: string;
  courierUserId: string;
  amountMinor: number;
  status: 'owed' | 'settled' | 'reversed';
  correlationId: string;
}

export const buildSettlementInstructions = (input: {
  transaction: KyrubPaymentTransaction;
  rail: KyrubSettlementRail;
}): KyrubSettlementInstruction[] => input.transaction.allocations.map(allocation => ({
  transactionId: input.transaction.transactionId,
  allocationId: allocation.allocationId,
  recipientUserId: allocation.recipientUserId,
  role: allocation.role,
  amountMinor: allocation.amountMinor,
  rail: input.rail,
  status: allocation.status === 'reversed' ? 'reversed' : 'planned',
  correlationId: input.transaction.correlationId,
}));

export const buildCourierObligations = (transaction: KyrubPaymentTransaction): KyrubDeliveryObligation[] =>
  transaction.allocations
    .filter(allocation => allocation.role === 'courier')
    .map(allocation => ({
      transactionId: transaction.transactionId,
      allocationId: allocation.allocationId,
      courierUserId: allocation.recipientUserId,
      amountMinor: allocation.amountMinor,
      status: allocation.status === 'reversed' ? 'reversed' : allocation.status === 'settled' ? 'settled' : 'owed',
      correlationId: transaction.correlationId,
    }));

export const assertAllocationIsNotSettlement = (allocation: KyrubPaymentAllocation): true => {
  if (allocation.status === 'settled') return true;
  return true;
};
