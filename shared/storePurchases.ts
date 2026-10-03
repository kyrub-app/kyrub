export const STORE_PROCUREMENT_SCHEMA_VERSION = 1 as const;
export const STORE_PURCHASE_CURRENCY = 'BRL' as const;

export type StoreSupplierStatus = 'active' | 'inactive';
export type StorePurchaseStatus =
  | 'draft'
  | 'ordered'
  | 'partially_received'
  | 'received'
  | 'cancelled';
export type StorePurchaseReceiptStatus = 'draft' | 'confirmed' | 'cancelled';
export type StorePurchaseSourceAuthority =
  | 'store_owner_manual'
  | 'kyrubia_assisted'
  | 'supplier_document';
export type StorePurchaseUnit =
  | 'un'
  | 'g'
  | 'kg'
  | 'ml'
  | 'l'
  | 'cx'
  | 'pct'
  | 'm'
  | 'cm';
export type StorePurchaseReceivingState =
  | 'not_started'
  | 'partially_received'
  | 'received';

export interface StoreSupplier {
  schemaVersion: typeof STORE_PROCUREMENT_SCHEMA_VERSION;
  id: string;
  storeId: string;
  displayName: string;
  status: StoreSupplierStatus;
  contactName: string;
  email: string;
  phone: string;
  notes: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface StorePurchaseLine {
  id: string;
  inventoryItemId: string;
  name: string;
  unit: StorePurchaseUnit;
  orderedQuantity: number;
  quotedUnitCostMinor: number | null;
}

export interface StorePurchase {
  schemaVersion: typeof STORE_PROCUREMENT_SCHEMA_VERSION;
  id: string;
  storeId: string;
  supplierId: string;
  status: StorePurchaseStatus;
  currency: typeof STORE_PURCHASE_CURRENCY;
  lines: StorePurchaseLine[];
  sourceAuthority: StorePurchaseSourceAuthority;
  sourceReference: string;
  createdByUserId: string;
  orderedAt: string;
  cancelledAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface StorePurchaseReceiptLine {
  purchaseLineId: string;
  inventoryItemId: string;
  unit: StorePurchaseUnit;
  receivedQuantity: number;
  documentedUnitCostMinor: number | null;
}

export interface StorePurchaseReceipt {
  schemaVersion: typeof STORE_PROCUREMENT_SCHEMA_VERSION;
  id: string;
  storeId: string;
  purchaseId: string;
  supplierId: string;
  status: StorePurchaseReceiptStatus;
  currency: typeof STORE_PURCHASE_CURRENCY;
  lines: StorePurchaseReceiptLine[];
  sourceAuthority: StorePurchaseSourceAuthority;
  sourceReference: string;
  createdByUserId: string;
  confirmedAt: string;
  cancelledAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface StorePurchaseReceivingLineProgress {
  purchaseLineId: string;
  inventoryItemId: string;
  unit: StorePurchaseUnit;
  orderedQuantity: number;
  receivedQuantity: number;
  remainingQuantity: number;
}

export interface StorePurchaseReceivingProgress {
  state: StorePurchaseReceivingState;
  confirmedReceiptCount: number;
  lines: StorePurchaseReceivingLineProgress[];
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validIso = (value: string): boolean =>
  Boolean(value) && Number.isFinite(Date.parse(value));

const validPathId = (value: string): boolean =>
  Boolean(value)
  && value.length <= 240
  && value !== '.'
  && value !== '..'
  && !value.includes('/');

const requiredPathId = (value: unknown, label: string): string => {
  const id = clean(value);
  if (!validPathId(id)) throw new Error(`STORE_PROCUREMENT_${label}_INVALID`);
  return id;
};

const requiredText = (value: unknown, label: string, maxLength: number): string => {
  const text = clean(value);
  if (!text || text.length > maxLength) {
    throw new Error(`STORE_PROCUREMENT_${label}_INVALID`);
  }
  return text;
};

const optionalText = (value: unknown, label: string, maxLength: number): string => {
  const text = clean(value);
  if (text.length > maxLength) {
    throw new Error(`STORE_PROCUREMENT_${label}_INVALID`);
  }
  return text;
};

const positiveQuantity = (value: unknown, label: string): number => {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error(`STORE_PROCUREMENT_${label}_INVALID`);
  }
  return quantity;
};

const optionalMinor = (value: unknown, label: string): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`STORE_PROCUREMENT_${label}_INVALID`);
  }
  return amount;
};

const isSupplierStatus = (value: unknown): value is StoreSupplierStatus =>
  value === 'active' || value === 'inactive';

