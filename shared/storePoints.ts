export const STORE_POINTS_CURRENCY = 'store_points' as const;
export const STORE_POINTS_LEDGER_SCHEMA_VERSION = 1 as const;

export type StorePointLedgerKind =
  | 'purchase_base'
  | 'bonus'
  | 'redemption'
  | 'reversal';

export interface StorePointPurchaseItemSnapshot {
  productId: string;
  productName: string;
  quantity: number;
  pointsPerUnit: number;
  pointsTotal: number;
}

export interface StorePointLedgerEntry {
  schemaVersion: typeof STORE_POINTS_LEDGER_SCHEMA_VERSION;
  id: string;
  idempotencyKey: string;
  currency: typeof STORE_POINTS_CURRENCY;
  kind: StorePointLedgerKind;
  storeId: string;
  customerId: string;
  amount: number;
  reason: string;
  correlationId: string;
  orderId: string;
  paymentId: string;
  paymentIntentId: string;
  occurredAt: string;
  purchaseItems: StorePointPurchaseItemSnapshot[];
  reversalOf: string;
}

export interface StorePointPurchaseSourceItem {
  productId: string;
  name: string;
  quantity: number;
  storePointsPerUnit?: number;
}

const required = (value: string, code: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
};

export const normalizeStorePointsPerUnit = (value: unknown): number => {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('STORE_POINTS_PER_UNIT_INVALID');
  }
  return value;
};

export const buildStorePointPurchaseEntryId = (paymentId: string): string =>
  `purchase_base:${required(paymentId, 'STORE_POINTS_PAYMENT_REQUIRED')}`;

export const buildStorePointPurchaseEntry = (input: {
  storeId: string;
  customerId: string;
  orderId: string;
  paymentId: string;
  paymentIntentId: string;
  occurredAt: string;
  items: StorePointPurchaseSourceItem[];
}): StorePointLedgerEntry | null => {
  const storeId = required(input.storeId, 'STORE_POINTS_STORE_REQUIRED');
  const customerId = required(input.customerId, 'STORE_POINTS_CUSTOMER_REQUIRED');
  const orderId = required(input.orderId, 'STORE_POINTS_ORDER_REQUIRED');
  const paymentId = required(input.paymentId, 'STORE_POINTS_PAYMENT_REQUIRED');
  const paymentIntentId = required(
    input.paymentIntentId,
    'STORE_POINTS_PAYMENT_INTENT_REQUIRED'
  );
  const occurredAt = required(input.occurredAt, 'STORE_POINTS_OCCURRED_AT_REQUIRED');

  const purchaseItems = input.items.flatMap(item => {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new Error('STORE_POINTS_ITEM_QUANTITY_INVALID');
    }
    const pointsPerUnit = normalizeStorePointsPerUnit(item.storePointsPerUnit);
    if (pointsPerUnit === 0) return [];
    const pointsTotal = pointsPerUnit * item.quantity;
    if (!Number.isSafeInteger(pointsTotal) || pointsTotal <= 0) {
      throw new Error('STORE_POINTS_ITEM_TOTAL_INVALID');
    }
    return [{
      productId: required(item.productId, 'STORE_POINTS_PRODUCT_REQUIRED'),
      productName: required(item.name, 'STORE_POINTS_PRODUCT_NAME_REQUIRED'),
      quantity: item.quantity,
      pointsPerUnit,
      pointsTotal,
    } satisfies StorePointPurchaseItemSnapshot];
  });

  const amount = purchaseItems.reduce((sum, item) => sum + item.pointsTotal, 0);
  if (amount === 0) return null;
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('STORE_POINTS_PURCHASE_TOTAL_INVALID');
  }

  const id = buildStorePointPurchaseEntryId(paymentId);
  return {
    schemaVersion: STORE_POINTS_LEDGER_SCHEMA_VERSION,
    id,
    idempotencyKey: id,
    currency: STORE_POINTS_CURRENCY,
    kind: 'purchase_base',
    storeId,
    customerId,
    amount,
    reason: 'purchase',
    correlationId: orderId,
    orderId,
    paymentId,
    paymentIntentId,
    occurredAt,
    purchaseItems,
    reversalOf: '',
  };
};

