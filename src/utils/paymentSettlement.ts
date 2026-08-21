export type SettlementRecipientType = 'merchant' | 'kyrub' | 'courier' | 'government';
export type SettlementEntryStatus = 'blocked' | 'payable' | 'settled';

export interface SettlementEntry {
  recipientType: SettlementRecipientType;
  recipientId: string;
  amount: number;
  status: SettlementEntryStatus;
}

export interface CanonicalSettlementPlan {
  paymentId: string;
  orderId: string;
  grossAmount: number;
  currency: 'BRL';
  entries: SettlementEntry[];
}

export const normalizeSettlementPlan = (
  input: CanonicalSettlementPlan
): CanonicalSettlementPlan => {
  if (!Number.isFinite(input.grossAmount) || input.grossAmount <= 0) {
    throw new Error('SETTLEMENT_GROSS_AMOUNT_INVALID');
  }
  if (!input.paymentId.trim() || !input.orderId.trim()) {
    throw new Error('SETTLEMENT_IDENTITY_REQUIRED');
  }
  if (!input.entries.length) throw new Error('SETTLEMENT_ENTRIES_REQUIRED');

  const entries = input.entries.map(entry => {
    if (!Number.isFinite(entry.amount) || entry.amount < 0) {
      throw new Error('SETTLEMENT_ENTRY_AMOUNT_INVALID');
    }
    if (!entry.recipientId.trim()) throw new Error('SETTLEMENT_RECIPIENT_REQUIRED');
    return { ...entry, amount: Number(entry.amount.toFixed(2)) };
  });

  const distributed = Number(entries.reduce((sum, entry) => sum + entry.amount, 0).toFixed(2));
  const grossAmount = Number(input.grossAmount.toFixed(2));
  if (distributed > grossAmount) {
    throw new Error('SETTLEMENT_EXCEEDS_GROSS_AMOUNT');
  }

  return {
    paymentId: input.paymentId.trim(),
    orderId: input.orderId.trim(),
    grossAmount,
    currency: 'BRL',
    entries,
  };
};

export const applyCourierCompletionToSettlement = (input: {
  plan: CanonicalSettlementPlan;
  deliveryCompleted: boolean;
}): CanonicalSettlementPlan => {
  const plan = normalizeSettlementPlan(input.plan);
  return {
    ...plan,
    entries: plan.entries.map(entry =>
      entry.recipientType === 'courier' && entry.status !== 'settled'
        ? { ...entry, status: input.deliveryCompleted ? 'payable' : 'blocked' }
        : entry
    ),
  };
};

export const isCourierSettlementPayable = (
  plan: CanonicalSettlementPlan
): boolean =>
  normalizeSettlementPlan(plan).entries.some(
    entry => entry.recipientType === 'courier' && entry.status === 'payable'
  );