const isPurchaseStatus = (value: unknown): value is StorePurchaseStatus =>
  value === 'draft'
  || value === 'ordered'
  || value === 'partially_received'
  || value === 'received'
  || value === 'cancelled';

const isReceiptStatus = (value: unknown): value is StorePurchaseReceiptStatus =>
  value === 'draft' || value === 'confirmed' || value === 'cancelled';

const isSourceAuthority = (value: unknown): value is StorePurchaseSourceAuthority =>
  value === 'store_owner_manual'
  || value === 'kyrubia_assisted'
  || value === 'supplier_document';

const isUnit = (value: unknown): value is StorePurchaseUnit =>
  value === 'un'
  || value === 'g'
  || value === 'kg'
  || value === 'ml'
  || value === 'l'
  || value === 'cx'
  || value === 'pct'
  || value === 'm'
  || value === 'cm';

const validateSourceReference = (
  authority: StorePurchaseSourceAuthority,
  rawReference: unknown
): string => {
  const reference = optionalText(rawReference, 'SOURCE_REFERENCE', 240);
  if (authority === 'supplier_document' && !reference) {
    throw new Error('STORE_PROCUREMENT_SOURCE_REFERENCE_REQUIRED');
  }
  return reference;
};

const ensureUniqueIds = (ids: string[], label: string): void => {
  if (new Set(ids).size !== ids.length) {
    throw new Error(`STORE_PROCUREMENT_${label}_DUPLICATE`);
  }
};

export const normalizeStoreSupplier = (value: unknown): StoreSupplier => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('STORE_SUPPLIER_INVALID');
  }
  const source = value as Partial<StoreSupplier>;
  const id = requiredPathId(source.id, 'SUPPLIER_ID');
  const storeId = requiredPathId(source.storeId, 'STORE_ID');
  const createdByUserId = requiredPathId(source.createdByUserId, 'CREATED_BY');
  const displayName = requiredText(source.displayName, 'SUPPLIER_NAME', 160);
  const contactName = optionalText(source.contactName, 'SUPPLIER_CONTACT', 120);
  const email = optionalText(source.email, 'SUPPLIER_EMAIL', 200);
  const phone = optionalText(source.phone, 'SUPPLIER_PHONE', 60);
  const notes = optionalText(source.notes, 'SUPPLIER_NOTES', 1000);
  const createdAt = clean(source.createdAt);
  const updatedAt = clean(source.updatedAt);

  if (
    source.schemaVersion !== STORE_PROCUREMENT_SCHEMA_VERSION
    || !isSupplierStatus(source.status)
    || !validIso(createdAt)
    || !validIso(updatedAt)
  ) {
    throw new Error('STORE_SUPPLIER_INVALID');
  }

  return {
    schemaVersion: STORE_PROCUREMENT_SCHEMA_VERSION,
    id,
    storeId,
    displayName,
    status: source.status,
    contactName,
    email,
    phone,
    notes,
    createdByUserId,
    createdAt,
    updatedAt,
  };
};

const normalizePurchaseLine = (value: unknown): StorePurchaseLine => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('STORE_PURCHASE_LINE_INVALID');
  }
  const source = value as Partial<StorePurchaseLine>;
  const id = requiredPathId(source.id, 'PURCHASE_LINE_ID');
  const inventoryItemId = requiredPathId(source.inventoryItemId, 'INVENTORY_ITEM_ID');
  const name = requiredText(source.name, 'PURCHASE_LINE_NAME', 160);
  if (!isUnit(source.unit)) throw new Error('STORE_PURCHASE_LINE_UNIT_INVALID');

  return {
    id,
    inventoryItemId,
    name,
    unit: source.unit,
    orderedQuantity: positiveQuantity(source.orderedQuantity, 'ORDERED_QUANTITY'),
    quotedUnitCostMinor: optionalMinor(source.quotedUnitCostMinor, 'QUOTED_UNIT_COST'),
  };
};

