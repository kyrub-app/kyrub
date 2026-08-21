export const KYRUB_PAYMENT_ALLOCATION_SCHEMA_VERSION = 1 as const;

export type KyrubPaymentParticipantRole =
  | 'merchant'
  | 'platform'
  | 'courier'
  | 'freelancer'
  | 'affiliate'
  | 'provider'
  | 'other';

export type KyrubPaymentAllocationStatus =
  | 'pending'
  | 'locked'
  | 'settled'
  | 'reversed';

export type KyrubPaymentAllocation = {
  allocationId: string;
  recipientUserId: string;
  role: KyrubPaymentParticipantRole;
  amountMinor: number;
  status: KyrubPaymentAllocationStatus;
};

export type KyrubPaymentTransaction = {
  schemaVersion: typeof KYRUB_PAYMENT_ALLOCATION_SCHEMA_VERSION;
  transactionId: string;
  payerUserId: string;
  purpose: string;
  currency: 'BRL';
  amountMinor: number;
  allocations: KyrubPaymentAllocation[];
  correlationId: string;
};