export const buildStorePointBonusEntry = (input: {
  bonusId: string;
  storeId: string;
  customerId: string;
  amount: number;
  reason: string;
  correlationId: string;
  occurredAt: string;
}): StorePointLedgerEntry => {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new Error('STORE_POINTS_BONUS_AMOUNT_INVALID');
  }
  const bonusId = required(input.bonusId, 'STORE_POINTS_BONUS_ID_REQUIRED');
  const id = `bonus:${bonusId}`;
  return {
    schemaVersion: STORE_POINTS_LEDGER_SCHEMA_VERSION,
    id,
    idempotencyKey: id,
    currency: STORE_POINTS_CURRENCY,
    kind: 'bonus',
    storeId: required(input.storeId, 'STORE_POINTS_STORE_REQUIRED'),
    customerId: required(input.customerId, 'STORE_POINTS_CUSTOMER_REQUIRED'),
    amount: input.amount,
    reason: required(input.reason, 'STORE_POINTS_REASON_REQUIRED'),
    correlationId: required(
      input.correlationId,
      'STORE_POINTS_CORRELATION_REQUIRED'
    ),
    orderId: '',
    paymentId: '',
    paymentIntentId: '',
    occurredAt: required(input.occurredAt, 'STORE_POINTS_OCCURRED_AT_REQUIRED'),
    purchaseItems: [],
    reversalOf: '',
  };
};

export const buildStorePointRedemptionEntry = (input: {
  redemptionId: string;
  rewardId: string;
  storeId: string;
  customerId: string;
  costPoints: number;
  occurredAt: string;
}): StorePointLedgerEntry => {
  if (!Number.isSafeInteger(input.costPoints) || input.costPoints <= 0) {
    throw new Error('STORE_POINTS_REDEMPTION_COST_INVALID');
  }
  const redemptionId = required(
    input.redemptionId,
    'STORE_POINTS_REDEMPTION_ID_REQUIRED'
  );
  const rewardId = required(input.rewardId, 'STORE_POINTS_REWARD_ID_REQUIRED');
  const id = `redemption:${redemptionId}`;
  return {
    schemaVersion: STORE_POINTS_LEDGER_SCHEMA_VERSION,
    id,
    idempotencyKey: id,
    currency: STORE_POINTS_CURRENCY,
    kind: 'redemption',
    storeId: required(input.storeId, 'STORE_POINTS_STORE_REQUIRED'),
    customerId: required(input.customerId, 'STORE_POINTS_CUSTOMER_REQUIRED'),
    amount: -input.costPoints,
    reason: `reward_redemption:${rewardId}`,
    correlationId: redemptionId,
    orderId: '',
    paymentId: '',
    paymentIntentId: '',
    occurredAt: required(input.occurredAt, 'STORE_POINTS_OCCURRED_AT_REQUIRED'),
    purchaseItems: [],
    reversalOf: '',
  };
};

export const buildStorePointReversalEntry = (input: {
  reversalId: string;
  original: StorePointLedgerEntry;
  amount?: number;
  reason: string;
  occurredAt: string;
}): StorePointLedgerEntry => {
  const originalAmount = Math.abs(input.original.amount);
  const requestedAmount = input.amount ?? originalAmount;
  if (
    input.original.kind === 'reversal' ||
    originalAmount === 0 ||
    !Number.isSafeInteger(requestedAmount) ||
    requestedAmount <= 0 ||
    requestedAmount > originalAmount
  ) {
    throw new Error('STORE_POINTS_REVERSAL_AMOUNT_INVALID');
  }
  const reversalId = required(
    input.reversalId,
    'STORE_POINTS_REVERSAL_ID_REQUIRED'
  );
  const id = `reversal:${reversalId}`;
  return {
    schemaVersion: STORE_POINTS_LEDGER_SCHEMA_VERSION,
    id,
    idempotencyKey: id,
    currency: STORE_POINTS_CURRENCY,
    kind: 'reversal',
    storeId: input.original.storeId,
    customerId: input.original.customerId,
    amount: input.original.amount > 0 ? -requestedAmount : requestedAmount,
    reason: required(input.reason, 'STORE_POINTS_REASON_REQUIRED'),
    correlationId: input.original.correlationId,
    orderId: input.original.orderId,
    paymentId: input.original.paymentId,
    paymentIntentId: input.original.paymentIntentId,
    occurredAt: required(input.occurredAt, 'STORE_POINTS_OCCURRED_AT_REQUIRED'),
    purchaseItems: [],
    reversalOf: input.original.id,
  };
};

export const deriveStorePointBalance = (
  entries: readonly Pick<StorePointLedgerEntry, 'amount'>[]
): number => {
  const balance = entries.reduce((sum, entry) => sum + entry.amount, 0);
  if (!Number.isSafeInteger(balance)) {
    throw new Error('STORE_POINTS_BALANCE_INVALID');
  }
  return balance;
};
