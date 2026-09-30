import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  buildManualStoreFinancePayable,
  buildStorePurchaseFinancePayable,
  normalizeStoreFinancePayable,
} from '../shared/storeFinancePayables.js';

describe('purchase to finance payable linkage', () => {
  test('legacy manual payables remain valid with backward-compatible defaults', () => {
    const payable = normalizeStoreFinancePayable({
      schemaVersion: 1,
      id: 'payable_legacy',
      storeId: 'store_1',
      status: 'open',
      currency: 'BRL',
      amountMinor: 10000,
      description: 'Energia',
      category: 'utilities',
      counterparty: 'Concessionária',
      dueDate: '2026-10-10',
      recurrence: 'monthly',
      sourceAuthority: 'store_owner_manual',
      teamStoreId: '',
      teamMemberUserId: '',
      payrollPeriod: '',
      createdByUserId: 'owner_1',
      createdAt: '2026-09-30T10:00:00.000Z',
      updatedAt: '2026-09-30T10:00:00.000Z',
      paidAt: '',
      cancelledAt: '',
    });

    assert.equal(payable.costNature, 'unspecified');
    assert.equal(payable.billingDocumentType, 'none');
    assert.equal(payable.purchaseId, '');
    assert.equal(payable.supplierId, '');
    assert.equal(payable.purchasePayableKey, '');
  });

  test('purchase payable carries canonical purchase and supplier identity', () => {
    const payable = buildStorePurchaseFinancePayable({
      id: 'purchase_payable_abc',
      storeId: 'store_1',
      purchaseId: 'purchase_1',
      supplierId: 'supplier_1',
      purchasePayableKey: 'primary',
      amountMinor: 25990,
      supplierDisplayName: 'Fornecedor Real',
      dueDate: '2026-10-15',
      costNature: 'variable',
      billingDocumentType: 'boleto',
      billingDocumentReference: 'NF-123',
      billingDigitableLine: '00190.00009 01234.567890 12345.678901 1 12340000025990',
      billingBarcode: '00191123400000259900000012345678901234567890',
      createdByUserId: 'owner_1',
      now: '2026-09-30T10:00:00.000Z',
    });

    assert.equal(payable.sourceAuthority, 'store_purchase');
    assert.equal(payable.category, 'inventory');
    assert.equal(payable.recurrence, 'none');
    assert.equal(payable.purchaseId, 'purchase_1');
    assert.equal(payable.supplierId, 'supplier_1');
    assert.equal(payable.purchasePayableKey, 'primary');
    assert.equal(payable.costNature, 'variable');
    assert.equal(payable.billingDocumentType, 'boleto');
  });

  test('billing barcode evidence is scoped to boleto documents', () => {
    assert.throws(() => buildManualStoreFinancePayable({
      id: 'payable_bad_document',
      storeId: 'store_1',
      amountMinor: 5000,
      description: 'Serviço',
      category: 'service',
      dueDate: '2026-10-20',
      recurrence: 'none',
      billingDocumentType: 'invoice',
      billingBarcode: '123456789',
      createdByUserId: 'owner_1',
      now: '2026-09-30T10:00:00.000Z',
    }), /STORE_FINANCE_PAYABLE_BILLING_DOCUMENT_SCOPE_INVALID/);
  });

  test('server bridge requires committed purchase and deterministic idempotency', () => {
    const service = readFileSync(
      'server/payments/storePurchasePayableService.ts',
      'utf8'
    );
    const router = readFileSync(
      'server/inventory/storeProcurementRouter.ts',
      'utf8'
    );

    assert.match(service, /createHash\('sha256'\)/);
    assert.match(service, /purchasePayableKey/);
    assert.match(service, /purchase\.status !== 'ordered'/);
    assert.match(service, /purchase\.status !== 'partially_received'/);
    assert.match(service, /purchase\.status !== 'received'/);
    assert.match(service, /STORE_FINANCE_PAYABLE_PURCHASE_NOT_COMMITTED/);
    assert.match(service, /transaction\.create\(payableReference, payable\)/);
    assert.match(service, /STORE_FINANCE_PAYABLE_IDEMPOTENCY_CONFLICT/);
    assert.match(router, /post\('\/finance-payable'/);
    assert.match(router, /createAuthorizedPurchasePayable/);
  });

  test('Stock purchase bridge uses authorized APIs and never writes Firestore directly', () => {
    const bridge = readFileSync(
      'src/components/store/StorePurchasePayableBridge.tsx',
      'utf8'
    );
    const stockRuntime = readFileSync(
      'src/components/store/StockDirectRuntime.tsx',
      'utf8'
    );

    assert.match(bridge, /\/api\/store-procurement\/finance-payable/);
    assert.match(bridge, /\/api\/store-finance\?storeId=/);
    assert.match(bridge, /purchasePayableKey: 'primary'/);
    assert.match(bridge, /billingDigitableLine/);
    assert.match(bridge, /billingBarcode/);
    assert.match(bridge, /Natureza do custo/);
    assert.doesNotMatch(bridge, /firebase\/firestore|setDoc|addDoc|updateDoc/);
    assert.match(stockRuntime, /StorePurchasePayableBridge/);
    assert.match(stockRuntime, /section === 'purchases'/);
  });
});