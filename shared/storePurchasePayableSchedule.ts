export type StorePurchasePayableStatus = 'open' | 'paid' | 'cancelled';

export type StorePurchasePayableScheduleEntry = {
  purchasePayableKey?: string;
  amountMinor: number;
  status: StorePurchasePayableStatus;
};

const INSTALLMENT_KEY_PATTERN = /^installment_(\d{3})$/;

export const storePurchasePayableKeyLabel = (keyInput: string): string => {
  const key = keyInput.trim();
  if (key === 'primary') return 'Parcela 1';
  const match = INSTALLMENT_KEY_PATTERN.exec(key);
  if (!match) return key || 'Obrigação';
  return `Parcela ${Number(match[1])}`;
};

export const nextStorePurchasePayableKey = (keysInput: string[]): string => {
  const keys = new Set(keysInput.map(key => key.trim()).filter(Boolean));
  if (!keys.has('primary')) return 'primary';

  let highest = 1;
  keys.forEach(key => {
    const match = INSTALLMENT_KEY_PATTERN.exec(key);
    if (!match) return;
    highest = Math.max(highest, Number(match[1]));
  });

  const next = highest + 1;
  if (next > 999) throw new Error('STORE_FINANCE_PAYABLE_INSTALLMENT_LIMIT_REACHED');
  return `installment_${String(next).padStart(3, '0')}`;
};

export const summarizeStorePurchasePayables = (
  entries: StorePurchasePayableScheduleEntry[],
  estimatedPurchaseTotalMinor: number | null
): {
  registeredMinor: number;
  activeMinor: number;
  paidMinor: number;
  openMinor: number;
  cancelledMinor: number;
  differenceMinor: number | null;
} => {
  const validAmount = (value: number): number =>
    Number.isSafeInteger(value) && value > 0 ? value : 0;

  const registeredMinor = entries.reduce(
    (total, entry) => total + validAmount(entry.amountMinor),
    0
  );
  const activeMinor = entries.reduce(
    (total, entry) => entry.status === 'cancelled'
      ? total
      : total + validAmount(entry.amountMinor),
    0
  );
  const paidMinor = entries.reduce(
    (total, entry) => entry.status === 'paid'
      ? total + validAmount(entry.amountMinor)
      : total,
    0
  );
  const openMinor = entries.reduce(
    (total, entry) => entry.status === 'open'
      ? total + validAmount(entry.amountMinor)
      : total,
    0
  );
  const cancelledMinor = entries.reduce(
    (total, entry) => entry.status === 'cancelled'
      ? total + validAmount(entry.amountMinor)
      : total,
    0
  );

  const differenceMinor = Number.isSafeInteger(estimatedPurchaseTotalMinor)
    && Number(estimatedPurchaseTotalMinor) > 0
      ? Number(estimatedPurchaseTotalMinor) - activeMinor
      : null;

  return {
    registeredMinor,
    activeMinor,
    paidMinor,
    openMinor,
    cancelledMinor,
    differenceMinor,
  };
};
