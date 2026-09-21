export interface LocalOrderPayableSummary {
  billableAmount: number;
  openAmount: number;
  operationalPaidAmount: number;
  transferredAmount: number;
  hasOperationalPaidQuantity: boolean;
}

const money = (value: number): number => Number(value.toFixed(2));

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const quantity = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;

export const summarizeLocalOrderPayable = (
  value: unknown
): LocalOrderPayableSummary => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('LOCAL_ORDER_PAYABLE_ORDER_INVALID');
  }
  const items = (value as Record<string, unknown>).items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('LOCAL_ORDER_PAYABLE_ITEMS_REQUIRED');
  }

  let billableAmount = 0;
  let openAmount = 0;
  let operationalPaidAmount = 0;
  let transferredAmount = 0;
  let hasOperationalPaidQuantity = false;

  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('LOCAL_ORDER_PAYABLE_ITEM_INVALID');
    }
    const line = item as Record<string, unknown>;
    const price = finite(line.price);
    const ordered = quantity(line.quantity);
    const paid = quantity(line.paidQuantity ?? 0);
    const transferred = quantity(line.transferredQuantity ?? 0);
    const voided = quantity(line.voidedQuantity ?? 0);
    const settledAmount = finite(line.settledAmount ?? 0);
    const discountAmount = finite(line.discountAmount ?? 0);
    if (
      price === null ||
      price < 0 ||
      ordered === null ||
      ordered <= 0 ||
      paid === null ||
      transferred === null ||
      voided === null ||
      settledAmount === null || settledAmount < 0 ||
      discountAmount === null || discountAmount < 0 ||
      paid + transferred + voided > ordered
    ) {
      throw new Error('LOCAL_ORDER_PAYABLE_ITEM_INVALID');
    }

    const billableQuantity = ordered - transferred - voided;
    const grossBillableAmount = billableQuantity * price;
    const legacyPaidAmount = paid * price;
    const netBillableAmount = Math.max(0, grossBillableAmount - discountAmount);
    const lineOpenAmount = Math.max(0, netBillableAmount - legacyPaidAmount - settledAmount);
    billableAmount += netBillableAmount;
    openAmount += lineOpenAmount;
    operationalPaidAmount += legacyPaidAmount + settledAmount;
    transferredAmount += transferred * price;
    hasOperationalPaidQuantity ||= paid > 0 || settledAmount > 0;
  }

  return {
    billableAmount: money(billableAmount),
    openAmount: money(openAmount),
    operationalPaidAmount: money(operationalPaidAmount),
    transferredAmount: money(transferredAmount),
    hasOperationalPaidQuantity,
  };
};
