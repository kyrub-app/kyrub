import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  STORE_FINANCE_PAYABLE_CURRENCY,
  STORE_FINANCE_PAYABLE_SCHEMA_VERSION,
  buildManualStoreFinancePayable,
  normalizeStoreFinancePayable,
} from '../shared/storeFinancePayables.js';

const now = '2026-09-30T15:00:00.000Z';

test('manual payable supports cost nature and boleto evidence', () => {
  const payable = buildManualStoreFinancePayable({
    id: 'payable-manual-rich',
    storeId: 'store-1',
    amountMinor: 12590,
    description: 'Energia elétrica',
    category: 'utilities',
    counterparty: 'Concessionária',
    dueDate: '2026-10-10',
    recurrence: 'monthly',
    costNature: 'variable',
    billingDocumentType: 'boleto',
    billingDocumentReference: 'fatura-setembro.pdf',
    billingDigitableLine: '00190.00009 01234.567890 12345.678901 2 12340000012590',
    billingBarcode: '00192123400000125900000001234567890123456789',
    createdByUserId: 'owner-1',
    now,
  });

  assert.equal(payable.sourceAuthority, 'store_owner_manual');
  assert.equal(payable.costNature, 'variable');
  assert.equal(payable.billingDocumentType, 'boleto');
  assert.equal(payable.billingDocumentReference, 'fatura-setembro.pdf');
  assert.match(payable.billingDigitableLine, /^00190/);
  assert.match(payable.billingBarcode, /^00192/);
  assert.equal(payable.purchaseId, '');
  assert.equal(payable.supplierId, '');
});

test('legacy manual payable remains backward compatible with new optional fields', () => {
  const legacy = normalizeStoreFinancePayable({
    schemaVersion: STORE_FINANCE_PAYABLE_SCHEMA_VERSION,
    id: 'payable-legacy',
    storeId: 'store-1',
    status: 'open',
    currency: STORE_FINANCE_PAYABLE_CURRENCY,
    amountMinor: 5000,
    description: 'Aluguel',
    category: 'rent',
    counterparty: 'Locador',
    dueDate: '2026-10-05',
    recurrence: 'monthly',
    sourceAuthority: 'store_owner_manual',
    teamStoreId: '',
    teamMemberUserId: '',
    payrollPeriod: '',
    createdByUserId: 'owner-1',
    createdAt: now,
    updatedAt: now,
    paidAt: '',
    cancelledAt: '',
  });

  assert.equal(legacy.costNature, 'unspecified');
  assert.equal(legacy.billingDocumentType, 'none');
  assert.equal(legacy.billingDocumentReference, '');
  assert.equal(legacy.billingDigitableLine, '');
  assert.equal(legacy.billingBarcode, '');
  assert.equal(legacy.purchaseId, '');
  assert.equal(legacy.supplierId, '');
  assert.equal(legacy.purchasePayableKey, '');
});

test('non-boleto manual documents cannot retain boleto-only evidence', () => {
  assert.throws(() => buildManualStoreFinancePayable({
    id: 'payable-invalid-doc',
    storeId: 'store-1',
    amountMinor: 9900,
    description: 'Serviço mensal',
    category: 'service',
    dueDate: '2026-10-15',
    recurrence: 'monthly',
    costNature: 'fixed',
    billingDocumentType: 'invoice',
    billingBarcode: '1234567890',
    createdByUserId: 'owner-1',
    now,
  }), /STORE_FINANCE_PAYABLE_BILLING_DOCUMENT_SCOPE_INVALID/);
});

test('Financeiro manual UI and router forward the enriched payable fields', () => {
  const routerSource = readFileSync('server/payments/storeFinanceRouter.ts', 'utf8');
  const uiSource = readFileSync('src/components/store/StorePayablesWorkspace.tsx', 'utf8');

  assert.match(routerSource, /costNature:\s*payableCostNature\(body\.costNature\)/);
  assert.match(routerSource, /billingDocumentType,/);
  assert.match(routerSource, /billingDigitableLine:\s*billingDocumentType === 'boleto'/);
  assert.match(routerSource, /billingBarcode:\s*billingDocumentType === 'boleto'/);

  assert.match(uiSource, /Natureza do custo/);
  assert.match(uiSource, /Documento de cobrança/);
  assert.match(uiSource, /Linha digitável/);
  assert.match(uiSource, /Código de barras/);
  assert.match(uiSource, /Compra vinculada/);
});