export const normalizeStorePurchase = (value: unknown): StorePurchase => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('STORE_PURCHASE_INVALID');
  }
  const source = value as Partial<StorePurchase>;
  const id = requiredPathId(source.id, 'PURCHASE_ID');
  const storeId = requiredPathId(source.storeId, 'STORE_ID');
  const supplierId = requiredPathId(source.supplierId, 'SUPPLIER_ID');
  const createdByUserId = requiredPathId(source.createdByUserId, 'CREATED_BY');
  const createdAt = clean(source.createdAt);
  const updatedAt = clean(source.updatedAt);
  const orderedAt = clean(source.orderedAt);
  const cancelledAt = clean(source.cancelledAt);

  if (
    source.schemaVersion !== STORE_PROCUREMENT_SCHEMA_VERSION
    || source.currency !== STORE_PURCHASE_CURRENCY
    || !isPurchaseStatus(source.status)
    || !isSourceAuthority(source.sourceAuthority)
    || !Array.isArray(source.lines)
    || source.lines.length === 0
    || source.lines.length > 200
    || !validIso(createdAt)
    || !validIso(updatedAt)
  ) {
    throw new Error('STORE_PURCHASE_INVALID');
  }

  const lines = source.lines.map(normalizePurchaseLine);
  ensureUniqueIds(lines.map(line => line.id), 'PURCHASE_LINE_ID');
  const sourceReference = validateSourceReference(
    source.sourceAuthority,
    source.sourceReference
  );

  if (source.status === 'draft' && (orderedAt || cancelledAt)) {
    throw new Error('STORE_PURCHASE_STATUS_TIMESTAMPS_INVALID');
  }
  if (
    (source.status === 'ordered'
      || source.status === 'partially_received'
      || source.status === 'received')
    && (!validIso(orderedAt) || cancelledAt)
  ) {
    throw new Error('STORE_PURCHASE_STATUS_TIMESTAMPS_INVALID');
  }
  if (source.status === 'cancelled' && !validIso(cancelledAt)) {
    throw new Error('STORE_PURCHASE_STATUS_TIMESTAMPS_INVALID');
  }

  return {
    schemaVersion: STORE_PROCUREMENT_SCHEMA_VERSION,
    id,
    storeId,
    supplierId,
    status: source.status,
    currency: STORE_PURCHASE_CURRENCY,
    lines,
    sourceAuthority: source.sourceAuthority,
    sourceReference,
    createdByUserId,
    orderedAt,
    cancelledAt,
    createdAt,
    updatedAt,
  };
};

const normalizeReceiptLine = (value: unknown): StorePurchaseReceiptLine => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('STORE_PURCHASE_RECEIPT_LINE_INVALID');
  }
  const source = value as Partial<StorePurchaseReceiptLine>;
  const purchaseLineId = requiredPathId(source.purchaseLineId, 'PURCHASE_LINE_ID');
  const inventoryItemId = requiredPathId(source.inventoryItemId, 'INVENTORY_ITEM_ID');
  if (!isUnit(source.unit)) throw new Error('STORE_PURCHASE_RECEIPT_LINE_UNIT_INVALID');

  return {
    purchaseLineId,
    inventoryItemId,
    unit: source.unit,
    receivedQuantity: positiveQuantity(source.receivedQuantity, 'RECEIVED_QUANTITY'),
    documentedUnitCostMinor: optionalMinor(
      source.documentedUnitCostMinor,
      'DOCUMENTED_UNIT_COST'
    ),
  };
};

export const normalizeStorePurchaseReceipt = (
  value: unknown
): StorePurchaseReceipt => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('STORE_PURCHASE_RECEIPT_INVALID');
  }
  const source = value as Partial<StorePurchaseReceipt>;
  const id = requiredPathId(source.id, 'PURCHASE_RECEIPT_ID');
  const storeId = requiredPathId(source.storeId, 'STORE_ID');
  const purchaseId = requiredPathId(source.purchaseId, 'PURCHASE_ID');
  const supplierId = requiredPathId(source.supplierId, 'SUPPLIER_ID');
  const createdByUserId = requiredPathId(source.createdByUserId, 'CREATED_BY');
  const createdAt = clean(source.createdAt);
  const updatedAt = clean(source.updatedAt);
  const confirmedAt = clean(source.confirmedAt);
  const cancelledAt = clean(source.cancelledAt);

  if (
    source.schemaVersion !== STORE_PROCUREMENT_SCHEMA_VERSION
    || source.currency !== STORE_PURCHASE_CURRENCY
    || !isReceiptStatus(source.status)
    || !isSourceAuthority(source.sourceAuthority)
    || !Array.isArray(source.lines)
    || source.lines.length === 0
    || source.lines.length > 200
    || !validIso(createdAt)
    || !validIso(updatedAt)
  ) {
    throw new Error('STORE_PURCHASE_RECEIPT_INVALID');
  }

  const lines = source.lines.map(normalizeReceiptLine);
  ensureUniqueIds(lines.map(line => line.purchaseLineId), 'RECEIPT_PURCHASE_LINE');
  const sourceReference = validateSourceReference(
    source.sourceAuthority,
    source.sourceReference
  );

  if (source.status === 'draft' && (confirmedAt || cancelledAt)) {
    throw new Error('STORE_PURCHASE_RECEIPT_STATUS_TIMESTAMPS_INVALID');
  }
  if (source.status === 'confirmed' && (!validIso(confirmedAt) || cancelledAt)) {
    throw new Error('STORE_PURCHASE_RECEIPT_STATUS_TIMESTAMPS_INVALID');
  }
  if (source.status === 'cancelled' && (!validIso(cancelledAt) || confirmedAt)) {
    throw new Error('STORE_PURCHASE_RECEIPT_STATUS_TIMESTAMPS_INVALID');
  }

  return {
    schemaVersion: STORE_PROCUREMENT_SCHEMA_VERSION,
    id,
    storeId,
    purchaseId,
    supplierId,
    status: source.status,
    currency: STORE_PURCHASE_CURRENCY,
    lines,
    sourceAuthority: source.sourceAuthority,
    sourceReference,
    createdByUserId,
    confirmedAt,
    cancelledAt,
    createdAt,
    updatedAt,
  };
};

