import { createHash } from 'node:crypto';
import type {
  KyrubPaymentAllocation,
  KyrubPaymentParticipantRole,
  KyrubPaymentTransaction,
} from '../../shared/kyrubPaymentAllocations.js';
import { canKyrubFinancialProfileReceive, type KyrubFinancialProfile } from '../../shared/kyrubFinancialProfile.js';

const clean = (value: unknown, maximum = 180): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

const positiveMinor = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error('PAYMENT_ALLOCATION_AMOUNT_INVALID');
  }
  return Number(value);
};

export const buildKyrubPaymentTransaction = (input: {
  payerUserId: string;
  purpose: string;
  amountMinor: number;
  correlationId: string;
  allocations: Array<{
    recipientUserId: string;
    role: KyrubPaymentParticipantRole;
    amountMinor: number;
  }>;
  recipientProfiles: KyrubFinancialProfile[];
}): KyrubPaymentTransaction => {
  const payerUserId = clean(input.payerUserId);
  const purpose = clean(input.purpose, 120);
  const correlationId = clean(input.correlationId, 160);
  const amountMinor = positiveMinor(input.amountMinor);
  if (!payerUserId || !purpose || !correlationId) {
    throw new Error('PAYMENT_TRANSACTION_IDENTITY_INVALID');
  }
  if (input.allocations.length < 1 || input.allocations.length > 50) {
    throw new Error('PAYMENT_ALLOCATION_COUNT_INVALID');
  }

  const profilesByUser = new Map(
    input.recipientProfiles.map(profile => [profile.userId, profile])
  );
  const allocations: KyrubPaymentAllocation[] = input.allocations.map((allocation, index) => {
    const recipientUserId = clean(allocation.recipientUserId);
    if (!recipientUserId) throw new Error('PAYMENT_ALLOCATION_RECIPIENT_REQUIRED');
    const profile = profilesByUser.get(recipientUserId);
    if (!profile || !canKyrubFinancialProfileReceive(profile)) {
      throw new Error(`PAYMENT_RECIPIENT_NOT_ELIGIBLE:${recipientUserId}`);
    }
    const allocatedMinor = positiveMinor(allocation.amountMinor);
    const allocationId = `alloc_${createHash('sha256')
      .update(`${correlationId}:${recipientUserId}:${allocation.role}:${index}:${allocatedMinor}`)
      .digest('hex')
      .slice(0, 32)}`;
    return {
      allocationId,
      recipientUserId,
      role: allocation.role,
      amountMinor: allocatedMinor,
      status: 'pending',
    };
  });

  const sum = allocations.reduce((total, allocation) => total + allocation.amountMinor, 0);
  if (!Number.isSafeInteger(sum) || sum !== amountMinor) {
    throw new Error(`PAYMENT_ALLOCATION_SUM_MISMATCH:${sum}:${amountMinor}`);
  }

  const transactionId = `txn_${createHash('sha256')
    .update(`${payerUserId}:${purpose}:${amountMinor}:${correlationId}:${allocations.map(item => item.allocationId).join(',')}`)
    .digest('hex')
    .slice(0, 40)}`;

  return {
    schemaVersion: 1,
    transactionId,
    payerUserId,
    purpose,
    currency: 'BRL',
    amountMinor,
    allocations,
    correlationId,
  };
};

export const replacePendingKyrubRecipient = (input: {
  transaction: KyrubPaymentTransaction;
  allocationId: string;
  recipientProfile: KyrubFinancialProfile;
}): KyrubPaymentTransaction => {
  if (!canKyrubFinancialProfileReceive(input.recipientProfile)) {
    throw new Error('PAYMENT_RECIPIENT_NOT_ELIGIBLE');
  }
  let found = false;
  const allocations = input.transaction.allocations.map(allocation => {
    if (allocation.allocationId !== input.allocationId) return allocation;
    found = true;
    if (allocation.status !== 'pending') {
      throw new Error('PAYMENT_ALLOCATION_RECIPIENT_LOCKED');
    }
    return { ...allocation, recipientUserId: input.recipientProfile.userId };
  });
  if (!found) throw new Error('PAYMENT_ALLOCATION_NOT_FOUND');
  return { ...input.transaction, allocations };
};
