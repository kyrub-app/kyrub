export const STORE_FINANCE_PAYABLE_SCHEMA_VERSION = 1 as const;
export const STORE_FINANCE_PAYABLE_CURRENCY = 'BRL' as const;

export type StoreFinancePayableStatus = 'open' | 'paid' | 'cancelled';
export type StoreFinancePayableCategory =
  | 'supplier'
  | 'inventory'
  | 'rent'
  | 'utilities'
  | 'tax'
  | 'service'
  | 'payroll'
  | 'other';
export type StoreFinancePayableRecurrence = 'none' | 'monthly';
export type StoreFinancePayableCostNature = 'unspecified' | 'fixed' | 'variable';
export type StoreFinancePayableBillingDocumentType = 'none' | 'boleto' | 'invoice' | 'other';
export type StoreFinancePayableSourceAuthority =
  | 'store_owner_manual'
  | 'payroll_compensation_snapshot'
  | 'store_purchase';

export interface StoreFinancePayable {
  schemaVersion: typeof STORE_FINANCE_PAYABLE_SCHEMA_VERSION;
  id: string;
  storeId: string;
  status: StoreFinancePayableStatus;
  currency: typeof STORE_FINANCE_PAYABLE_CURRENCY;
  amountMinor: number;
  description: string;
  category: StoreFinancePayableCategory;
  counterparty: string;
  dueDate: string;
  recurrence: StoreFinancePayableRecurrence;
  costNature: StoreFinancePayableCostNature;
  billingDocumentType: StoreFinancePayableBillingDocumentType;
  billingDocumentReference: string;
  billingDigitableLine: string;
  billingBarcode: string;
  sourceAuthority: StoreFinancePayableSourceAuthority;
  purchaseId: string;
  supplierId: string;
  purchasePayableKey: string;
  teamStoreId: string;
  teamMemberUserId: string;
  payrollPeriod: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string;
  cancelledAt: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validIso = (value: string): boolean =>
  Boolean(value) && Number.isFinite(Date.parse(value));

const validDateOnly = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T12:00:00.000Z`);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString().slice(0, 10) === value;
};

const validPayrollPeriod = (value: string): boolean =>
  /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value);

const validPathId = (value: string): boolean =>
  Boolean(value) && value.length <= 240 && value !== '.' && value !== '..' && !value.includes('/');

const isStatus = (value: unknown): value is StoreFinancePayableStatus =>
  value === 'open' || value === 'paid' || value === 'cancelled';

const isCategory = (value: unknown): value is StoreFinancePayableCategory =>
  value === 'supplier'
  || value === 'inventory'
  || value === 'rent'
  || value === 'utilities'
  || value === 'tax'
  || value === 'service'
  || value === 'payroll'
  || value === 'other';

const isRecurrence = (value: unknown): value is StoreFinancePayableRecurrence =>
  value === 'none' || value === 'monthly';

const isCostNature = (value: unknown): value is StoreFinancePayableCostNature =>
  value === 'unspecified' || value === 'fixed' || value === 'variable';

const isBillingDocumentType = (value: unknown): value is StoreFinancePayableBillingDocumentType =>
  value === 'none' || value === 'boleto' || value === 'invoice' || value === 'other';

const isSourceAuthority = (value: unknown): value is StoreFinancePayableSourceAuthority =>
  value === 'store_owner_manual'
  || value === 'payroll_compensation_snapshot'
  || value === 'store_purchase';

const positiveMinor = (value: unknown): number => {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('STORE_FINANCE_PAYABLE_AMOUNT_INVALID');
  }
  return amount;
};

const requiredText = (value: unknown, label: string, maxLength: number): string => {
  const text = clean(value);
  if (!text || text.length > maxLength) {
    throw new Error(`STORE_FINANCE_PAYABLE_${label}_INVALID`);
  }
  return text;
};

const optionalText = (value: unknown, label: string, maxLength: number): string => {
  const text = clean(value);
  if (text.length > maxLength) {
    throw new Error(`STORE_FINANCE_PAYABLE_${label}_INVALID`);
  }
  return text;
};

export const normalizeStoreFinancePayable = (value: unknown): StoreFinancePayable => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('STORE_FINANCE_PAYABLE_INVALID');
  }
  const source = value as Partial<StoreFinancePayable>;
  const id = requiredText(source.id, 'ID', 240);
  const storeId = requiredText(source.storeId, 'STORE', 240);
  const description = requiredText(source.description, 'DESCRIPTION', 160);
  const counterparty = optionalText(source.counterparty, 'COUNTERPARTY', 120);
  const costNature = source.costNature === undefined ? 'unspecified' : source.costNature;
  const billingDocumentType = source.billingDocumentType === undefined ? 'none' : source.billingDocumentType;
  const billingDocumentReference = optionalText(source.billingDocumentReference, 'BILLING_DOCUMENT_REFERENCE', 500);
  const billingDigitableLine = optionalText(source.billingDigitableLine, 'BILLING_DIGITABLE_LINE', 220);
  const billingBarcode = optionalText(source.billingBarcode, 'BILLING_BARCODE', 220);
  const purchaseId = optionalText(source.purchaseId, 'PURCHASE_ID', 240);
  const supplierId = optionalText(source.supplierId, 'SUPPLIER_ID', 240);
  const purchasePayableKey = optionalText(source.purchasePayableKey, 'PURCHASE_PAYABLE_KEY', 120);
  const teamStoreId = optionalText(source.teamStoreId, 'TEAM_STORE', 240);
  const teamMemberUserId = optionalText(source.teamMemberUserId, 'TEAM_MEMBER', 240);
  const payrollPeriod = optionalText(source.payrollPeriod, 'PAYROLL_PERIOD', 7);
  const createdByUserId = requiredText(source.createdByUserId, 'CREATED_BY', 240);
  const createdAt = clean(source.createdAt);
  const updatedAt = clean(source.updatedAt);
  const dueDate = clean(source.dueDate);
  const paidAt = clean(source.paidAt);
  const cancelledAt = clean(source.cancelledAt);

  if (
    source.schemaVersion !== STORE_FINANCE_PAYABLE_SCHEMA_VERSION
    || !validPathId(id)
    || storeId.includes('/')
    || source.currency !== STORE_FINANCE_PAYABLE_CURRENCY
    || !isStatus(source.status)
    || !isCategory(source.category)
    || !isRecurrence(source.recurrence)
    || !isCostNature(costNature)
    || !isBillingDocumentType(billingDocumentType)
    || !isSourceAuthority(source.sourceAuthority)
    || !validDateOnly(dueDate)
    || !validIso(createdAt)
    || !validIso(updatedAt)
  ) {
    throw new Error('STORE_FINANCE_PAYABLE_INVALID');
  }

  if (billingDocumentType !== 'boleto' && (billingDigitableLine || billingBarcode)) {
    throw new Error('STORE_FINANCE_PAYABLE_BILLING_DOCUMENT_SCOPE_INVALID');
  }
  if (billingDocumentType === 'none' && billingDocumentReference) {
    throw new Error('STORE_FINANCE_PAYABLE_BILLING_DOCUMENT_SCOPE_INVALID');
  }

  if (source.sourceAuthority === 'store_owner_manual') {
    if (
      source.category === 'payroll'
      || teamStoreId
      || teamMemberUserId
      || payrollPeriod
      || purchaseId
      || supplierId
      || purchasePayableKey
    ) {
      throw new Error('STORE_FINANCE_PAYABLE_MANUAL_SCOPE_INVALID');
    }
  } else if (source.sourceAuthority === 'payroll_compensation_snapshot') {
    if (
      source.category !== 'payroll'
      || source.recurrence !== 'none'
      || !validPathId(teamStoreId)
      || !validPathId(teamMemberUserId)
      || !validPayrollPeriod(payrollPeriod)
      || purchaseId
      || supplierId
      || purchasePayableKey
      || billingDocumentType !== 'none'
    ) {
      throw new Error('STORE_FINANCE_PAYABLE_PAYROLL_SCOPE_INVALID');
    }
  } else {
    if (
      (source.category !== 'supplier' && source.category !== 'inventory')
      || source.recurrence !== 'none'
      || !validPathId(purchaseId)
      || !validPathId(supplierId)
      || !validPathId(purchasePayableKey)
      || teamStoreId
      || teamMemberUserId
      || payrollPeriod
    ) {
      throw new Error('STORE_FINANCE_PAYABLE_PURCHASE_SCOPE_INVALID');
    }
  }

  if (source.status === 'open' && (paidAt || cancelledAt)) {
    throw new Error('STORE_FINANCE_PAYABLE_STATUS_TIMESTAMPS_INVALID');
  }
  if (source.status === 'paid' && (!validIso(paidAt) || cancelledAt)) {
    throw new Error('STORE_FINANCE_PAYABLE_STATUS_TIMESTAMPS_INVALID');
  }
  if (source.status === 'cancelled' && (!validIso(cancelledAt) || paidAt)) {
    throw new Error('STORE_FINANCE_PAYABLE_STATUS_TIMESTAMPS_INVALID');
  }

  return {
    schemaVersion: STORE_FINANCE_PAYABLE_SCHEMA_VERSION,
    id,
    storeId,
    status: source.status,
    currency: STORE_FINANCE_PAYABLE_CURRENCY,
    amountMinor: positiveMinor(source.amountMinor),
    description,
    category: source.category,
    counterparty,
    dueDate,
    recurrence: source.recurrence,
    costNature,
    billingDocumentType,
    billingDocumentReference,
    billingDigitableLine,
    billingBarcode,
    sourceAuthority: source.sourceAuthority,
    purchaseId,
    supplierId,
    purchasePayableKey,
    teamStoreId,
    teamMemberUserId,
    payrollPeriod,
    createdByUserId,
    createdAt,
    updatedAt,
    paidAt,
    cancelledAt,
  };
};

export const buildManualStoreFinancePayable = (input: {
  id: string;
  storeId: string;
  amountMinor: number;
  description: string;
  category: StoreFinancePayableCategory;
  counterparty?: string;
  dueDate: string;
  recurrence: StoreFinancePayableRecurrence;
  costNature?: StoreFinancePayableCostNature;
  billingDocumentType?: StoreFinancePayableBillingDocumentType;
  billingDocumentReference?: string;
  billingDigitableLine?: string;
  billingBarcode?: string;
  createdByUserId: string;
  now?: string;
}): StoreFinancePayable => {
  if (input.category === 'payroll') {
    throw new Error('STORE_FINANCE_PAYABLE_MANUAL_SCOPE_INVALID');
  }
  const now = clean(input.now) || new Date().toISOString();
  return normalizeStoreFinancePayable({
    schemaVersion: STORE_FINANCE_PAYABLE_SCHEMA_VERSION,
    id: input.id,
    storeId: input.storeId,
    status: 'open',
    currency: STORE_FINANCE_PAYABLE_CURRENCY,
    amountMinor: input.amountMinor,
    description: input.description,
    category: input.category,
    counterparty: input.counterparty ?? '',
    dueDate: input.dueDate,
    recurrence: input.recurrence,
    costNature: input.costNature ?? 'unspecified',
    billingDocumentType: input.billingDocumentType ?? 'none',
    billingDocumentReference: input.billingDocumentReference ?? '',
    billingDigitableLine: input.billingDigitableLine ?? '',
    billingBarcode: input.billingBarcode ?? '',
    sourceAuthority: 'store_owner_manual',
    purchaseId: '',
    supplierId: '',
    purchasePayableKey: '',
    teamStoreId: '',
    teamMemberUserId: '',
    payrollPeriod: '',
    createdByUserId: input.createdByUserId,
    createdAt: now,
    updatedAt: now,
    paidAt: '',
    cancelledAt: '',
  });
};

export const buildStorePurchaseFinancePayable = (input: {
  id: string;
  storeId: string;
  purchaseId: string;
  supplierId: string;
  purchasePayableKey: string;
  amountMinor: number;
  supplierDisplayName: string;
  dueDate: string;
  costNature?: StoreFinancePayableCostNature;
  billingDocumentType?: StoreFinancePayableBillingDocumentType;
  billingDocumentReference?: string;
  billingDigitableLine?: string;
  billingBarcode?: string;
  createdByUserId: string;
  now?: string;
}): StoreFinancePayable => {
  const now = clean(input.now) || new Date().toISOString();
  return normalizeStoreFinancePayable({
    schemaVersion: STORE_FINANCE_PAYABLE_SCHEMA_VERSION,
    id: input.id,
    storeId: input.storeId,
    status: 'open',
    currency: STORE_FINANCE_PAYABLE_CURRENCY,
    amountMinor: input.amountMinor,
    description: `Compra ${input.purchaseId} — ${input.supplierDisplayName}`,
    category: 'inventory',
    counterparty: input.supplierDisplayName,
    dueDate: input.dueDate,
    recurrence: 'none',
    costNature: input.costNature ?? 'unspecified',
    billingDocumentType: input.billingDocumentType ?? 'none',
    billingDocumentReference: input.billingDocumentReference ?? '',
    billingDigitableLine: input.billingDigitableLine ?? '',
    billingBarcode: input.billingBarcode ?? '',
    sourceAuthority: 'store_purchase',
    purchaseId: input.purchaseId,
    supplierId: input.supplierId,
    purchasePayableKey: input.purchasePayableKey,
    teamStoreId: '',
    teamMemberUserId: '',
    payrollPeriod: '',
    createdByUserId: input.createdByUserId,
    createdAt: now,
    updatedAt: now,
    paidAt: '',
    cancelledAt: '',
  });
};

export const buildPayrollStoreFinancePayable = (input: {
  id: string;
  storeId: string;
  teamStoreId: string;
  teamMemberUserId: string;
  payrollPeriod: string;
  amountMinor: number;
  memberDisplayName: string;
  dueDate: string;
  createdByUserId: string;
  now?: string;
}): StoreFinancePayable => {
  const now = clean(input.now) || new Date().toISOString();
  return normalizeStoreFinancePayable({
    schemaVersion: STORE_FINANCE_PAYABLE_SCHEMA_VERSION,
    id: input.id,
    storeId: input.storeId,
    status: 'open',
    currency: STORE_FINANCE_PAYABLE_CURRENCY,
    amountMinor: input.amountMinor,
    description: `Remuneração ${input.payrollPeriod} — ${input.memberDisplayName}`,
    category: 'payroll',
    counterparty: input.memberDisplayName,
    dueDate: input.dueDate,
    recurrence: 'none',
    costNature: 'unspecified',
    billingDocumentType: 'none',
    billingDocumentReference: '',
    billingDigitableLine: '',
    billingBarcode: '',
    sourceAuthority: 'payroll_compensation_snapshot',
    purchaseId: '',
    supplierId: '',
    purchasePayableKey: '',
    teamStoreId: input.teamStoreId,
    teamMemberUserId: input.teamMemberUserId,
    payrollPeriod: input.payrollPeriod,
    createdByUserId: input.createdByUserId,
    createdAt: now,
    updatedAt: now,
    paidAt: '',
    cancelledAt: '',
  });
};

export const buildPayrollStoreFinancePayableId = (input: {
  payrollPeriod: string;
  teamMemberUserId: string;
}): string => {
  const payrollPeriod = clean(input.payrollPeriod);
  const teamMemberUserId = clean(input.teamMemberUserId);
  if (!validPayrollPeriod(payrollPeriod) || !validPathId(teamMemberUserId)) {
    throw new Error('STORE_FINANCE_PAYABLE_PAYROLL_ID_INVALID');
  }
  const id = `payroll_${payrollPeriod.replace('-', '')}_${teamMemberUserId}`;
  if (!validPathId(id)) throw new Error('STORE_FINANCE_PAYABLE_PAYROLL_ID_INVALID');
  return id;
};

export const storeFinancePayablePath = (
  storeIdInput: string,
  payableIdInput: string
): string => {
  const storeId = clean(storeIdInput);
  const payableId = clean(payableIdInput);
  if (!storeId || storeId.includes('/') || !validPathId(payableId)) {
    throw new Error('STORE_FINANCE_PAYABLE_PATH_INVALID');
  }
  return `stores/${storeId}/financePayables/${encodeURIComponent(payableId)}`;
};

export const canTransitionStoreFinancePayableStatus = (
  from: StoreFinancePayableStatus,
  to: StoreFinancePayableStatus
): boolean => {
  if (from === to) return true;
  return from === 'open' && (to === 'paid' || to === 'cancelled');
};