export const buildManualStoreSupplier = (input: {
  id: string;
  storeId: string;
  displayName: string;
  contactName?: string;
  email?: string;
  phone?: string;
  notes?: string;
  createdByUserId: string;
  now?: string;
}): StoreSupplier => {
  const now = clean(input.now) || new Date().toISOString();
  return normalizeStoreSupplier({
    schemaVersion: STORE_PROCUREMENT_SCHEMA_VERSION,
    id: input.id,
    storeId: input.storeId,
    displayName: input.displayName,
    status: 'active',
    contactName: input.contactName ?? '',
    email: input.email ?? '',
    phone: input.phone ?? '',
    notes: input.notes ?? '',
    createdByUserId: input.createdByUserId,
    createdAt: now,
    updatedAt: now,
  });
};

export const buildStorePurchaseDraft = (input: {
  id: string;
  storeId: string;
  supplierId: string;
  lines: StorePurchaseLine[];
  sourceAuthority: StorePurchaseSourceAuthority;
  sourceReference?: string;
  createdByUserId: string;
  now?: string;
}): StorePurchase => {
  const now = clean(input.now) || new Date().toISOString();
  return normalizeStorePurchase({
    schemaVersion: STORE_PROCUREMENT_SCHEMA_VERSION,
    id: input.id,
    storeId: input.storeId,
    supplierId: input.supplierId,
    status: 'draft',
    currency: STORE_PURCHASE_CURRENCY,
    lines: input.lines,
    sourceAuthority: input.sourceAuthority,
    sourceReference: input.sourceReference ?? '',
    createdByUserId: input.createdByUserId,
    orderedAt: '',
    cancelledAt: '',
    createdAt: now,
    updatedAt: now,
  });
};

export const buildStorePurchaseReceiptDraft = (input: {
  id: string;
  storeId: string;
  purchaseId: string;
  supplierId: string;
  lines: StorePurchaseReceiptLine[];
  sourceAuthority: StorePurchaseSourceAuthority;
  sourceReference?: string;
  createdByUserId: string;
  now?: string;
}): StorePurchaseReceipt => {
  const now = clean(input.now) || new Date().toISOString();
  return normalizeStorePurchaseReceipt({
    schemaVersion: STORE_PROCUREMENT_SCHEMA_VERSION,
    id: input.id,
    storeId: input.storeId,
    purchaseId: input.purchaseId,
    supplierId: input.supplierId,
    status: 'draft',
    currency: STORE_PURCHASE_CURRENCY,
    lines: input.lines,
    sourceAuthority: input.sourceAuthority,
    sourceReference: input.sourceReference ?? '',
    createdByUserId: input.createdByUserId,
    confirmedAt: '',
    cancelledAt: '',
    createdAt: now,
    updatedAt: now,
  });
};

export const storeSupplierPath = (storeIdInput: string, supplierIdInput: string): string => {
  const storeId = requiredPathId(storeIdInput, 'STORE_ID');
  const supplierId = requiredPathId(supplierIdInput, 'SUPPLIER_ID');
  return `stores/${storeId}/suppliers/${encodeURIComponent(supplierId)}`;
};

export const storePurchasePath = (storeIdInput: string, purchaseIdInput: string): string => {
  const storeId = requiredPathId(storeIdInput, 'STORE_ID');
  const purchaseId = requiredPathId(purchaseIdInput, 'PURCHASE_ID');
  return `stores/${storeId}/purchases/${encodeURIComponent(purchaseId)}`;
};

export const storePurchaseReceiptPath = (
  storeIdInput: string,
  receiptIdInput: string
): string => {
  const storeId = requiredPathId(storeIdInput, 'STORE_ID');
  const receiptId = requiredPathId(receiptIdInput, 'PURCHASE_RECEIPT_ID');
  return `stores/${storeId}/purchaseReceipts/${encodeURIComponent(receiptId)}`;
};

