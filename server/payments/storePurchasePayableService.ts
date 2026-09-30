import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import {
  normalizeStorePurchase,
  normalizeStoreSupplier,
  storePurchasePath,
  storeSupplierPath,
} from '../../shared/storePurchases.js';
import {
  buildStorePurchaseFinancePayable,
  normalizeStoreFinancePayable,
  storeFinancePayablePath,
  type StoreFinancePayable,
  type StoreFinancePayableBillingDocumentType,
  type StoreFinancePayableCostNature,
} from '../../shared/storeFinancePayables.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const requiredId = (value: unknown, code: string): string => {
  const id = clean(value);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error(code);
  return id;
};

const costNatureFrom = (value: unknown): StoreFinancePayableCostNature => {
  const nature = clean(value);
  if (!nature || nature === 'unspecified') return 'unspecified';
  if (nature === 'fixed' || nature === 'variable') return nature;
  throw new Error('STORE_FINANCE_PAYABLE_COST_NATURE_INVALID');
};

const billingDocumentTypeFrom = (
  value: unknown
): StoreFinancePayableBillingDocumentType => {
  const type = clean(value);
  if (!type || type === 'none') return 'none';
  if (type === 'boleto' || type === 'invoice' || type === 'other') return type;
  throw new Error('STORE_FINANCE_PAYABLE_BILLING_DOCUMENT_TYPE_INVALID');
};

const positiveAmountMinor = (value: unknown): number => {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('STORE_FINANCE_PAYABLE_AMOUNT_INVALID');
  }
  return amount;
};

const requireCanonicalStoreOwner = async (
  authorization: string,
  storeIdValue: unknown
): Promise<{ storeId: string; ownerUserId: string }> => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  const storeId = requiredId(storeIdValue, 'STORE_PROCUREMENT_STORE_REQUIRED');
  const memberSnapshot = await adminDb
    .doc(`stores/${storeId}/members/${identity.uid}`)
    .get();
  const member = memberSnapshot.data();
  if (
    !memberSnapshot.exists
    || clean(member?.userId) !== identity.uid
    || member?.role !== 'owner'
    || member?.status !== 'active'
  ) {
    throw new Error('STORE_PROCUREMENT_FORBIDDEN');
  }
  return { storeId, ownerUserId: identity.uid };
};

const payableIdFor = (input: {
  storeId: string;
  purchaseId: string;
  purchasePayableKey: string;
}): string =>
  `purchase_payable_${createHash('sha256')
    .update(`${input.storeId}:${input.purchaseId}:${input.purchasePayableKey}`)
    .digest('hex')
    .slice(0, 40)}`;

const sameFinancialIntent = (
  existing: StoreFinancePayable,
  expected: StoreFinancePayable
): boolean =>
  existing.storeId === expected.storeId
  && existing.purchaseId === expected.purchaseId
  && existing.supplierId === expected.supplierId
  && existing.purchasePayableKey === expected.purchasePayableKey
  && existing.amountMinor === expected.amountMinor
  && existing.dueDate === expected.dueDate
  && existing.costNature === expected.costNature
  && existing.billingDocumentType === expected.billingDocumentType
  && existing.billingDocumentReference === expected.billingDocumentReference
  && existing.billingDigitableLine === expected.billingDigitableLine
  && existing.billingBarcode === expected.billingBarcode;

export type PurchasePayableLinkResult = {
  status: 'created' | 'existing';
  payable: StoreFinancePayable;
};

export const createAuthorizedPurchasePayable = async (
  authorization: string,
  rawInput: unknown
): Promise<PurchasePayableLinkResult> => {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    throw new Error('STORE_FINANCE_PAYABLE_REQUEST_INVALID');
  }
  const input = rawInput as Record<string, unknown>;
  const { storeId, ownerUserId } = await requireCanonicalStoreOwner(
    authorization,
    input.storeId
  );
  const purchaseId = requiredId(
    input.purchaseId,
    'STORE_PROCUREMENT_PURCHASE_REQUIRED'
  );
  const purchasePayableKey = requiredId(
    input.purchasePayableKey || 'primary',
    'STORE_FINANCE_PAYABLE_PURCHASE_KEY_INVALID'
  );
  const amountMinor = positiveAmountMinor(input.amountMinor);
  const dueDate = clean(input.dueDate);
  const costNature = costNatureFrom(input.costNature);
  const billingDocumentType = billingDocumentTypeFrom(input.billingDocumentType);
  const billingDocumentReference = clean(input.billingDocumentReference);
  const billingDigitableLine = clean(input.billingDigitableLine);
  const billingBarcode = clean(input.billingBarcode);

  const purchaseReference = adminDb.doc(storePurchasePath(storeId, purchaseId));
  const purchaseSnapshot = await purchaseReference.get();
  if (!purchaseSnapshot.exists) throw new Error('STORE_PROCUREMENT_PURCHASE_NOT_FOUND');
  const purchase = normalizeStorePurchase(purchaseSnapshot.data());
  if (purchase.id !== purchaseId || purchase.storeId !== storeId) {
    throw new Error('STORE_PROCUREMENT_PURCHASE_SCOPE_INVALID');
  }
  if (
    purchase.status !== 'ordered'
    && purchase.status !== 'partially_received'
    && purchase.status !== 'received'
  ) {
    throw new Error('STORE_FINANCE_PAYABLE_PURCHASE_NOT_COMMITTED');
  }

  const supplierSnapshot = await adminDb
    .doc(storeSupplierPath(storeId, purchase.supplierId))
    .get();
  if (!supplierSnapshot.exists) throw new Error('STORE_PROCUREMENT_SUPPLIER_NOT_FOUND');
  const supplier = normalizeStoreSupplier(supplierSnapshot.data());
  if (supplier.storeId !== storeId || supplier.id !== purchase.supplierId) {
    throw new Error('STORE_PROCUREMENT_SUPPLIER_SCOPE_INVALID');
  }

  const payableId = payableIdFor({ storeId, purchaseId, purchasePayableKey });
  const payable = buildStorePurchaseFinancePayable({
    id: payableId,
    storeId,
    purchaseId,
    supplierId: supplier.id,
    purchasePayableKey,
    amountMinor,
    supplierDisplayName: supplier.displayName.slice(0, 100),
    dueDate,
    costNature,
    billingDocumentType,
    billingDocumentReference,
    billingDigitableLine,
    billingBarcode,
    createdByUserId: ownerUserId,
  });
  const payableReference = adminDb.doc(storeFinancePayablePath(storeId, payableId));

  return adminDb.runTransaction(async transaction => {
    const existingSnapshot = await transaction.get(payableReference);
    if (existingSnapshot.exists) {
      const existing = normalizeStoreFinancePayable({
        ...(existingSnapshot.data() as StoreFinancePayable),
        id: payableId,
        storeId,
      });
      if (!sameFinancialIntent(existing, payable)) {
        throw new Error('STORE_FINANCE_PAYABLE_IDEMPOTENCY_CONFLICT');
      }
      return { status: 'existing' as const, payable: existing };
    }

    transaction.create(payableReference, payable);
    return { status: 'created' as const, payable };
  });
};