export const canTransitionStorePurchaseStatus = (
  from: StorePurchaseStatus,
  to: StorePurchaseStatus
): boolean => {
  if (from === to) return true;
  if (from === 'draft') return to === 'ordered' || to === 'cancelled';
  if (from === 'ordered') {
    return to === 'partially_received' || to === 'received' || to === 'cancelled';
  }
  if (from === 'partially_received') return to === 'received';
  return false;
};

export const canTransitionStorePurchaseReceiptStatus = (
  from: StorePurchaseReceiptStatus,
  to: StorePurchaseReceiptStatus
): boolean => {
  if (from === to) return true;
  return from === 'draft' && (to === 'confirmed' || to === 'cancelled');
};

const receiptFingerprint = (receipt: StorePurchaseReceipt): string =>
  JSON.stringify({
    storeId: receipt.storeId,
    purchaseId: receipt.purchaseId,
    supplierId: receipt.supplierId,
    status: receipt.status,
    lines: receipt.lines,
    sourceAuthority: receipt.sourceAuthority,
    sourceReference: receipt.sourceReference,
    confirmedAt: receipt.confirmedAt,
    cancelledAt: receipt.cancelledAt,
  });

export const deriveStorePurchaseReceivingProgress = (input: {
  purchase: StorePurchase;
  receipts: StorePurchaseReceipt[];
}): StorePurchaseReceivingProgress => {
  const purchase = normalizeStorePurchase(input.purchase);
  const lineById = new Map(purchase.lines.map(line => [line.id, line]));
  const receivedByLine = new Map<string, number>(
    purchase.lines.map(line => [line.id, 0])
  );
  const receiptsById = new Map<string, StorePurchaseReceipt>();

  for (const rawReceipt of input.receipts) {
    const receipt = normalizeStorePurchaseReceipt(rawReceipt);
    if (
      receipt.storeId !== purchase.storeId
      || receipt.purchaseId !== purchase.id
      || receipt.supplierId !== purchase.supplierId
    ) {
      throw new Error('STORE_PURCHASE_RECEIPT_SCOPE_INVALID');
    }

    const previous = receiptsById.get(receipt.id);
    if (previous) {
      if (receiptFingerprint(previous) !== receiptFingerprint(receipt)) {
        throw new Error('STORE_PURCHASE_RECEIPT_IDEMPOTENCY_CONFLICT');
      }
      continue;
    }
    receiptsById.set(receipt.id, receipt);

    for (const receiptLine of receipt.lines) {
      const purchaseLine = lineById.get(receiptLine.purchaseLineId);
      if (
        !purchaseLine
        || receiptLine.inventoryItemId !== purchaseLine.inventoryItemId
        || receiptLine.unit !== purchaseLine.unit
      ) {
        throw new Error('STORE_PURCHASE_RECEIPT_LINE_SCOPE_INVALID');
      }
    }

    if (receipt.status !== 'confirmed') continue;

    for (const receiptLine of receipt.lines) {
      const nextQuantity =
        (receivedByLine.get(receiptLine.purchaseLineId) ?? 0)
        + receiptLine.receivedQuantity;
      const orderedQuantity = lineById.get(receiptLine.purchaseLineId)?.orderedQuantity ?? 0;
      if (nextQuantity > orderedQuantity + Number.EPSILON) {
        throw new Error('STORE_PURCHASE_RECEIPT_OVER_RECEIPT');
      }
      receivedByLine.set(receiptLine.purchaseLineId, nextQuantity);
    }
  }

  const lines = purchase.lines.map<StorePurchaseReceivingLineProgress>(line => {
    const receivedQuantity = receivedByLine.get(line.id) ?? 0;
    return {
      purchaseLineId: line.id,
      inventoryItemId: line.inventoryItemId,
      unit: line.unit,
      orderedQuantity: line.orderedQuantity,
      receivedQuantity,
      remainingQuantity: Math.max(0, line.orderedQuantity - receivedQuantity),
    };
  });

  const hasAnyReceipt = lines.some(line => line.receivedQuantity > 0);
  const complete = lines.every(line => line.remainingQuantity <= Number.EPSILON);
  const state: StorePurchaseReceivingState = complete
    ? 'received'
    : hasAnyReceipt
      ? 'partially_received'
      : 'not_started';

  return {
    state,
    confirmedReceiptCount: [...receiptsById.values()].filter(
      receipt => receipt.status === 'confirmed'
    ).length,
    lines,
  };
};
